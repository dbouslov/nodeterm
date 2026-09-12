import { describe, it, expect } from 'vitest'
import {
  canDeliverInBackground,
  deliverInBackground,
  disarmDelivered,
  launchesToFire,
  launchRetryDelay,
  launchTooltip,
  pasteIntoShell,
  storedLaunchesToFire,
  unmetDeps,
  LAUNCH_DELIVERY_ATTEMPTS,
  LAUNCH_STALL_MS,
  type ArmedNode,
  type StatusById
} from './pendingLaunch'

const armed = (id: string, after: string[], command = `echo ${id}`): ArmedNode => ({
  id,
  data: { pendingLaunch: { after, command } }
})
const plain = (id: string): ArmedNode => ({ id, data: {} })

describe('launchesToFire', () => {
  it('leaves server-owned launches to the headless scheduler', () => {
    const node: ArmedNode = {
      id: 'c',
      data: { pendingLaunch: { after: [], command: 'echo c', executor: 'server' } }
    }
    expect(launchesToFire([node], {}, new Set(['c']))).toEqual([])
  })

  const live = new Set(['a', 'b', 'c'])

  it('fires when every dep has reported done', () => {
    const status: StatusById = { a: { state: 'done' }, b: { state: 'done' } }
    expect(launchesToFire([armed('c', ['a', 'b'])], status, live)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('does NOT fire while a dep is still working', () => {
    const status: StatusById = { a: { state: 'done' }, b: { state: 'working' } }
    expect(launchesToFire([armed('c', ['a', 'b'])], status, live)).toEqual([])
  })

  it('does NOT fire on an unknown state — "no news" is not "finished"', () => {
    // The whole point: right after a fan-out the upstream stations have emitted nothing yet.
    expect(launchesToFire([armed('c', ['a'])], {}, live)).toEqual([])
  })

  it('treats waiting/blocked as not satisfied — the station still needs its user', () => {
    expect(launchesToFire([armed('c', ['a'])], { a: { state: 'waiting' } }, live)).toEqual([])
    expect(launchesToFire([armed('c', ['a'])], { a: { state: 'blocked' } }, live)).toEqual([])
  })

  it('treats a dep that is no longer on the canvas as satisfied', () => {
    // A deleted node can never report; waiting on it would strand the dependent forever.
    const status: StatusById = { a: { state: 'done' } }
    expect(launchesToFire([armed('c', ['a', 'ghost'])], status, new Set(['a', 'c']))).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('ignores nodes that are not armed, and armed nodes with an empty command', () => {
    const status: StatusById = { a: { state: 'done' } }
    expect(launchesToFire([plain('c'), armed('d', ['a'], '')], status, live)).toEqual([])
  })

  it('fires immediately when there are no deps left to wait on', () => {
    expect(launchesToFire([armed('c', [])], {}, live)).toEqual([{ id: 'c', command: 'echo c' }])
  })

  it('walks a chain A → B → C one station at a time', () => {
    const chain = [armed('b', ['a']), armed('c', ['b'])]
    // Nothing has reported: nothing fires.
    expect(launchesToFire(chain, {}, live)).toEqual([])
    // A done releases B only — C waits on B, which has not even started.
    expect(launchesToFire(chain, { a: { state: 'done' } }, live)).toEqual([{ id: 'b', command: 'echo b' }])
    // B running is still not B done.
    expect(launchesToFire(chain, { a: { state: 'done' }, b: { state: 'working' } }, live)).toEqual([
      { id: 'b', command: 'echo b' }
    ])
    // B done releases C. (B is still listed here because the caller, not this function, retires a
    // delivered launch by clearing its pendingLaunch — exactly-once lives in `launchInFlight`.)
    expect(launchesToFire(chain, { a: { state: 'done' }, b: { state: 'done' } }, live)).toEqual([
      { id: 'b', command: 'echo b' },
      { id: 'c', command: 'echo c' }
    ])
  })

  it('after a restart with no recorded clean end, a persisted arming holds — ▶ is the escape', () => {
    // Agent state is transient; a dep with no persisted `lastTurnClean` (it errored, was mid-turn at
    // quit, or was never seen) is unknown now, and unknown is NOT satisfied. The manual run-now on
    // the badge exists for exactly this. A recorded clean end does release — see `lastTurnClean`.
    expect(launchesToFire([armed('c', ['a'])], {}, live)).toEqual([])
    expect(unmetDeps(armed('c', ['a']), {}, live)).toEqual(['a'])
  })

  it('a dep deleted mid-chain releases what waited on it, but not what waits further down', () => {
    const chain = [armed('b', ['a']), armed('c', ['b'])]
    const liveWithoutA = new Set(['b', 'c'])
    expect(launchesToFire(chain, {}, liveWithoutA)).toEqual([{ id: 'b', command: 'echo b' }])
  })
})

describe('launchesToFire — awaitSetupGroup (a worktree whose setup script must land first)', () => {
  const live = new Set(['a', 'c'])
  const armedForSetup = (id: string, groupId: string, after: string[] = []): ArmedNode => ({
    id,
    data: { pendingLaunch: { after, command: `echo ${id}`, awaitSetupGroup: groupId } }
  })

  it('holds the launch while the group’s setup run is not done', () => {
    expect(launchesToFire([armedForSetup('c', 'g1')], {}, live, () => false)).toEqual([])
  })

  it('fires once the group’s setup run is done', () => {
    expect(launchesToFire([armedForSetup('c', 'g1')], {}, live, () => true)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('with no setupDone probe at all, the gate is open — an absent probe never strands a node', () => {
    // Reached after an app restart: the run store is empty, and a node armed before the restart
    // would otherwise wait forever for a run nobody is going to report on again.
    expect(launchesToFire([armedForSetup('c', 'g1')], {}, live)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('asks the probe about THIS node’s group', () => {
    const asked: string[] = []
    launchesToFire([armedForSetup('c', 'g-seven')], {}, live, (g) => {
      asked.push(g)
      return true
    })
    expect(asked).toEqual(['g-seven'])
  })

  it('needs BOTH gates: setup done AND every `after` dep satisfied', () => {
    const node = [armedForSetup('c', 'g1', ['a'])]
    // setup done, dep still working
    expect(launchesToFire(node, { a: { state: 'working' } }, live, () => true)).toEqual([])
    // dep done, setup still running
    expect(launchesToFire(node, { a: { state: 'done' } }, live, () => false)).toEqual([])
    // both
    expect(launchesToFire(node, { a: { state: 'done' } }, live, () => true)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('leaves a node with no awaitSetupGroup alone even while some setup is running', () => {
    expect(launchesToFire([armed('c', [])], {}, live, () => false)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })
})

describe('unmetDeps', () => {
  it('reports only the deps still outstanding', () => {
    const live = new Set(['a', 'b', 'c'])
    const status: StatusById = { a: { state: 'done' }, b: { state: 'working' } }
    expect(unmetDeps(armed('c', ['a', 'b']), status, live)).toEqual(['b'])
  })

  it('is empty for a node that is not armed', () => {
    expect(unmetDeps(plain('c'), {}, new Set(['c']))).toEqual([])
  })
})

/**
 * Issue #569 item 1 — the delivery policy behind an armed node's held launch.
 *
 * The bug these pin: delivery used to be a flat 5 × 400 ms = 2 s budget started when the CANVAS
 * decided a node was ready to launch, not when the node's terminal existed. A cold project switch
 * spends that budget on loading the canvas, mounting the node and spawning tmux, so the launch was
 * abandoned before there was anything to deliver into — and abandoned into a `console.warn`, which
 * left a node reading QUEUED forever with no way to tell it apart from one still waiting on a
 * dependency.
 */
describe('launch delivery policy (#569 item 1)', () => {
  it('the schedule backs off and is bounded — exhaustion is reachable, so "gave up" can be told', () => {
    const delays: number[] = []
    for (let attempt = 1; ; attempt++) {
      const d = launchRetryDelay(attempt)
      if (d === null) break
      delays.push(d)
      expect(attempt).toBeLessThan(20) // guard: a schedule that never ends is the bug, not a fix
    }
    expect(delays.length).toBe(LAUNCH_DELIVERY_ATTEMPTS)
    // Strictly increasing: a flat schedule is what made the old budget a fixed 2 s wall.
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1])
    // And the whole window is comfortably wider than the old one, measured from READINESS.
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(10_000)
  })

  it('an attempt past the end has no delay — nothing silently retries forever', () => {
    expect(launchRetryDelay(LAUNCH_DELIVERY_ATTEMPTS)).not.toBeNull()
    expect(launchRetryDelay(LAUNCH_DELIVERY_ATTEMPTS + 1)).toBeNull()
  })

  it('the stall warning waits longer than a cold project switch could plausibly take', () => {
    expect(LAUNCH_STALL_MS).toBeGreaterThanOrEqual(30_000)
  })
})

describe('launchTooltip — the QUEUED badge never goes silent (#569 item 1)', () => {
  const cmd = 'claude "review the diff"'

  it('with nothing to report it names the dependencies, exactly as before', () => {
    const t = launchTooltip(undefined, 'Builder, Tests', cmd)
    expect(t).toContain('Waiting for Builder, Tests to finish')
    expect(t).toContain(cmd)
    expect(t).not.toContain('▶')
  })

  it('a stalled launch says it is still held, and does NOT claim a cause it never measured', () => {
    const t = launchTooltip({ kind: 'stalled', since: 1 }, 'Builder', cmd)
    expect(t).toContain('has not started yet')
    expect(t).toContain('still held')
    expect(t).toContain('▶')
    // We know the terminal is not up; we do not know why. Naming a cause here would be the
    // misleading-error failure this feature exists to avoid.
    expect(t.toLowerCase()).not.toMatch(/ssh|host is down|crash/)
  })

  it('a failed launch reports the attempt count and that nothing will retry it', () => {
    const t = launchTooltip({ kind: 'failed', attempts: 5, at: 1 }, 'Builder', cmd)
    expect(t).toContain('5 attempts')
    expect(t).toContain('nothing will retry it')
    expect(t).toContain('▶')
    expect(t).toContain(cmd)
  })

  it('singularises one attempt (the manual ▶ reports exactly one refusal)', () => {
    expect(launchTooltip({ kind: 'failed', attempts: 1, at: 1 }, 'Builder', cmd)).toContain(
      '1 attempt was refused'
    )
  })

  it('failed outranks the dependency sentence — the warning is never buried', () => {
    const t = launchTooltip({ kind: 'failed', attempts: 5, at: 1 }, 'Builder', cmd)
    expect(t).not.toContain('Waiting for Builder')
  })
})

/**
 * An armed node whose project is NOT on screen. The canvas effect evaluated only React Flow's
 * `nodes` — the active project — so a dependency that went `done` while its project was in the
 * background released nothing, and the dependent sat as a bare shell until something brought that
 * project back (field report 2026-09-11: two orchestrated projects whose verbs travel the screen to
 * their own; a review panel fired fourteen minutes after its target finished, the instant a
 * `rename` travelled back).
 */
describe('storedLaunchesToFire — armed nodes in a project that is not on screen', () => {
  const stored = (id: string, after?: string[]) => ({
    id,
    ...(after ? { pendingLaunch: { after, command: `echo ${id}` } } : {})
  })
  const code = { id: 'code', nodes: [stored('builder'), stored('reviewer', ['builder'])] }
  const research = { id: 'research', nodes: [stored('station')] }

  it('fires an off-screen armed node once its dependency is done', () => {
    expect(storedLaunchesToFire([code, research], 'research', { builder: { state: 'done' } })).toEqual([
      { projectId: 'code', id: 'reviewer', command: 'echo reviewer' }
    ])
  })

  it('leaves the ACTIVE project to the live canvas — its stored copy may be stale', () => {
    expect(storedLaunchesToFire([code, research], 'code', { builder: { state: 'done' } })).toEqual([])
  })

  it('holds on working, unknown and errored deps — the same gate as on screen', () => {
    expect(storedLaunchesToFire([code], null, { builder: { state: 'working' } })).toEqual([])
    expect(storedLaunchesToFire([code], null, {})).toEqual([])
    expect(
      storedLaunchesToFire([code], null, { builder: { state: 'done', lastTurnError: { at: 1 } } })
    ).toEqual([])
  })

  it('skips a closed project — its launch waits for the project to be reopened', () => {
    expect(
      storedLaunchesToFire([{ ...code, closed: true }], null, { builder: { state: 'done' } })
    ).toEqual([])
  })

  it('reads each project as its own canvas — a dep that lives only in ANOTHER project counts as gone', () => {
    // `--after` ids are project-local, exactly as on screen, where a dep missing from the canvas is
    // satisfied (it can never report there). One `live` set shared across projects would let a busy
    // node elsewhere hold this one: `builder` is working here, but only in `research`.
    const reviewing = { id: 'code', nodes: [stored('reviewer', ['builder'])] }
    const building = { id: 'research', nodes: [stored('builder')] }
    expect(storedLaunchesToFire([reviewing, building], null, { builder: { state: 'working' } })).toEqual([
      { projectId: 'code', id: 'reviewer', command: 'echo reviewer' }
    ])
  })
})

/**
 * The background pass's per-node gate. `storedLaunchesToFire` says a launch MAY fire; off screen
 * there is no badge to report a stall or a refusal on, so the pass pastes only where nothing can go
 * quietly wrong, and leaves everything else to the on-screen loop.
 */
describe('canDeliverInBackground — which off-screen launches are pasted now', () => {
  const none = new Set<string>()
  const ready = () => true

  it('pastes a launch that is not in flight, was never refused, and has a session up', () => {
    expect(canDeliverInBackground('reviewer', none, none, ready)).toBe(true)
  })

  it('never pastes one already in flight or delivered — the exactly-once set the on-screen loop keeps', () => {
    expect(canDeliverInBackground('reviewer', new Set(['reviewer']), none, ready)).toBe(false)
  })

  it('never re-pastes one refused before — that is left to the on-screen loop and its badge', () => {
    // A refusal takes the id back OUT of flight; only the refused set stops the effect, which re-runs
    // on every drag frame, from pasting at a dead session again and again.
    expect(canDeliverInBackground('reviewer', none, new Set(['reviewer']), ready)).toBe(false)
  })

  it('waits while THIS node has no session up — a cold open that never mounted waits to be viewed', () => {
    const asked: string[] = []
    const notReady = (id: string) => {
      asked.push(id)
      return false
    }
    expect(canDeliverInBackground('reviewer', none, none, notReady)).toBe(false)
    expect(asked).toEqual(['reviewer'])
  })
})

/**
 * Where a launch that LANDED is disarmed. The paste is async and the screen can move while it is
 * out; the copy cleared has to be the one that will be SAVED, or the launch stays armed on disk,
 * outlives this run's in-flight set and fires AGAIN after a relaunch — now that a clean end survives
 * one (`lastTurnClean`).
 */
describe('disarmDelivered — a landed launch is cleared on the copy that will be saved', () => {
  type Stored = { id: string; nodes: { id: string; pendingLaunch?: { after: string[]; command: string } }[] }
  const node = (id: string, armed = true): Stored['nodes'][number] =>
    armed ? { id, pendingLaunch: { after: ['builder'], command: `echo ${id}` } } : { id }
  const projects: Stored[] = [
    { id: 'code', nodes: [node('builder', false), node('reviewer'), node('judge')] },
    { id: 'research', nodes: [node('station')] }
  ]
  /** What it decided, as one comparable value: 'live', or every launch still armed on disk. */
  const outcome = (r: 'live' | readonly Stored[]) =>
    r === 'live'
      ? 'live'
      : r.flatMap((p) => p.nodes.filter((n) => n.pendingLaunch).map((n) => `${p.id}/${n.id}`))

  it('clears the LIVE node while the canvas holds it for the active project — the next commit saves it', () => {
    // Also the background launch whose project came on screen while its paste was out.
    const canvas = { nodesProjectId: 'code', activeProjectId: 'code', holds: true }
    expect(outcome(disarmDelivered(projects, { id: 'reviewer', projectId: 'code' }, canvas))).toBe('live')
  })

  it('clears the STORED copy of a background launch whose project is still off screen', () => {
    const canvas = { nodesProjectId: 'code', activeProjectId: 'code', holds: false }
    expect(outcome(disarmDelivered(projects, { id: 'station', projectId: 'research' }, canvas))).toEqual([
      'code/reviewer',
      'code/judge'
    ])
  })

  it('clears the STORED copy of an on-screen launch whose project was switched away mid-paste', () => {
    // A switch commits the live canvas — this node still armed — BEFORE it swaps it out, so clearing
    // the live copy (all the on-screen path used to do) found nothing and left the stored one armed.
    const canvas = { nodesProjectId: 'research', activeProjectId: 'research', holds: false }
    expect(outcome(disarmDelivered(projects, { id: 'reviewer', projectId: 'code' }, canvas))).toEqual([
      'code/judge',
      'research/station'
    ])
    // Pure: the store's own array is untouched — the caller hands the new one to setState.
    expect(outcome(projects)).toEqual(['code/reviewer', 'code/judge', 'research/station'])
  })

  it('clears the STORED copy mid-switch — the store names the next project while the canvas holds this one', () => {
    // The live copy is about to be replaced unsaved (`canCommitCanvas` refuses it), so a clear there
    // would be thrown away with it; the switch already committed the armed copy to the store.
    const canvas = { nodesProjectId: 'code', activeProjectId: 'research', holds: true }
    expect(outcome(disarmDelivered(projects, { id: 'reviewer', projectId: 'code' }, canvas))).toEqual([
      'code/judge',
      'research/station'
    ])
  })

  it('touches nothing when the project it was fired from is gone', () => {
    const canvas = { nodesProjectId: 'research', activeProjectId: 'research', holds: false }
    expect(outcome(disarmDelivered(projects, { id: 'reviewer', projectId: 'gone' }, canvas))).toEqual([
      'code/reviewer',
      'code/judge',
      'research/station'
    ])
  })
})

/**
 * After a relaunch the live `state` is empty, and an idle station reports nothing, so a station
 * that had finished before the restart read "unknown" forever and everything armed behind it — a
 * `verify` panel, an `--after` chain — sat as a bare shell (2026-09-11: two panels stranded for half
 * an hour behind targets that had finished before a relaunch). `lastTurnClean` is the persisted
 * record of a clean end; any live signal outranks it.
 */
describe('after a restart — a persisted clean end (`lastTurnClean`)', () => {
  const live = new Set(['a', 'c'])

  it('fires on a persisted clean end when nothing newer is known', () => {
    expect(launchesToFire([armed('c', ['a'])], { a: { lastTurnClean: true } }, live)).toEqual([
      { id: 'c', command: 'echo c' }
    ])
  })

  it('holds when the live status says the station is busy again', () => {
    for (const state of ['working', 'blocked', 'waiting'] as const) {
      expect(
        launchesToFire([armed('c', ['a'])], { a: { state, lastTurnClean: true } }, live),
        state
      ).toEqual([])
    }
  })

  it('holds when the last turn errored', () => {
    const errored: StatusById = { a: { lastTurnClean: true, lastTurnError: { at: 1 } } }
    expect(launchesToFire([armed('c', ['a'])], errored, live)).toEqual([])
  })

  it('holds when no clean end was persisted', () => {
    expect(launchesToFire([armed('c', ['a'])], { a: {} }, live)).toEqual([])
    expect(unmetDeps(armed('c', ['a']), { a: { lastTurnClean: false } }, live)).toEqual(['a'])
  })
})

/**
 * A held launch is typed only at a shell prompt. After a relaunch a node can still be armed on disk
 * although its launch LANDED last run — the disarm was lost to a quit inside the save debounce, to a
 * quit (nothing saves on quit) or to a paused autosave — and with its dep's clean end surviving the
 * relaunch (`lastTurnClean`) the launch fired again, into the agent the first paste started.
 */
describe('pasteIntoShell — a held launch is pasted only where a shell holds the pane', () => {
  const io = (pane: string | null, accepted = true) => {
    const log: string[] = []
    return {
      log,
      paneCommand: async (id: string) => {
        log.push(`pane ${id}`)
        return pane
      },
      send: async (id: string, command: string) => {
        log.push(`send ${id}: ${command}`)
        return accepted
      }
    }
  }

  it('skips a node whose pane runs something else — the agent its launch already started', async () => {
    const fake = io('claude')
    expect(await pasteIntoShell('reviewer', 'claude "review"', fake)).toBe(false)
    expect(fake.log).toEqual(['pane reviewer'])
  })

  it('skips a pane it could not see — unknown is never a shell prompt', async () => {
    const fake = io(null)
    expect(await pasteIntoShell('reviewer', 'claude "review"', fake)).toBe(false)
    expect(fake.log).toEqual(['pane reviewer'])
  })

  it('pastes at a shell prompt, and answers what the paste answered', async () => {
    const landed = io('-zsh')
    expect(await pasteIntoShell('reviewer', 'claude "review"', landed)).toBe(true)
    expect(landed.log).toEqual(['pane reviewer', 'send reviewer: claude "review"'])
    // A refused paste stays refused: the caller's backoff and badge take it from there.
    expect(await pasteIntoShell('reviewer', 'claude "review"', io('zsh', false))).toBe(false)
  })
})

/**
 * The off-screen pass itself: which of `storedLaunchesToFire`'s launches are pasted, and what becomes
 * of each. Canvas hands it its in-flight and refused sets, the pane check, the paste and the disarm;
 * here those are fakes that log what was asked of them.
 */
describe('deliverInBackground — the off-screen pass', () => {
  const launch = { projectId: 'code', id: 'reviewer', command: 'echo reviewer' }
  const fakes = (pane: string | null = 'zsh') => {
    const log: string[] = []
    return {
      log,
      io: {
        isReady: () => true,
        paneCommand: async (id: string) => {
          log.push(`pane ${id}`)
          return pane
        },
        send: async (id: string, command: string) => {
          log.push(`send ${id}: ${command}`)
          return true
        },
        disarm: (id: string, projectId: string) => void log.push(`disarm ${projectId}/${id}`)
      }
    }
  }

  it('skips a launch in flight — its own included, while the first paste is still out', async () => {
    // The effect re-runs on every `nodes` change: a pass that starts before the last one's paste
    // resolved must find the id already in flight, or the launch is typed twice.
    const { log, io } = fakes()
    const inFlight = new Set<string>()
    const refused = new Set<string>()
    const first = deliverInBackground([launch], inFlight, refused, io)
    const second = deliverInBackground([launch], inFlight, refused, io)
    await Promise.all([first, second])
    expect(log.filter((l) => l.startsWith('send'))).toEqual(['send reviewer: echo reviewer'])
  })

  it('skips a launch refused before — the on-screen loop and its badge take it', async () => {
    const { log, io } = fakes()
    await deliverInBackground([launch], new Set(), new Set(['reviewer']), io)
    expect(log).toEqual([])
  })

  it('skips a node whose pane is not at a shell prompt, and leaves it to the on-screen loop', async () => {
    const { log, io } = fakes('claude')
    const inFlight = new Set<string>()
    const refused = new Set<string>()
    await deliverInBackground([launch], inFlight, refused, io)
    expect(log).toEqual(['pane reviewer'])
    // Out of flight and marked refused, as a refused paste is: never retried from the background.
    expect([...inFlight]).toEqual([])
    expect([...refused]).toEqual(['reviewer'])
  })

  it('delivers, then disarms the copy in the project it was fired from — and keeps it in flight', async () => {
    const { log, io } = fakes()
    const inFlight = new Set<string>()
    await deliverInBackground([launch], inFlight, new Set(), io)
    expect(log).toEqual(['pane reviewer', 'send reviewer: echo reviewer', 'disarm code/reviewer'])
    // Exactly-once: a delivered id never leaves the in-flight set.
    expect([...inFlight]).toEqual(['reviewer'])
  })
})
