import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import type { RouteEdge, RouteNode, RouteRequest } from './types'

function canvas(nodes: number, edges: number, frames: number): RouteRequest {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const ns: RouteNode[] = []
  for (let i = 0; i < frames; i++) ns.push({ id: `f${i}`, x: i * 1400, y: 2000, width: 1200, height: 800, isFrame: true })
  for (let i = 0; i < nodes; i++) {
    const inFrame = i % 5 === 0 && frames > 0 ? `f${i % frames}` : undefined
    ns.push({ id: `n${i}`, x: inFrame ? (i % frames) * 1400 + 50 + (i % 4) * 280 : Math.floor(rnd() * 4000), y: inFrame ? 2050 + Math.floor(i / 20) * 200 : Math.floor(rnd() * 1800), width: 240 + Math.floor(rnd() * 200), height: 120 + Math.floor(rnd() * 200), isFrame: false, parentId: inFrame })
  }
  const es: RouteEdge[] = []
  for (let i = 0; i < edges; i++) es.push({ id: `e${i}`, source: `n${i % nodes}`, target: `n${(i * 7 + 1) % nodes}`, kind: i % 3 === 0 ? 'context' : 'rope', ropeKind: i % 2 ? 'opener' : 'dep' })
  return { nodes: new Map(ns.map((v) => [v.id, v])), edges: es.filter((e) => e.source !== e.target) }
}

describe('routing performance pins (spec Section 6; CI bounds are generous)', () => {
  it('full pass, 40 nodes / 60 edges / 6 frames under 100 ms', () => {
    const req = canvas(40, 60, 6)
    routeAll(req) // warm
    const t0 = performance.now(); routeAll(req); const ms = performance.now() - t0
    expect(ms).toBeLessThan(100)
  })
  it('full pass, 120 nodes / 200 edges under 500 ms', () => {
    const req = canvas(120, 200, 8)
    routeAll(req)
    const t0 = performance.now(); routeAll(req); const ms = performance.now() - t0
    expect(ms).toBeLessThan(500)
  })
  it('drag pass (one node moved) on 120 / 200 under 50 ms', () => {
    const req = canvas(120, 200, 8)
    const g = routeAll(req)
    const moved = { nodes: new Map(req.nodes), edges: req.edges }
    const n5 = moved.nodes.get('n5')!
    moved.nodes.set('n5', { ...n5, y: n5.y + 30 })
    const t0 = performance.now(); routeAll(moved, g, new Set(['n5'])); const ms = performance.now() - t0
    expect(ms).toBeLessThan(50)
  })
})
