import { describe, it, expect } from 'vitest'
import { rankUnits, restructureNodes } from './restructure'
import { arrangeNodes, type CanvasNode } from '../state/workspace'
import type { BridgeLink } from '@shared/types'
import { ROW_GAP, PLACEMENT_GAP } from '@shared/placement'

const n = (
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 50,
  parentId?: string,
  type: 'terminal' | 'group' = 'terminal'
): CanvasNode =>
  ({ id, type, position: { x, y }, width: w, height: h, parentId, data: { title: id, color: '#fff', group: null } }) as CanvasNode
const rope = (s: string, t: string, kind?: 'opener' | 'dep'): BridgeLink => ({
  id: `ctrl-${s}-${t}`,
  source: s,
  target: t,
  ...(kind ? { kind } : {})
})
const pos = (out: CanvasNode[], id: string) => out.find((x) => x.id === id)!.position

describe('rankUnits', () => {
  it('ranks by the longest opener chain; untagged ropes count as opener', () => {
    const r = rankUnits([n('a', 0, 0), n('b', 0, 0), n('c', 0, 0)], [rope('a', 'b'), rope('b', 'c', 'opener')])
    expect(r.rank.get('a')).toBe(0)
    expect(r.rank.get('b')).toBe(1)
    expect(r.rank.get('c')).toBe(2)
    expect(r.rows).toEqual([['a'], ['b'], ['c']])
  })

  it('a dep rope keeps the dependent on its dependency’s row, never above it', () => {
    // root opens x; x opens y; root ALSO opens z but z waits on y → z must be on y's row (2), not row 1
    const r = rankUnits([n('root', 0, 0), n('x', 0, 0), n('y', 0, 0), n('z', 0, 0)], [
      rope('root', 'x'),
      rope('x', 'y'),
      rope('root', 'z'),
      rope('y', 'z', 'dep')
    ])
    expect(r.rank.get('z')).toBe(2)
    expect(r.rows[2]).toEqual(['y', 'z']) // dep before dependent
  })

  it('a frame is one unit ranked by its members’ ropes; ropes inside it are ignored', () => {
    const nodes = [
      n('conductor', 0, 0),
      n('g', 0, 300, 400, 200, undefined, 'group'),
      n('m1', 10, 10, 100, 50, 'g'),
      n('m2', 200, 10, 100, 50, 'g')
    ]
    const r = rankUnits(nodes, [rope('conductor', 'm1'), rope('conductor', 'm2'), rope('m1', 'm2')])
    expect(r.rank.get('g')).toBe(1)
    expect(r.rank.has('m1')).toBe(false)
  })

  it('a cycle is broken at its back edge, not looped on — the first unit stays the root', () => {
    const r = rankUnits([n('a', 0, 0), n('b', 0, 0)], [rope('a', 'b'), rope('b', 'a')])
    expect(r.rank.get('a')).toBe(0)
    expect(r.rank.get('b')).toBe(1)
  })

  it('units with no ropes are loose, ordered by current (y, x)', () => {
    const r = rankUnits([n('p', 500, 0), n('q', 0, 100), n('a', 0, 0), n('b', 0, 0)], [rope('a', 'b')])
    expect(r.loose).toEqual(['p', 'q'])
  })

  it('children cluster under their opener within a row', () => {
    const nodes = [n('l', 0, 0), n('r', 900, 0), n('r1', 0, 0), n('l1', 800, 0)]
    const r = rankUnits(nodes, [rope('l', 'l1'), rope('r', 'r1')])
    expect(r.rows[0]).toEqual(['l', 'r'])
    expect(r.rows[1]).toEqual(['l1', 'r1']) // l1 first although its current x is larger
  })
})

describe('restructureNodes', () => {
  it('packs rows top-down, each row CENTERED under the opener, ROW_GAP apart', () => {
    // opener a is 100 wide at x=100 → its center x is 150; the two children (100 + 40 + 100 = 240
    // wide) must be centered on 150 → the row starts at 150 - 120 = 30.
    const nodes = [n('a', 100, 500), n('b', 600, 20), n('c', 700, 20)]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(pos(out, 'a')).toEqual({ x: 100, y: 20 })
    expect(pos(out, 'b')).toEqual({ x: 30, y: 20 + 50 + ROW_GAP })
    expect(pos(out, 'c')).toEqual({ x: 30 + 100 + PLACEMENT_GAP, y: 20 + 50 + ROW_GAP })
  })

  it('packs a row in RANKED order, not in node-array order', () => {
    // z1 waits on z0, so z0 comes first in the row — although z1 is earlier in the array AND
    // further left today (arrangeNodes would have packed it first).
    const nodes = [n('o', 0, 0), n('z1', 0, 300), n('z0', 900, 300)]
    const out = restructureNodes(nodes, [rope('o', 'z0'), rope('o', 'z1'), rope('z0', 'z1', 'dep')])
    expect(pos(out, 'z0').x).toBeLessThan(pos(out, 'z1').x)
    expect(pos(out, 'z0').y).toBe(pos(out, 'z1').y)
  })

  it('with no ropes at all is a pure TRANSLATION of the old Tidy grid over the same ids', () => {
    const nodes = [n('c', 5, 300), n('a', 0, 0), n('b', 400, 0)]
    const ids = ['a', 'b', 'c']
    const tidy = arrangeNodes(nodes, ids, { layout: 'grid' })
    const out = restructureNodes(nodes, [])
    const dx = pos(out, 'a').x - pos(tidy, 'a').x
    const dy = pos(out, 'a').y - pos(tidy, 'a').y
    for (const id of ids) expect(pos(out, id)).toEqual({ x: pos(tidy, id).x + dx, y: pos(tidy, id).y + dy })
  })

  it('radial: rank-1 units sit on one ring below the root center, spread left → right, never overlapping', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 0), n('c', 0, 0), n('d', 0, 0)]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c'), rope('a', 'd')], 'radial')
    const c = { x: pos(out, 'a').x + 50, y: pos(out, 'a').y + 25 }
    const dist = (id: string) => Math.hypot(pos(out, id).x + 50 - c.x, pos(out, id).y + 25 - c.y)
    expect(dist('b')).toBeCloseTo(dist('c'), 5)
    expect(dist('c')).toBeCloseTo(dist('d'), 5)
    for (const id of ['b', 'c', 'd']) expect(pos(out, id).y + 25).toBeGreaterThanOrEqual(c.y) // lower half
    expect(pos(out, 'b').x).toBeLessThan(pos(out, 'c').x) // row order = left → right along the arc
    expect(pos(out, 'c').x).toBeLessThan(pos(out, 'd').x)
    const ids = ['a', 'b', 'c', 'd']
    for (const p of ids)
      for (const q of ids)
        if (p < q) {
          const P = pos(out, p)
          const Q = pos(out, q)
          expect(P.x < Q.x + 100 && P.x + 100 > Q.x && P.y < Q.y + 50 && P.y + 50 > Q.y, `${p}/${q}`).toBe(false)
        }
  })

  it('radial is idempotent with several roots — the rings hang off the roots, not off the topmost unit', () => {
    // Two roots put rank 1 on the FULL circle, so one child sits ABOVE the roots. Taking the ring's
    // top from every unit would read that child as the new top and lift the tree one radius per run.
    const nodes = [n('a', 0, 0), n('b', 300, 0), n('a1', 0, 300), n('b1', 300, 300)]
    const ropes = [rope('a', 'a1'), rope('b', 'b1')]
    const once = restructureNodes(nodes, ropes, 'radial')
    expect(restructureNodes(once, ropes, 'radial')).toEqual(once)
  })

  it('frames are rigid: the frame moves as one block, its children keep their relative positions', () => {
    const nodes = [n('o', 0, 0), n('g', 300, 900, 400, 200, undefined, 'group'), n('m', 37, 41, 100, 50, 'g')]
    const out = restructureNodes(nodes, [rope('o', 'm')])
    expect(pos(out, 'm')).toEqual({ x: 37, y: 41 })
    // centered under o (center x 50): 50 - 400 / 2
    expect(pos(out, 'g')).toEqual({ x: 50 - 200, y: 50 + ROW_GAP })
  })

  it('loose nodes go below the rows as a grid', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 200), n('z', 900, 900)]
    const out = restructureNodes(nodes, [rope('a', 'b')])
    expect(pos(out, 'z').y).toBeGreaterThanOrEqual(pos(out, 'b').y + 50 + ROW_GAP)
    expect(pos(out, 'z').x).toBe(0)
  })

  it('is idempotent', () => {
    const nodes = [n('a', 100, 500), n('b', 600, 20), n('c', 700, 20), n('z', 900, 900)]
    const once = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(restructureNodes(once, [rope('a', 'b'), rope('a', 'c')])).toEqual(once)
  })

  it('returns the input array unchanged for fewer than 2 units', () => {
    const nodes = [n('a', 5, 5)]
    expect(restructureNodes(nodes, [])).toBe(nodes)
  })
})

describe('restructureNodes — pinned units are fixed obstacles', () => {
  const pin = (node: CanvasNode): CanvasNode => ({ ...node, data: { ...node.data, pinned: true } }) as CanvasNode
  const box = (out: CanvasNode[], id: string) => {
    const nd = out.find((x) => x.id === id)!
    return { ...nd.position, w: nd.width as number, h: nd.height as number }
  }
  const overlapping = (out: CanvasNode[], p: string, q: string) => {
    const P = box(out, p)
    const Q = box(out, q)
    return P.x < Q.x + Q.w && P.x + P.w > Q.x && P.y < Q.y + Q.h && P.y + P.h > Q.y
  }

  it('a pinned node keeps its place and nothing is laid out onto it', () => {
    // b would land exactly on p (the row under a starts at x 30, y 130)
    const nodes = [n('a', 100, 0), n('b', 600, 20), n('c', 700, 20), pin(n('p', 30, 130))]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(pos(out, 'p')).toEqual({ x: 30, y: 130 })
    for (const id of ['a', 'b', 'c']) expect(overlapping(out, id, 'p'), id).toBe(false)
    expect(overlapping(out, 'b', 'c')).toBe(false)
  })

  it('a pinned frame stays with its children untouched, and the rest goes around it', () => {
    const nodes = [
      n('o', 0, 0),
      pin(n('g', -20, 130, 300, 200, undefined, 'group')),
      n('m', 10, 10, 100, 50, 'g'),
      n('x', 500, 500)
    ]
    const out = restructureNodes(nodes, [rope('o', 'x')])
    expect(pos(out, 'g')).toEqual({ x: -20, y: 130 })
    expect(pos(out, 'm')).toEqual({ x: 10, y: 10 })
    expect(overlapping(out, 'x', 'g')).toBe(false)
  })

  it('a pinned child fixes the frame it rides in', () => {
    const nodes = [n('o', 0, 0), n('g', 300, 900, 400, 200, undefined, 'group'), pin(n('m', 37, 41, 100, 50, 'g'))]
    const out = restructureNodes(nodes, [rope('o', 'm')])
    expect(pos(out, 'g')).toEqual({ x: 300, y: 900 })
    expect(pos(out, 'm')).toEqual({ x: 37, y: 41 })
  })

  it('a pinned root stays and its children still hang centered beneath it', () => {
    const nodes = [pin(n('a', 100, 0)), n('b', 600, 20), n('c', 700, 20)]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(pos(out, 'a')).toEqual({ x: 100, y: 0 })
    expect(pos(out, 'b')).toEqual({ x: 30, y: 50 + ROW_GAP })
    expect(pos(out, 'c')).toEqual({ x: 30 + 100 + PLACEMENT_GAP, y: 50 + ROW_GAP })
  })

  it('returns the input array when every unit is pinned (nothing to move, nothing to write)', () => {
    const nodes = [pin(n('a', 0, 0)), pin(n('b', 500, 0))]
    expect(restructureNodes(nodes, [rope('a', 'b')])).toBe(nodes)
  })
})
