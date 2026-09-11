import { describe, it, expect } from 'vitest'
import {
  coldFileIntoSourceFrame,
  coldGroupCwd,
  coldOpenMessage,
  coldPlaceBelow,
  coldResolveAfter,
  coldResolveGroup,
  offCanvasNoticeText,
  offCanvasReplyClause,
  storedAgentIdOf,
  type ColdNode
} from './coldOpen'

const N = (id: string, extra: Partial<ColdNode> = {}): ColdNode => ({
  id,
  position: { x: 0, y: 0 },
  ...extra
})

const hasHooks = (a: string) => ['claude', 'codex', 'gemini', 'grok'].includes(a)

describe('storedAgentIdOf — the serialized counterpart of Canvas.agentIdOf', () => {
  it('reads the persisted agentId', () => {
    expect(storedAgentIdOf(N('a', { agentId: 'codex' }))).toBe('codex')
  })

  it('migrates the legacy tags marker', () => {
    expect(storedAgentIdOf(N('a', { tags: ['claude'] }))).toBe('claude')
  })

  it('falls back to live agent status — a hand-launched CLI is known nowhere else', () => {
    expect(storedAgentIdOf(N('a'), (id) => (id === 'a' ? 'gemini' : undefined))).toBe('gemini')
  })

  it('answers nothing for a non-terminal node, whatever it carries', () => {
    // A group frame or a sticky is not a session. Reading an agent off one would let `--after`
    // wait on something that can never report.
    expect(storedAgentIdOf(N('g', { kind: 'group', agentId: 'claude' }))).toBeUndefined()
    expect(storedAgentIdOf(undefined)).toBeUndefined()
  })
})

describe('coldResolveGroup', () => {
  const nodes = [N('g1', { kind: 'group' }), N('t1'), N('s1', { kind: 'sticky' })]

  it('passes through when the flag is absent', () => {
    expect(coldResolveGroup(nodes, undefined, 'open-claude')).toEqual({ ok: true })
  })

  it('resolves an existing frame', () => {
    expect(coldResolveGroup(nodes, 'g1', 'open-claude')).toEqual({ ok: true, groupId: 'g1' })
  })

  it('refuses a name that is not a frame, with the live path’s sentence', () => {
    // Unlike `--project` (which refuses --group outright because the id would live in ANOTHER
    // project), here the target project IS the caller's own, so the id is resolvable — a refusal
    // must therefore only fire for a genuinely wrong id.
    for (const id of ['t1', 's1', 'nope']) {
      expect(coldResolveGroup(nodes, id, 'open-agent')).toEqual({
        ok: false,
        error: 'open-agent: --group must name an existing group frame'
      })
    }
  })
})

describe('coldGroupCwd', () => {
  it('takes the nearest ancestor frame’s worktree path', () => {
    const nodes = [
      N('outer', { kind: 'group', worktree: { path: '/wt/feature' } }),
      N('inner', { kind: 'group', parentId: 'outer' })
    ]
    expect(coldGroupCwd(nodes, 'inner', false)).toBe('/wt/feature')
  })

  it('prefers a frame’s own cwd over an ancestor’s worktree', () => {
    const nodes = [
      N('outer', { kind: 'group', worktree: { path: '/wt/feature' } }),
      N('inner', { kind: 'group', parentId: 'outer', cwd: '/repo/sub' })
    ]
    expect(coldGroupCwd(nodes, 'inner', false)).toBe('/repo/sub')
  })

  it('never hands out a worktree path on an SSH project', () => {
    // A worktree path was computed from the LOCAL data dir and means nothing on the host —
    // the same rule `cwdForNewNodeIn` states for the live path.
    const nodes = [N('g', { kind: 'group', worktree: { path: '/wt/feature' } })]
    expect(coldGroupCwd(nodes, 'g', true)).toBeUndefined()
  })

  it('answers undefined for no group, an unknown group, and a bare frame', () => {
    expect(coldGroupCwd([], undefined, false)).toBeUndefined()
    expect(coldGroupCwd([], 'ghost', false)).toBeUndefined()
    expect(coldGroupCwd([N('g', { kind: 'group' })], 'g', false)).toBeUndefined()
  })

  it('terminates on a parent cycle rather than hanging the dispatch', () => {
    // project.json is hand-editable, git-shared input; a cycle there must not spin the handler.
    const nodes = [
      N('a', { kind: 'group', parentId: 'b' }),
      N('b', { kind: 'group', parentId: 'a' })
    ]
    expect(coldGroupCwd(nodes, 'a', false)).toBeUndefined()
  })
})

describe('coldResolveAfter', () => {
  const nodes = [
    N('agent1', { agentId: 'claude' }),
    N('agent2', { agentId: 'codex' }),
    N('plain'),
    N('frame', { kind: 'group' })
  ]

  it('passes through when the flag is absent or empty', () => {
    expect(coldResolveAfter(nodes, undefined, 'open-claude', hasHooks)).toEqual({ ok: true })
    expect(coldResolveAfter(nodes, ' , ', 'open-claude', hasHooks)).toEqual({ ok: true })
  })

  it('dedupes — `--after a,a` is ONE wait', () => {
    // Two dep ropes for one pair would collide on the single id `ctrl-a-<node>`.
    expect(coldResolveAfter(nodes, 'agent1,agent1', 'open-claude', hasHooks)).toEqual({
      ok: true,
      after: ['agent1']
    })
  })

  it('refuses an id that names no node', () => {
    expect(coldResolveAfter(nodes, 'ghost', 'open-claude', hasHooks)).toEqual({
      ok: false,
      error: 'open-claude: --after names no existing node (ghost)'
    })
  })

  it('refuses a plain terminal — it never reports finishing, so the wait would never end', () => {
    expect(coldResolveAfter(nodes, 'plain', 'open-terminal', hasHooks)).toEqual({
      ok: false,
      error: 'open-terminal: --after plain is not an agent session that reports when it is done'
    })
  })

  it('refuses a group frame', () => {
    expect(coldResolveAfter(nodes, 'frame', 'open-claude', hasHooks).ok).toBe(false)
  })

  it('accepts a node whose agent is known only from live status', () => {
    expect(
      coldResolveAfter(nodes, 'plain', 'open-claude', hasHooks, (id) =>
        id === 'plain' ? 'claude' : undefined
      )
    ).toEqual({ ok: true, after: ['plain'] })
  })
})

describe('coldPlaceBelow — the live path’s placeBelow, off persisted geometry', () => {
  it('centers below the source and fans siblings right', () => {
    const src = N('src', { position: { x: 100, y: 200 }, size: { width: 600, height: 400 } })
    // top-left (100, 200 + 400 + ROW_GAP 80), a 600×400 node → center (+300, +200); siblings step
    // one node width + PLACEMENT_GAP (640) to the right.
    expect(coldPlaceBelow([src], src, 0)).toEqual({ x: 400, y: 880 })
    expect(coldPlaceBelow([src], src, 1)).toEqual({ x: 1040, y: 880 })
  })

  it('resolves a grouped source to ROOT space', () => {
    // A stored child's position is frame-relative; placing off it directly would land the new
    // node by the frame's own offset away from the agent it hangs from.
    const frame = N('g', { kind: 'group', position: { x: 1000, y: 1000 } })
    const src = N('src', {
      parentId: 'g',
      position: { x: 10, y: 20 },
      size: { width: 600, height: 400 }
    })
    expect(coldPlaceBelow([frame, src], src, 0)).toEqual({ x: 1310, y: 1700 })
  })

  it('falls back to the default node size when none is persisted', () => {
    const src = N('src', { position: { x: 0, y: 0 } })
    expect(coldPlaceBelow([src], src, 0)).toEqual({ x: 300, y: 680 })
  })

  it('does not stack two siblings when the first is passed back as reserved', () => {
    const src = N('src', { position: { x: 0, y: 0 }, size: { width: 600, height: 400 } })
    const a = coldPlaceBelow([src], src, 0)
    const b = coldPlaceBelow([src], src, 0, { reserved: [{ x: a.x - 300, y: a.y - 200, w: 600, h: 400 }] })
    expect(b).not.toEqual(a)
    expect(b.x).toBeGreaterThan(a.x)
  })

  it('an --after dependent goes RIGHT of its dep, the live rule (waiting on the opener stays below)', () => {
    const src = N('src', { position: { x: 0, y: 0 }, size: { width: 600, height: 400 } })
    const dep = N('dep', { position: { x: 0, y: 1000 }, size: { width: 600, height: 400 } })
    // top-left (600 + PLACEMENT_GAP 40, 1000), a 600×400 node → center (+300, +200)
    expect(coldPlaceBelow([src, dep], src, 0, { deps: [dep] })).toEqual({ x: 940, y: 1200 })
    expect(coldPlaceBelow([src, dep], src, 0, { deps: [src] })).toEqual(coldPlaceBelow([src, dep], src, 0))
  })
})

describe('coldFileIntoSourceFrame — a framed source keeps what it opens inside its frame', () => {
  // A frame hugging its source; the node placed below the source (ROOT space, 1056 + 400 + ROW_GAP
  // 80) is past the frame's bottom edge, where extent:'parent' would clamp it onto the source.
  const g = N('g', { kind: 'group', position: { x: 1000, y: 1000 }, size: { width: 648, height: 510 } })
  const src = N('src', { parentId: 'g', position: { x: 24, y: 56 }, size: { width: 600, height: 400 } })
  const placed = { x: 1024, y: 1536, w: 600, h: 400 }

  it('files each placed node into the frame, frame-relative, and grows the frame right and down to hold it', () => {
    const r = coldFileIntoSourceFrame([g, src], src, [placed])
    expect(r.frameId).toBe('g')
    expect(r.positions).toEqual([{ x: 24, y: 536 }])
    // Grow-only, never moved (the cold --group rule): the farthest child edge + GROUP_PAD_X (24).
    expect(r.frames).toEqual([{ id: 'g', size: { width: 648, height: 536 + 400 + 24 } }])
  })

  it('grows every frame up the chain', () => {
    const outer = N('outer', { kind: 'group', position: { x: 900, y: 900 }, size: { width: 800, height: 660 } })
    const inner = { ...g, parentId: 'outer', position: { x: 100, y: 100 } } // root (1000, 1000), as before
    const r = coldFileIntoSourceFrame([outer, inner, src], src, [placed])
    expect(r.positions).toEqual([{ x: 24, y: 536 }])
    expect(r.frames).toEqual([
      { id: 'g', size: { width: 648, height: 960 } },
      { id: 'outer', size: { width: 800, height: 100 + 960 + 24 } }
    ])
  })

  it('files nothing for a top-level source, or one whose frame is gone', () => {
    const loose = N('loose', { position: { x: 0, y: 0 } })
    const orphan = N('orphan', { parentId: 'gone', position: { x: 0, y: 0 } })
    for (const s of [loose, orphan]) {
      expect(coldFileIntoSourceFrame([loose, orphan], s, [placed])).toEqual({
        positions: [{ x: 1024, y: 1536 }],
        frames: []
      })
    }
  })
})

describe('coldOpenMessage — ONE sentence for both cold-open sites', () => {
  it('names the count, the agent, the project and the ids, and says when it starts', () => {
    expect(coldOpenMessage(2, 'claude', 'Backend', ['t1', 't2'])).toBe(
      'opened 2 claude session(s) in "Backend" (t1, t2) — queued; starts when that project is next viewed'
    )
  })

  it('adds — and only adds — a clause when the project is CLOSED', () => {
    // The base sentence must stay byte-identical, because the `--project` branch emits it too and
    // an orchestrator should not have to learn two phrasings for one outcome.
    const open = coldOpenMessage(1, 'terminal', 'Docs', ['t1'])
    const closed = coldOpenMessage(1, 'terminal', 'Docs', ['t1'], { closed: true })
    expect(closed.startsWith(open)).toBe(true)
    expect(closed).toContain('that project is closed')
  })
})

describe('offCanvasReplyClause — the display verbs\' half of the same event', () => {
  it('is a CLAUSE, so the verb keeps saying what it made', () => {
    // Appended to `showing web nt-3f2a`, not instead of it: only the WHERE is new, which is what
    // lets the four case bodies stay ignorant of routing.
    expect(offCanvasReplyClause('api')).toBe(
      ' — placed in "api"; that project is not on screen'
    )
  })

  it('adds — and only adds — a clause when the project is CLOSED', () => {
    const open = offCanvasReplyClause('api')
    const closed = offCanvasReplyClause('api', { closed: true })
    expect(closed.startsWith(open)).toBe(true)
    expect(closed).toContain('reopen it from the welcome screen')
  })

  it('never claims the node is queued — it is complete when written', () => {
    // The distinction this builder exists for. A cold-opened SESSION has not started; a page, a
    // video or an image has. Telling a caller its screenshot is "queued" invites it to wait for
    // something that already happened.
    expect(offCanvasReplyClause('api')).not.toContain('queued')
    expect(offCanvasReplyClause('api')).not.toContain('starts when')
  })
})

describe('offCanvasNoticeText — the HUMAN half', () => {
  it('is an active-voice sentence naming the actor and the project', () => {
    expect(offCanvasNoticeText('api', 1)).toBe(
      'An agent opened a node in "api". That project is not on screen.'
    )
  })

  it('counts, rather than saying "a node" for five', () => {
    expect(offCanvasNoticeText('api', 3)).toBe(
      'An agent opened 3 nodes in "api". That project is not on screen.'
    )
  })
})
