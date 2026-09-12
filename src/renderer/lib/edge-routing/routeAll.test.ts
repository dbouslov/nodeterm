import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import type { RouteEdge, RouteNode, RouteRequest } from './types'

const n = (id: string, x: number, y: number): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false })
const mk = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges })

describe('routeAll', () => {
  const base = mk([n('a', 0, 0), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], [
    { id: 'ab', source: 'a', target: 'b', kind: 'context' },
    { id: 'cd', source: 'c', target: 'd', kind: 'context' }
  ])
  it('routes every edge whose endpoints exist, skips the rest', () => {
    const g = routeAll(mk([...base.nodes.values()], [...base.edges, { id: 'ax', source: 'a', target: 'ghost', kind: 'rope' }]))
    expect([...g.routes.keys()].sort()).toEqual(['ab', 'cd'])
    expect(g.fallbacks).toBe(0)
  })
  it('incremental: only edges touching a moved node (or crossing its box) are re-routed', () => {
    const g1 = routeAll(base)
    const moved = mk([n('a', 0, 20), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], base.edges)
    const g2 = routeAll(moved, g1, new Set(['a']))
    expect(g2.routes.get('cd')).toBe(g1.routes.get('cd'))     // identity kept
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
    expect(g2.routes.get('ab')!.points[0].y).toBe(70)          // follows the new port
  })
  // The canvas's tidy layouts leave a 40 px gap between neighbours, and OBSTACLE_MARGIN is the
  // gutter each side of that gap claims: two 24 px margins overlap inside 40 px, the corridor
  // between neighbours closes, and A* has nowhere to thread — 12 of these 22 edges gave up and
  // drew the straight three-segment fallback straight through the nodes. The margin has to leave
  // a corridor at the gap the layout actually produces.
  it('a tidy 40 px grid routes every edge with no fallback', () => {
    const gap = 40
    const ns: RouteNode[] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) ns.push(n(`n${r}-${c}`, c * (200 + gap), r * (100 + gap)))
    const es: RouteEdge[] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c + 2 < 5; c++) es.push({ id: `h${r}-${c}`, source: `n${r}-${c}`, target: `n${r}-${c + 2}`, kind: 'context' })
    for (let c = 0; c < 5; c++) for (let r = 0; r + 2 < 4; r++) es.push({ id: `v${r}-${c}`, source: `n${r}-${c}`, target: `n${r + 2}-${c}`, kind: 'rope', ropeKind: 'opener' })
    const g = routeAll(mk(ns, es))
    expect(g.routes.size).toBe(es.length)
    expect(g.fallbacks).toBe(0)
  })
  it('incremental: an untouched edge whose route crosses the moved node re-routes too', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, 400), n('d', 400, 800)], [
      { id: 'ab', source: 'a', target: 'b', kind: 'context' },
      { id: 'cd', source: 'c', target: 'd', kind: 'context' }
    ])
    const g1 = routeAll(r)
    const r2 = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -20), n('d', 400, 800)], r.edges) // c now sits on the ab corridor
    const g2 = routeAll(r2, g1, new Set(['c']))
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
  })
})
