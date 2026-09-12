import { describe, it, expect } from 'vitest'
import { routeOne, fallbackPoints, compressCollinear } from './route'
import { portsFor } from './ports'
import { obstaclesFor, containsStrict } from './obstacles'
import type { Point, RouteEdge, RouteNode, RouteRequest } from './types'

const n = (id: string, x: number, y: number, o: Partial<RouteNode> = {}): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false, ...o })
const mk = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges })
const rope = (id: string, source: string, target: string): RouteEdge => ({ id, source, target, kind: 'rope' })

/** Every point on every segment of an orthogonal polyline, sampled each 2px. */
function* samples(points: Point[]): Generator<Point> {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const steps = Math.max(1, Math.floor(len / 2))
    for (let s = 0; s <= steps; s++) yield { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
  }
}
function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false
  return true
}
function bends(points: Point[]): number { return Math.max(0, compressCollinear(points).length - 2) }

describe('routeOne', () => {
  it('a clear corridor is a straight line (no bends), starting and ending at the ports', () => {
    const r = mk([n('a', 0, 0), n('b', 600, 0)], [rope('e', 'a', 'b')])
    const ports = portsFor(r).get('e')!
    const route = routeOne(r.edges[0], r, ports)
    expect(route.fallback).toBe(false)
    expect(route.points[0]).toEqual({ x: ports[0].x, y: ports[0].y })
    expect(route.points.at(-1)).toEqual({ x: ports[1].x, y: ports[1].y })
    expect(bends(route.points)).toBe(0)
  })
  it('goes around a bystander, never entering its inflated box', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -40, { height: 180 })], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(route.fallback).toBe(false)
    const obs = obstaclesFor(r.edges[0], r)
    for (const p of samples(route.points)) for (const o of obs) expect(containsStrict(o, p)).toBe(false)
    expect(isOrthogonal(route.points)).toBe(true)
    expect(bends(route.points)).toBeLessThanOrEqual(4)
  })
  it('the Z case (offset rows) takes exactly two bends', () => {
    const r = mk([n('a', 0, 0), n('b', 600, 300)], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(bends(route.points)).toBe(2)
  })
  it('first step leaves along the port normal, last arrives along the target normal', () => {
    const r = mk([n('a', 0, 0), n('b', 300, 500)], [{ ...rope('e', 'a', 'b'), ropeKind: 'opener' }])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    const [p0, p1] = route.points
    expect(p1.x).toBe(p0.x); expect(p1.y).toBeGreaterThan(p0.y)         // leaves bottom, downward
    const [q1, q0] = [route.points.at(-2)!, route.points.at(-1)!]
    expect(q1.x).toBe(q0.x); expect(q1.y).toBeLessThan(q0.y)            // arrives at top, downward
  })
  it('property: 200 random canvases, no route enters an obstacle, all orthogonal', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let t = 0; t < 200; t++) {
      const nodes: RouteNode[] = []
      const count = 3 + Math.floor(rnd() * 10)
      for (let i = 0; i < count; i++) nodes.push(n(`n${i}`, Math.floor(rnd() * 2000), Math.floor(rnd() * 1400), { width: 160 + Math.floor(rnd() * 300), height: 80 + Math.floor(rnd() * 300) }))
      const r = mk(nodes, [rope('e', 'n0', 'n1')])
      const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
      expect(isOrthogonal(route.points)).toBe(true)
      if (route.fallback) continue
      const obs = obstaclesFor(r.edges[0], r)
      for (const p of samples(route.points)) for (const o of obs) expect(containsStrict(o, p), `t=${t}`).toBe(false)
    }
  })
  it('boxed in ⇒ fallback, still drawable', () => {
    const wall = (id: string, x: number, y: number, w: number, h: number) => n(id, x, y, { width: w, height: h })
    const r = mk([n('a', 0, 0), n('b', 2000, 0), wall('w1', -100, -100, 400, 20), wall('w2', -100, 200, 400, 20), wall('w3', -100, -100, 20, 320), wall('w4', 280, -100, 20, 320)], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(route.fallback).toBe(true)
    expect(route.points.length).toBeGreaterThanOrEqual(2)
  })
  it('is deterministic', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -40, { height: 180 })], [rope('e', 'a', 'b')])
    expect(routeOne(r.edges[0], r, portsFor(r).get('e')!)).toEqual(routeOne(r.edges[0], r, portsFor(r).get('e')!))
  })
})

describe('fallbackPoints', () => {
  it('right → left ports: a Z through the midpoint x', () => {
    const pts = fallbackPoints([{ x: 200, y: 50, side: 'right' }, { x: 600, y: 350, side: 'left' }])
    expect(pts).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 350 }, { x: 600, y: 350 }])
  })
})
