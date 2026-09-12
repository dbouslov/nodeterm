import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform, type FakePlatform } from './platform-fake'
import { IPC } from '../shared/ipc'
import { DEFAULT_SETTINGS } from '../shared/types'
import { sessionName } from './tmux-naming'
import { PANE_OWNER_FMT } from './agents/pane-owner'
import {
  createDeliveryQueue,
  deliverFromControl,
  type AgentMessagingDeps
} from './agents/agent-messaging'
import { resetMessageFlow } from './agents/agent-message-flow'
import { resetAgentMessageTraceForTests } from './agents/agent-message-trace'
import { paneOwnerProject, resetPaneOwnershipForTests } from './agents/pane-ownership'
import { MANAGED_SCRIPT_REVISION } from './agents/hooks/managed-script'
import type { MirrorEntry } from './agent-status-mirror'
import type { PtyManager } from './pty-manager'

/**
 * MESSAGING A PARKED SESSION: `send` / `reply` / `notify` used to answer `targetGone` for a chat
 * that was alive.
 *
 * "Parked" is the state the renderer leaves an off-screen node in: its painter pty client is
 * released (the last view's `pty:kill`, or the idle reap), so the manager holds no `Session` for it,
 * while the tmux session and the agent inside it run on (`attached=0` in `tmux ls`). Everything the
 * delivery does to the pane addresses tmux by session NAME, so nothing about that state stops a
 * message from landing; the liveness fact was the one thing that asked the painter registry.
 *
 * The deps are wired the way the desktop wires them (src/main/index.ts), with the REAL `PtyManager`
 * methods behind `paneOwner`, `sendEnvelope` and `hasLiveSession`, and the pane is released through
 * the real `pty:create` / `pty:kill` handlers rather than by editing private state. No tmux runs:
 * child_process and node-pty are mocked, and the fake answers the way a session running `claude`
 * would.
 */

const NODE = 'b1'
const TARGET = sessionName(NODE)
const TTY = '/dev/ttys009'
const ALICE = 1

/** What the fake tmux knows, and every call it was asked. */
const tmux = vi.hoisted(() => ({
  /** Session names on OUR socket; `has-session` answers from this. */
  live: new Set<string>(),
  /** Every tmux call fails the way a spawn failure does (no numeric exit code): tmux could not be asked. */
  unreachable: false,
  calls: [] as Array<{ file: string; args: string[]; stdin?: string }>
}))
const spawned = vi.hoisted(() => [] as Array<{ killed: boolean }>)

vi.mock('child_process', () => {
  type Out = { stdout: string; stderr: string }
  const answer = (file: string, args: string[]): Out => {
    const out = (stdout: string): Out => ({ stdout, stderr: '' })
    if (args[0] === '-ilc') return out('__NT_PATH_START__/usr/bin:/bin__NT_PATH_END__')
    // `paneOwner`'s second read: the pane's shell, and `claude` holding the foreground group.
    if (file === 'ps') return out('  100   100 Ss   -zsh\n  200   200 S+   claude\n')
    if (tmux.unreachable) throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' })
    if (args.includes('has-session')) {
      const t = args[args.indexOf('-t') + 1]
      // tmux's own lookup, measured on the bundled tmux 3.7b: `=name` is that session and no other;
      // a bare name that is no session falls back to the ONE live session whose name it begins.
      const found = t.startsWith('=')
        ? tmux.live.has(t.slice(1))
        : tmux.live.has(t) || [...tmux.live].filter((s) => s.startsWith(t)).length === 1
      if (found) return out('')
      // tmux's own exit 1: the only answer `probeSaysAbsent` reads as "gone".
      throw Object.assign(new Error("can't find session"), { code: 1 })
    }
    // `paneOwner`'s first read: pane pid | tty | foreground command | pane id.
    if (args.includes(PANE_OWNER_FMT)) return out(`100|${TTY}|claude|%1\n`)
    return out('')
  }
  const execFile = (file: string, args: string[], a?: unknown, b?: unknown): unknown => {
    const cb = (typeof a === 'function' ? a : b) as ((err: Error | null, res?: Out) => void) | undefined
    tmux.calls.push({ file, args })
    let res: Out
    try {
      res = answer(file, args)
    } catch (e) {
      cb?.(e as Error)
      return {}
    }
    cb?.(null, res)
    return {}
  }
  // pty-manager promisifies `execFile`, and `runWithStdin` (the paste leg of `sendEnvelope`) reads
  // the child's stdin off the returned PROMISE, which only Node's own promisified `execFile`
  // carries. So the mock supplies that variant too: same answers, plus the stdin the paste wrote.
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: (file: string, args: string[]) => {
      const call: { file: string; args: string[]; stdin?: string } = { file, args }
      tmux.calls.push(call)
      const settled = new Promise<Out>((resolve, reject) => {
        queueMicrotask(() => {
          try {
            resolve(answer(file, args))
          } catch (e) {
            reject(e)
          }
        })
      })
      const stdin = {
        on: () => stdin,
        end: (input: string) => {
          call.stdin = input
        }
      }
      return Object.assign(settled, { child: { stdin } })
    }
  })
  return { execFile, execFileSync: (): string => '' }
})

vi.mock('node-pty', () => ({
  spawn: () => {
    const p = { killed: false }
    spawned.push(p)
    return {
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: () => {
        p.killed = true
      },
      pid: 1
    }
  }
}))

/** Hermetic tmux resolution (issue #160), as in pty-single-user.test.ts: never the host's tmux. */
vi.mock('./tmux-hint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tmux-hint')>()),
  findFixedTmux: () => '/usr/bin/tmux'
}))

/** A machine with pty devices to spare, as in pty-single-user.test.ts. */
vi.mock('./pty-devices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pty-devices')>()),
  readPtyDevices: () => ({ ceiling: 511, inUse: 8 })
}))

/**
 * Pinned off the session-host backend, as in pty-single-user.test.ts: `sessionHostSupported()` only
 * asks whether out/session-host/host.cjs is on disk, so a checkout that ran a build would otherwise
 * reach a real session-host client from here. Two exports stay steerable, so one case can turn the
 * bundle "on" and see whether anything asked the host.
 */
const host = vi.hoisted(() => ({ supported: false, asked: [] as string[] }))
vi.mock('./session-host-backend', async () => ({
  ...(await import('./__fixtures__/no-session-host')).noSessionHost(),
  sessionHostSupported: () => host.supported,
  // What the real client does when no host answers: reject, once its connect attempt gives up.
  sessionHostHasSession: async (name: string) => {
    host.asked.push(name)
    throw new Error('session host unreachable')
  }
}))

const idle: MirrorEntry = {
  state: 'done',
  updatedAt: 1,
  stateVerified: true,
  clientRevision: MANAGED_SCRIPT_REVISION
}

const req = (over: Record<string, unknown> = {}) =>
  ({ verb: 'send', sourceNodeId: 'a1', targetNodeId: NODE, body: 'hello', ...over }) as never

const paneReads = () => tmux.calls.filter((c) => c.args.includes(PANE_OWNER_FMT))
const pastes = () => tmux.calls.filter((c) => c.args.includes('paste-buffer'))
const livenessProbes = () => tmux.calls.filter((c) => c.args.includes('has-session'))

// Skipped on Windows: `findTmux` goes straight to the PATH there and never asks `findFixedTmux`, so
// this manager would be the plain-shell fallback and the file would prove nothing about tmux.
describe.skipIf(process.platform === 'win32')('messaging a parked session (painter released, tmux session up)', () => {
  let fake: FakePlatform
  let userDataDir: string

  beforeEach(() => {
    spawned.length = 0
    tmux.calls.length = 0
    tmux.live.clear()
    tmux.unreachable = false
    host.supported = false
    host.asked.length = 0
    resetMessageFlow()
    resetAgentMessageTraceForTests()
    resetPaneOwnershipForTests()
    // Only the manager's two sweeps (snapshot, idle reap) are faked, so they never fire against a
    // reset platform. Timeouts stay real: the receipt and the pane probe's deadline run on them.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-parked-'))
    fake = fakePlatform({ userDataDir })
    initPlatform(fake)
  })
  afterEach(() => {
    vi.useRealTimers()
    resetPlatformForTests()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
    } catch {
      /* a temp dir we could not remove is not a test result */
    }
  })

  /** Open the node, then let its last view go: exactly what parking an off-screen pane does. */
  async function parked(): Promise<PtyManager> {
    const { PtyManager } = await import('./pty-manager')
    const m = new PtyManager()
    m.init(() => DEFAULT_SETTINGS)
    m.registerIpc()
    tmux.live.add(TARGET)
    const { sessionId } = (await fake.handlers[IPC.ptyCreate](ALICE, {
      cols: 80,
      rows: 24,
      persistKey: NODE
    })) as { sessionId: string }
    fake.senderListeners[IPC.ptyKill](ALICE, sessionId)
    // The state the bug report measured: the painter is gone, the tmux session is not.
    expect(spawned).toHaveLength(1)
    expect(spawned[0].killed).toBe(true)
    tmux.calls.length = 0
    return m
  }

  function deps(m: PtyManager, over: Partial<AgentMessagingDeps> = {}): AgentMessagingDeps {
    return {
      // Wired as src/main/index.ts wires them. The Server Edition differs only in `sendEnvelope`,
      // whose settled paste also addresses tmux by name (src/server/settled-envelope.ts).
      paneOwner: (id) => m.paneOwner(id),
      sendEnvelope: (id, envelope) => m.sendEnvelope(id, envelope),
      hasLiveSession: (id) => m.hasLiveSession(id),
      isRemoteNode: (id) => !!m.sshRemoteForNode(id),
      mirrorEntry: () => idle,
      projects: () => [
        {
          id: 'p1',
          nodes: [
            { id: 'a1', title: 'Alpha', agentId: 'claude' },
            { id: NODE, title: 'Beta', agentId: 'claude' }
          ]
        }
      ],
      messagingEnabled: () => true,
      paneOwnerProject: () => 'p1',
      customAgents: () => undefined,
      appendBoardLog: async () => false,
      // The target's own next turn, verified: what its hook POST produces once it reads the message.
      subscribeReceipts: (cb) => {
        const t = setTimeout(() => cb({ nodeId: NODE, newTurn: true, verified: true }), 5)
        return () => clearTimeout(t)
      },
      now: () => 1_000_000,
      ...over
    }
  }

  /**
   * Open the chat the way `open-claude` does (no tmux session yet, so this create is the spawn the
   * ownership ledger records), park it, and bring it back on screen: the cycle the report measured
   * (`attached=0`, then `attached=1`, the agent alive throughout). The re-mount is an attach and
   * records nothing; `remountOwner` is the project whose canvas re-opened the node id.
   */
  async function openedParkedRemounted(remountOwner = 'p1'): Promise<PtyManager> {
    const { PtyManager } = await import('./pty-manager')
    const m = new PtyManager()
    m.init(() => DEFAULT_SETTINGS)
    m.registerIpc()
    const opts = { cols: 80, rows: 24, persistKey: NODE }
    const opened = (await fake.handlers[IPC.ptyCreate](ALICE, { ...opts, ownerProjectId: 'p1' })) as {
      sessionId: string
      fresh: boolean
    }
    expect(opened.fresh).toBe(true)
    tmux.live.add(TARGET) // what that spawn's `tmux new-session` brought into being
    fake.senderListeners[IPC.ptyKill](ALICE, opened.sessionId)
    const back = (await fake.handlers[IPC.ptyCreate](ALICE, {
      ...opts,
      ownerProjectId: remountOwner
    })) as { fresh: boolean }
    expect(back.fresh).toBe(false)
    tmux.calls.length = 0
    return m
  }

  it('delivers to it by session name, as to an on-screen node, without spawning a painter', async () => {
    const m = await parked()

    const { outcome } = await deliverFromControl(req(), deps(m))

    expect(outcome.kind).toBe('delivered')
    expect(pastes()).toHaveLength(1)
    expect(pastes()[0].args).toContain(TARGET)
    expect(pastes()[0].stdin).toContain('hello')
    // Reaching the pane cost no pty device: the only one ever spawned is the released painter.
    expect(spawned).toHaveLength(1)
  })

  it('queues it while the parked agent is mid-turn, instead of calling it gone', async () => {
    const m = await parked()
    const d = deps(m, { mirrorEntry: () => ({ ...idle, state: 'working' }) })
    const queue = createDeliveryQueue(d)
    d.queue = queue
    try {
      const { outcome } = await deliverFromControl(req(), d)

      expect(outcome.kind).toBe('queued')
      expect(pastes()).toEqual([])
    } finally {
      queue.resetForTests()
    }
  })

  it('answers targetGone once tmux itself says the session is gone', async () => {
    const m = await parked()
    tmux.live.delete(TARGET)

    const { outcome } = await deliverFromControl(req(), deps(m))

    expect(outcome).toEqual({ kind: 'targetGone' })
    // Decided before the pane was read or written.
    expect(paneReads()).toEqual([])
    expect(pastes()).toEqual([])
  })

  it('a registered session is live without asking tmux: never targetGone, no has-session', async () => {
    const { PtyManager } = await import('./pty-manager')
    const m = new PtyManager()
    m.init(() => DEFAULT_SETTINGS)
    m.registerIpc()
    tmux.live.add(TARGET)
    await fake.handlers[IPC.ptyCreate](ALICE, { cols: 80, rows: 24, persistKey: NODE })
    // The painter stays registered while the local tmux reads the session absent: what a live
    // SSH-remote chat looks like from the local socket, since its session is on the remote tmux.
    tmux.live.clear()
    tmux.calls.length = 0

    const { outcome } = await deliverFromControl(req(), deps(m))

    expect(outcome.kind).toBe('delivered')
    expect(livenessProbes()).toEqual([])
  })

  it('does not call it gone when tmux could not be asked: the pane read refuses it instead', async () => {
    const m = await parked()
    tmux.unreachable = true

    const { outcome } = await deliverFromControl(req(), deps(m))

    // A failed read is never evidence of absence, and gate 1 stays fail-closed on what it cannot see.
    expect(outcome).toEqual({ kind: 'targetPaneUnreadable' })
    expect(pastes()).toEqual([])
  })

  it('asks tmux alone: a gone session stays targetGone where a session-host bundle is installed', async () => {
    const m = await parked()
    tmux.live.delete(TARGET)
    // out/session-host/host.cjs on disk: a Server Edition image, `npm run dev` after a build. Asking a
    // host that is not running starts one and waits out its connect, and a failed ask reads "exists".
    host.supported = true

    const { outcome } = await deliverFromControl(req(), deps(m))

    expect(outcome).toEqual({ kind: 'targetGone' })
    expect(host.asked).toEqual([])
    expect(pastes()).toEqual([])
  })

  it('answers targetGone when the only live session merely starts with its name', async () => {
    const m = await parked()
    tmux.live.delete(TARGET)
    // Another node's session: `nt-b12` begins with `nt-b1`, so a bare `-t nt-b1` finds it, and the
    // message would be typed into that node's pane.
    tmux.live.add(sessionName('b12'))

    const { outcome } = await deliverFromControl(req(), deps(m))

    expect(outcome).toEqual({ kind: 'targetGone' })
    expect(paneReads()).toEqual([])
    expect(pastes()).toEqual([])
  })

  it('a caller refused by the switch or the rate limiter never pays for the liveness probe', async () => {
    const m = await parked()

    const off = await deliverFromControl(req(), deps(m, { messagingEnabled: () => false }))
    expect(off.outcome).toEqual({ kind: 'notPermitted', reason: 'switch-off' })
    expect(livenessProbes()).toEqual([])

    const d = deps(m)
    expect((await deliverFromControl(req(), d)).outcome.kind).toBe('delivered')
    tmux.calls.length = 0
    const again = await deliverFromControl(req({ body: 'again' }), d)
    expect(again.outcome.kind).toBe('rateLimited')
    expect(livenessProbes()).toEqual([])
  })

  // The cases above stub `paneOwnerProject`. These read the real runtime ledger, which only the
  // manager's own create and end paths write.
  describe('who may message it after a park: the real ownership ledger', () => {
    it("a chat its opener parked and brought back is still its opener's to message", async () => {
      const m = await openedParkedRemounted()

      const { outcome } = await deliverFromControl(req(), deps(m, { paneOwnerProject }))

      expect(outcome.kind).toBe('delivered')
      expect(pastes()).toHaveLength(1)
      expect(pastes()[0].args).toContain(TARGET)
    })

    it('queues it for its opener while the re-mounted agent is mid-turn', async () => {
      const m = await openedParkedRemounted()
      const d = deps(m, { paneOwnerProject, mirrorEntry: () => ({ ...idle, state: 'working' }) })
      const queue = createDeliveryQueue(d)
      d.queue = queue
      try {
        const { outcome } = await deliverFromControl(req(), d)

        expect(outcome.kind).toBe('queued')
        expect(pastes()).toEqual([])
      } finally {
        queue.resetForTests()
      }
    })

    it('another project that re-opens the same node id is still refused', async () => {
      const m = await openedParkedRemounted('p2')
      // p2's git-shared project.json lists its own caller and the node id p1 spawned.
      const hostile = deps(m, {
        paneOwnerProject,
        projects: () => [
          {
            id: 'p2',
            nodes: [
              { id: 'c1', title: 'Gamma', agentId: 'claude' },
              { id: NODE, title: 'Beta', agentId: 'claude' }
            ]
          }
        ]
      })

      const { outcome } = await deliverFromControl(req({ sourceNodeId: 'c1' }), hostile)

      expect(outcome).toEqual({ kind: 'notPermitted', reason: 'unproven-target-owner' })
      // Its re-mount was an attach: nothing recorded p2.
      expect(paneOwnerProject(NODE)).toBe('p1')
      expect(pastes()).toEqual([])
    })

    it('a chat this run only attached to (opened before a restart) is still refused', async () => {
      // `parked()` finds the tmux session already up at its first create: an attach, not a spawn.
      const m = await parked()

      const { outcome } = await deliverFromControl(req(), deps(m, { paneOwnerProject }))

      expect(outcome).toEqual({ kind: 'notPermitted', reason: 'unproven-target-owner' })
      expect(pastes()).toEqual([])
    })

    it('a chat closed while parked is no longer owned', async () => {
      const m = await openedParkedRemounted()
      const { sessionId } = (await fake.handlers[IPC.ptyCreate](ALICE, {
        cols: 80,
        rows: 24,
        persistKey: NODE
      })) as { sessionId: string }
      fake.senderListeners[IPC.ptyKill](ALICE, sessionId)

      await fake.handlers[IPC.ptyDestroy](ALICE, NODE)

      expect(paneOwnerProject(NODE)).toBeUndefined()
      const { outcome } = await deliverFromControl(req(), deps(m, { paneOwnerProject }))
      expect(outcome).toEqual({ kind: 'notPermitted', reason: 'unproven-target-owner' })
    })
  })
})
