import { describe, expect, it } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { WAIT_LABEL } from './edgeModel'
import { buildFindings, buildOverviewGraph, overviewSig, type OverviewInput } from './networkOverview'

const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  title: id.toUpperCase(),
  color: '#888',
  group: null,
  ...extra
})
const agent = (id: string, extra: Partial<CanvasNodeState> = {}) => node(id, { agentId: 'claude', ...extra })
const base = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  nodes: [],
  bridges: [],
  ropes: [],
  statusById: {},
  launchById: {},
  idleMs: 30 * 60_000,
  now: 1_000_000,
  ...over
})

describe('buildFindings', () => {
  it('lists agent recommendations verbatim, newest first, with the byline title', () => {
    const f = buildFindings(
      base({
        nodes: [
          agent('hub'),
          agent('a', { annotation: { recommend: 'close a', by: 'hub', at: 10 } }),
          agent('b', { annotation: { recommend: 'pause b', by: 'gone', at: 20 } })
        ],
        bridges: [
          { id: 'l1', source: 'hub', target: 'a' },
          { id: 'l2', source: 'hub', target: 'b' }
        ]
      })
    )
    const rec = f.filter((x) => x.kind === 'recommend')
    // A byline whose node is gone renders the id (spec §6).
    expect(rec.map((x) => [x.nodeId, x.text, x.byTitle, x.at])).toEqual([
      ['b', 'pause b', 'gone', 20],
      ['a', 'close a', 'HUB', 10]
    ])
    expect(rec.every((x) => x.source === 'agent' && x.severity === 'info')).toBe(true)
  })

  it('re-validates annotations at the point of use: one line, and a record without a byline is none', () => {
    const f = buildFindings(
      base({
        nodes: [
          agent('a', { annotation: { recommend: 'x\ny', by: 'a', at: 1 } }),
          agent('b', { annotation: { recommend: 'forged' } as never })
        ],
        bridges: [{ id: 'l', source: 'a', target: 'b' }]
      })
    )
    expect(f.filter((x) => x.kind === 'recommend').map((x) => [x.nodeId, x.text])).toEqual([['a', 'x y']])
  })

  it("idle: done for Eco's threshold by lastEventAt; never without it; never hibernated/paused/working", () => {
    const now = 10_000_000
    const old = now - 31 * 60_000
    const f = buildFindings(
      base({
        now,
        nodes: [agent('a'), agent('b'), agent('c'), agent('d'), agent('e'), agent('f')],
        bridges: [
          { id: 'x', source: 'a', target: 'b' },
          { id: 'y', source: 'c', target: 'd' },
          { id: 'z', source: 'e', target: 'f' }
        ],
        statusById: {
          a: { unread: false, state: 'done', lastEventAt: old },
          // `stateAt` is freshness, not the idle clock: without `lastEventAt` there is no flag.
          b: { unread: false, state: 'done', stateAt: old },
          c: { unread: false, state: 'done', lastEventAt: old, hibernated: true },
          d: { unread: false, state: 'done', lastEventAt: old, paused: true },
          e: { unread: false, state: 'working', lastEventAt: old },
          // Exactly the threshold counts, as it does for Eco (hibernation-policy.ts).
          f: { unread: false, state: 'done', lastEventAt: now - 30 * 60_000 }
        }
      })
    )
    expect(f.filter((x) => x.kind === 'idle').map((x) => x.nodeId)).toEqual(['a', 'f'])
    expect(f.find((x) => x.kind === 'idle')!.text).toBe('A idle for 31m')
  })

  it('isolated: agent nodes with no bridge or rope in either direction; never a plain terminal or sticky', () => {
    const f = buildFindings(
      base({
        nodes: [agent('a'), agent('b'), agent('c'), agent('d'), node('t'), node('s', { kind: 'sticky' })],
        bridges: [{ id: 'x', source: 'a', target: 'b' }],
        ropes: [{ id: 'r', source: 't', target: 'd' }]
      })
    )
    expect(f.filter((x) => x.kind === 'isolated').map((x) => x.nodeId)).toEqual(['c'])
  })

  it('group-no-lead: two or more direct agent children and none with a lead-ish role', () => {
    const f = buildFindings(
      base({
        nodes: [
          node('g1', { kind: 'group', title: 'Wave 1' }),
          agent('a', { parentId: 'g1', annotation: { role: 'Lead reviewer', by: 'h', at: 1 } }),
          agent('b', { parentId: 'g1' }),
          node('g2', { kind: 'group', title: 'Wave 2' }),
          agent('c', { parentId: 'g2' }),
          agent('d', { parentId: 'g2', annotation: { role: 'tests', by: 'h', at: 1 } }),
          node('g3', { kind: 'group' }),
          agent('e', { parentId: 'g3' })
        ],
        bridges: [
          { id: '1', source: 'a', target: 'b' },
          { id: '2', source: 'c', target: 'd' },
          { id: '3', source: 'a', target: 'e' }
        ]
      })
    )
    const g = f.filter((x) => x.kind === 'group-no-lead')
    expect(g.map((x) => x.groupId)).toEqual(['g2'])
    expect(g[0].text).toBe('Wave 2 has no lead')
  })

  it('group-no-lead: a nested group counts its own members, not its parent', () => {
    const f = buildFindings(
      base({
        nodes: [
          node('outer', { kind: 'group', title: 'Outer' }),
          node('inner', { kind: 'group', title: 'Inner', parentId: 'outer' }),
          agent('x', { parentId: 'inner' }),
          agent('y', { parentId: 'inner' })
        ],
        bridges: [{ id: '1', source: 'x', target: 'y' }]
      })
    )
    expect(f.filter((x) => x.kind === 'group-no-lead').map((x) => x.groupId)).toEqual(['inner'])
  })

  it('carries dropped, turn-failed, paused and stalled/failed launches', () => {
    const f = buildFindings(
      base({
        nodes: [agent('a'), agent('b'), agent('c'), agent('d'), agent('e')],
        bridges: [
          { id: '1', source: 'a', target: 'b' },
          { id: '2', source: 'b', target: 'c' },
          { id: '3', source: 'c', target: 'd' },
          { id: '4', source: 'd', target: 'e' }
        ],
        statusById: {
          a: { unread: false, dropped: true },
          b: { unread: false, lastTurnError: { at: 7 } },
          c: { unread: false, paused: true }
        },
        launchById: { d: { kind: 'stalled', since: 3 }, e: { kind: 'failed', attempts: 3, at: 9 } }
      })
    )
    expect(f.map((x) => [x.kind, x.nodeId])).toEqual([
      ['dropped', 'a'],
      ['turn-failed', 'b'],
      ['stalled-launch', 'd'],
      ['stalled-launch', 'e'],
      ['paused', 'c']
    ])
    expect(f.find((x) => x.kind === 'turn-failed')!.at).toBe(7)
    expect(f.find((x) => x.nodeId === 'e')!.text).toContain('failed after 3 attempts')
    expect(f.find((x) => x.kind === 'paused')!.severity).toBe('info')
  })

  it('orders agent recommendations first, then warn kinds in declared order, then info', () => {
    const f = buildFindings(
      base({
        nodes: [agent('a', { annotation: { recommend: 'r', by: 'a', at: 1 } }), agent('b')],
        statusById: { b: { unread: false, paused: true } }
      })
    )
    expect(f.map((x) => x.kind)).toEqual(['recommend', 'isolated', 'isolated', 'paused'])
  })

  it('an empty status map yields only recommendations and structural flags', () => {
    const f = buildFindings(base({ nodes: [agent('a')] }))
    expect(f.map((x) => x.kind)).toEqual(['isolated'])
  })
})

describe('buildOverviewGraph', () => {
  it('maps nodes with precomputed data, frames first, circuit edges carrying kind and state', () => {
    const input = base({
      nodes: [
        agent('a', { parentId: 'g', annotation: { role: 'lead', by: 'a', at: 1 } }),
        node('g', { kind: 'group', title: 'G' }),
        agent('b', { pendingLaunch: { after: ['a'], command: 'x' } }),
        node('s', { kind: 'sticky', text: 'line one\nline two\nline three' })
      ],
      bridges: [
        { id: 'l', source: 'a', target: 'b' },
        { id: 'n', source: 's', target: 'a' }
      ],
      ropes: [{ id: 'r', source: 'a', target: 'b' }],
      statusById: { a: { unread: true, state: 'working', lastEventAt: 999_000 } }
    })
    const { nodes, edges } = buildOverviewGraph(input, () => '#d97757', buildFindings(input))
    expect(nodes.map((n) => n.id)).toEqual(['g', 'a', 'b', 's'])
    // `group`, not a private type: the edge router treats only `type === 'group'` as a frame.
    expect(nodes[0].type).toBe('group')
    expect(nodes[1]).toMatchObject({ type: 'ovNode', parentId: 'g', extent: 'parent' })
    expect(nodes[1].data).toMatchObject({
      role: 'lead',
      statusKind: 'working',
      statusLabel: 'Running',
      ageLabel: 'just now',
      unread: true,
      chips: []
    })
    expect(nodes[2].data.chips).toEqual(['QUEUED'])
    expect(nodes[3].data.textPreview).toBe('line one\nline two')

    const byId = new Map(edges.map((e) => [e.id, e]))
    // One arrow per pair, as on the canvas: the rope wins the pixels over the bridge it covers.
    expect([...byId.keys()].sort()).toEqual(['n', 'r'])
    expect(byId.get('r')).toMatchObject({
      type: 'circuit',
      data: { kind: 'rope', state: { waiting: true, agentColor: '#d97757' } },
      label: WAIT_LABEL
    })
    expect(byId.get('n')).toMatchObject({ type: 'circuit', data: { kind: 'note' } })
    // The look is a table lookup on kind + state; nothing inline rides the edge object.
    expect(edges.every((e) => e.style === undefined && e.markerEnd === undefined)).toBe(true)
  })

  it('draws every edge even when a node hides its fan-out', () => {
    const input = base({
      nodes: [agent('a', { hideFanout: true }), agent('b')],
      bridges: [{ id: 'l', source: 'a', target: 'b' }]
    })
    expect(buildOverviewGraph(input, () => undefined, []).edges).toMatchObject([
      { id: 'l', type: 'circuit', data: { kind: 'context' } }
    ])
  })

  it('counts findings per card and marks a group without a lead', () => {
    const input = base({
      nodes: [node('g', { kind: 'group', title: 'W' }), agent('a', { parentId: 'g' }), agent('b', { parentId: 'g' })]
    })
    const { nodes } = buildOverviewGraph(input, () => undefined, buildFindings(input))
    expect(nodes.find((n) => n.id === 'g')!.data.noLead).toBe(true)
    expect(nodes.find((n) => n.id === 'a')!.data.findingCount).toBe(1)
  })
})

describe('overviewSig', () => {
  it('changes with node count, annotation stamps and states, not with positions', () => {
    const a = overviewSig([agent('a', { annotation: { role: 'x', by: 'a', at: 1 } })], { a: { unread: false, state: 'done' } })
    const b = overviewSig([agent('a', { annotation: { role: 'x', by: 'a', at: 2 } })], { a: { unread: false, state: 'done' } })
    const c = overviewSig([agent('a', { position: { x: 9, y: 9 }, annotation: { role: 'x', by: 'a', at: 1 } })], {
      a: { unread: false, state: 'done' }
    })
    const d = overviewSig([agent('a', { annotation: { role: 'x', by: 'a', at: 1 } })], { a: { unread: false, state: 'working' } })
    expect(a).not.toBe(b)
    expect(a).toBe(c)
    expect(a).not.toBe(d)
  })
})
