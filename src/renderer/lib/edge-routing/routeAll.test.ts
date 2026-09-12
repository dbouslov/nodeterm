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
