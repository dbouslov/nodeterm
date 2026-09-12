import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import type { Point, RouteEdge, RouteNode, RouteRequest } from './types'

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
  // A routed edge may never pass through a node's body, and that includes the nodes its search
  // never saw: the obstacle list is filtered to the search window, so a route that leaves the
  // window is in territory where nothing is registered as an obstacle. Asked over 120 random
  // canvases because the escapes are rare (3 of 1,063 routes) and none of them look special.
  it('no route crosses a node body, over 120 random canvases', () => {
    const EPS = 0.5
    const crosses = (a: Point, b: Point, box: RouteNode): boolean =>
      Math.min(a.x, b.x) < box.x + box.width - EPS && box.x + EPS < Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) < box.y + box.height - EPS && box.y + EPS < Math.max(a.y, b.y)
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const bad: string[] = []
    for (let t = 0; t < 120; t++) {
      const count = 8 + Math.floor(rnd() * 10)
      const ns: RouteNode[] = []
      for (let i = 0; i < count; i++) ns.push({ id: `n${i}`, x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 2000), width: 200 + Math.floor(rnd() * 160), height: 100 + Math.floor(rnd() * 120), isFrame: false })
      const es: RouteEdge[] = []
      for (let i = 0; i < count; i++) {
        const s = Math.floor(rnd() * count), d = Math.floor(rnd() * count)
        if (s !== d) es.push({ id: `e${t}-${i}`, source: `n${s}`, target: `n${d}`, kind: i % 2 ? 'context' : 'rope', ropeKind: 'dep' })
      }
      const g = routeAll(mk(ns, es))
      for (const e of es) {
        const r = g.routes.get(e.id)
        // The fallback path is the no-avoidance one by definition, so it is not held to this.
        if (!r || r.fallback) continue
        for (let i = 0; i + 1 < r.points.length; i++) {
          for (const node of ns) {
            if (node.id === e.source || node.id === e.target) continue
            if (crosses(r.points[i], r.points[i + 1], node)) bad.push(`t=${t} ${e.id} segment ${i} crosses ${node.id}`)
          }
        }
      }
    }
    expect(bad).toEqual([])
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
