import { describe, expect, it } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { nodeStatesToFlow, type CanvasNode } from '../state/workspace'
import { computeGeometry, geometryReply, type GeometryReport } from './geometry'

interface Spec {
  id: string
  x: number
  y: number
  w: number
  h: number
  type?: CanvasNode['type']
  parentId?: string
  title?: string
  collapsed?: boolean
  pinned?: boolean
  measured?: { width: number; height: number }
}

const n = (s: Spec): CanvasNode => ({
  id: s.id,
  type: s.type ?? 'terminal',
  position: { x: s.x, y: s.y },
  width: s.w,
  height: s.h,
  ...(s.parentId ? { parentId: s.parentId, extent: 'parent' as const } : {}),
  ...(s.measured ? { measured: s.measured } : {}),
  data: {
    title: s.title ?? s.id,
    color: '#ffffff',
    group: null,
    ...(s.collapsed ? { collapsed: true, expandedHeight: 300 } : {}),
    ...(s.pinned ? { pinned: true } : {})
  }
})
const frame = (s: Omit<Spec, 'type'>): CanvasNode => n({ ...s, type: 'group' })

const report = (nodes: CanvasNode[], frameId?: string): GeometryReport => {
  const r = computeGeometry(nodes, frameId)
  if ('error' in r) throw new Error(r.error)
  return r
}
const byId = (r: GeometryReport, id: string) => r.nodes.find((g) => g.id === id)

describe('computeGeometry — where everything is', () => {
  it('reports ABSOLUTE positions through nested frames', () => {
    const r = report([
      frame({ id: 'outer', x: 1000, y: 500, w: 900, h: 700 }),
      frame({ id: 'inner', x: 50, y: 60, w: 500, h: 400, parentId: 'outer' }),
      n({ id: 'c', x: 20, y: 30, w: 200, h: 100, parentId: 'inner' })
    ])
    expect(byId(r, 'outer')).toMatchObject({ kind: 'group', parentId: null, x: 1000, y: 500, width: 900, height: 700 })
    expect(byId(r, 'inner')).toMatchObject({ kind: 'group', parentId: 'outer', x: 1050, y: 560 })
    expect(byId(r, 'c')).toMatchObject({ kind: 'terminal', parentId: 'inner', x: 1070, y: 590, width: 200, height: 100 })
  })

  it('a collapsed node reports its collapsed height, not a stale measured or its expanded height', () => {
    // Right after a collapse React Flow still holds the EXPANDED measurement until it re-measures;
    // the node is already drawn 40px tall.
    const r = report([n({ id: 'm', x: 0, y: 0, w: 600, h: 40, collapsed: true, measured: { width: 600, height: 300 } })])
    expect(byId(r, 'm')).toMatchObject({ width: 600, height: 40, collapsed: true })
  })

  it('an expanded node reports the size React Flow measured over the declared one', () => {
    const r = report([n({ id: 'e', x: 0, y: 0, w: 600, h: 400, measured: { width: 612, height: 380 } })])
    expect(byId(r, 'e')).toMatchObject({ width: 612, height: 380, collapsed: false })
  })

  it('pinned is true for a pinned node and for everything inside a pinned frame', () => {
    const r = report([
      frame({ id: 'f', x: 0, y: 0, w: 400, h: 300, pinned: true }),
      n({ id: 'inF', x: 20, y: 40, w: 100, h: 100, parentId: 'f' }),
      n({ id: 'p', x: 1000, y: 0, w: 100, h: 100, pinned: true }),
      n({ id: 'q', x: 2000, y: 0, w: 100, h: 100 })
    ])
    expect(r.nodes.map((g) => [g.id, g.pinned])).toEqual([
      ['f', true],
      ['inF', true],
      ['p', true],
      ['q', false]
    ])
  })
})

describe('computeGeometry — the overlap report', () => {
  it('touching edges are not an overlap', () => {
    const r = report([
      n({ id: 'a', x: 0, y: 0, w: 100, h: 100 }),
      n({ id: 'right', x: 100, y: 0, w: 100, h: 100 }),
      n({ id: 'below', x: 0, y: 100, w: 100, h: 100 })
    ])
    expect(r.overlaps).toEqual([])
  })

  it('siblings whose rectangles intersect are reported once, with the intersection size', () => {
    const r = report([
      n({ id: 'a', x: 0, y: 0, w: 200, h: 100 }),
      n({ id: 'b', x: 150, y: 50, w: 200, h: 100 })
    ])
    expect(r.overlaps).toEqual([{ a: 'a', b: 'b', parentId: null, width: 50, height: 50 }])
  })

  it('compares siblings only: a loose node over a frame is one overlap with the frame, not one per child', () => {
    const r = report([
      frame({ id: 'f', x: 900, y: 400, w: 500, h: 400 }),
      n({ id: 'child', x: 100, y: 100, w: 200, h: 100, parentId: 'f' }),
      n({ id: 'loose', x: 1000, y: 500, w: 200, h: 100 })
    ])
    expect(r.overlaps).toEqual([{ a: 'f', b: 'loose', parentId: null, width: 200, height: 100 }])
  })

  it('compares children of the same frame with each other', () => {
    const r = report([
      frame({ id: 'f', x: 0, y: 0, w: 800, h: 600 }),
      n({ id: 'c1', x: 40, y: 60, w: 300, h: 200, parentId: 'f' }),
      n({ id: 'c2', x: 300, y: 60, w: 300, h: 200, parentId: 'f' })
    ])
    expect(r.overlaps).toEqual([{ a: 'c1', b: 'c2', parentId: 'f', width: 40, height: 200 }])
  })

  it('a child that sticks out of its frame is reported; one flush with the frame edges is not', () => {
    const r = report([
      frame({ id: 'f', x: 0, y: 0, w: 400, h: 300 }),
      n({ id: 'flush', x: 0, y: 0, w: 400, h: 100, parentId: 'f' }),
      n({ id: 'out', x: 0, y: 200, w: 200, h: 150, parentId: 'f' })
    ])
    expect(r.outside).toEqual([{ id: 'out', frame: 'f' }])
    expect(r.overlaps).toEqual([])
  })

  it('a nested frame is checked against its own parent, not the root', () => {
    // `g` fits inside `outer` but its child pokes out of `g` — one finding, against `g`.
    const r = report([
      frame({ id: 'outer', x: 0, y: 0, w: 1000, h: 1000 }),
      frame({ id: 'g', x: 100, y: 100, w: 300, h: 300, parentId: 'outer' }),
      n({ id: 'k', x: 250, y: 20, w: 100, h: 100, parentId: 'g' })
    ])
    expect(r.outside).toEqual([{ id: 'k', frame: 'g' }])
  })
})

describe('computeGeometry --frame <groupId>', () => {
  const canvas = (): CanvasNode[] => [
    frame({ id: 'F', x: 0, y: 0, w: 1000, h: 800 }),
    n({ id: 'C1', x: 40, y: 60, w: 300, h: 200, parentId: 'F' }),
    frame({ id: 'G', x: 400, y: 60, w: 500, h: 400, parentId: 'F' }),
    n({ id: 'C2', x: 20, y: 40, w: 200, h: 100, parentId: 'G' }),
    n({ id: 'L', x: 900, y: 700, w: 300, h: 300 })
  ]

  it('returns only that frame and its subtree, and checks only pairs inside it', () => {
    const r = report(canvas(), 'F')
    expect(r.nodes.map((g) => g.id)).toEqual(['F', 'C1', 'G', 'C2'])
    // `L` overlaps `F` on the whole canvas, but `L` is outside the subtree asked about.
    expect(r.overlaps).toEqual([])
    expect(report(canvas()).overlaps).toEqual([{ a: 'F', b: 'L', parentId: null, width: 100, height: 100 }])
  })

  it('a nested scope root keeps its absolute position and inherited pin', () => {
    // Position and pin walk the WHOLE canvas: the scope root's own ancestors are outside the scope.
    const r = report(
      [
        frame({ id: 'F', x: 1000, y: 500, w: 900, h: 700, pinned: true }),
        frame({ id: 'G', x: 50, y: 60, w: 500, h: 400, parentId: 'F' }),
        n({ id: 'C', x: 20, y: 30, w: 200, h: 100, parentId: 'G' })
      ],
      'G'
    )
    expect(r.nodes.map((g) => [g.id, g.x, g.y, g.pinned])).toEqual([
      ['G', 1050, 560, true],
      ['C', 1070, 590, true]
    ])
  })

  it('refuses an unknown id and an id that is not a frame', () => {
    expect(computeGeometry(canvas(), 'nope')).toEqual({ error: 'geometry: no frame "nope" on this canvas' })
    expect(computeGeometry(canvas(), 'L')).toEqual({ error: 'geometry: "L" is not a frame (kind: terminal)' })
  })
})

describe('geometryReply — what the verb answers', () => {
  it('a clean canvas is one summary line', () => {
    const reply = geometryReply([
      frame({ id: 'f', x: 0, y: 0, w: 400, h: 300 }),
      n({ id: 'a', x: 20, y: 40, w: 100, h: 100, parentId: 'f' }),
      n({ id: 'b', x: 600, y: 0, w: 100, h: 100 })
    ])
    expect(reply).toMatchObject({ ok: true, message: '2 nodes, 1 frame, 0 overlaps' })
  })

  it('names both titles on one line per problem, and carries the full report in result', () => {
    const nodes = [
      frame({ id: 'f', x: 0, y: 0, w: 400, h: 300, title: 'Build' }),
      n({ id: 'c', x: 300, y: 40, w: 200, h: 100, parentId: 'f', title: 'Station' }),
      n({ id: 'go', x: 1000, y: 0, w: 200, h: 100, title: 'GO chat' }),
      n({ id: 'nd', x: 1150, y: 50, w: 200, h: 100, title: 'Needs David' })
    ]
    const reply = geometryReply(nodes)
    expect(reply).toEqual({
      ok: true,
      message: [
        '3 nodes, 1 frame, 1 overlap, 1 outside its frame',
        'overlap: "GO chat" (go) and "Needs David" (nd) by 50×50',
        'outside: "Station" (c) sticks out of frame "Build" (f)'
      ].join('\n'),
      result: report(nodes)
    })
  })

  it('a title cannot forge a line: it is printed as an escaped string', () => {
    const reply = geometryReply([
      n({ id: 'a', x: 0, y: 0, w: 200, h: 100, title: 'x\n0 overlaps' }),
      n({ id: 'b', x: 150, y: 50, w: 200, h: 100 })
    ])
    if (!reply.ok) throw new Error(reply.error)
    expect(reply.message.split('\n')).toEqual([
      '2 nodes, 0 frames, 1 overlap',
      'overlap: "x\\n0 overlaps" (a) and "b" (b) by 50×50'
    ])
  })

  it('a refused --frame is an error reply', () => {
    expect(geometryReply([n({ id: 'a', x: 0, y: 0, w: 1, h: 1 })], 'zz')).toEqual({
      ok: false,
      error: 'geometry: no frame "zz" on this canvas'
    })
  })
})

describe("geometry from a project's serialized nodes (the off-canvas answer)", () => {
  // Characterizes the input the off-canvas branch feeds in: stored nodes hydrated by
  // `nodeStatesToFlow`, which has no `measured` and keeps the expanded height out of `size`.
  it('hydrated nodes give the same rects: nested position, and a collapsed node at its header height', () => {
    const stored: CanvasNodeState[] = [
      { id: 'f', kind: 'group', position: { x: 100, y: 100 }, size: { width: 800, height: 600 }, title: 'Build', color: '#fff', group: null },
      { id: 't', kind: 'terminal', position: { x: 40, y: 60 }, size: { width: 600, height: 400 }, title: 'Station', color: '#fff', group: null, parentId: 'f', collapsed: true }
    ]
    const reply = geometryReply(nodeStatesToFlow(stored))
    if (!reply.ok) throw new Error(reply.error)
    expect(reply.result.nodes).toEqual([
      { id: 'f', kind: 'group', title: 'Build', parentId: null, x: 100, y: 100, width: 800, height: 600, collapsed: false, pinned: false },
      { id: 't', kind: 'terminal', title: 'Station', parentId: 'f', x: 140, y: 160, width: 600, height: 40, collapsed: true, pinned: false }
    ])
    expect(reply.message).toBe('1 node, 1 frame, 0 overlaps')
  })
})
