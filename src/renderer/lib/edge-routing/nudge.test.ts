import { describe, it, expect } from 'vitest'
import { nudge } from './nudge'
import { CHANNEL_SPACING, type Route, type RouteEdge } from './types'

const route = (points: { x: number; y: number }[]): Route => ({
  points,
  ports: [{ ...points[0], side: 'right' }, { ...points[points.length - 1], side: 'left' }],
  fallback: false,
  labelAt: points[1],
  bbox: { x: 0, y: 0, width: 0, height: 0 }
})
// Two Z routes sharing the vertical run at x=500 between y=50 and y=350 / y=60 and y=340.
const r1 = route([{ x: 200, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 350 }, { x: 800, y: 350 }])
const r2 = route([{ x: 200, y: 60 }, { x: 500, y: 60 }, { x: 500, y: 340 }, { x: 800, y: 340 }])
const edges: RouteEdge[] = [
  { id: 'e1', source: 'a', target: 'b', kind: 'rope' },
  { id: 'e2', source: 'a', target: 'c', kind: 'context' }
]
const noObs = () => []

describe('nudge', () => {
  it('two parallel runs end up CHANNEL_SPACING apart, ordered by kind (context before rope)', () => {
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const x1 = out.get('e1')!.points[1].x
    const x2 = out.get('e2')!.points[1].x
    expect(Math.abs(x1 - x2)).toBe(CHANNEL_SPACING)
    expect(x2).toBeLessThan(x1) // context (order 0) takes the lower offset
  })
  it('adjoining horizontal segments follow the shifted vertical (still orthogonal)', () => {
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const p = out.get('e1')!.points
    expect(p[1].x).toBe(p[2].x)
    expect(p[0].y).toBe(p[1].y)
    expect(p[2].y).toBe(p[3].y)
  })
  it('a lone segment is untouched and keeps identity', () => {
    const out = nudge(new Map([['e1', r1]]), edges.slice(0, 1), noObs)
    expect(out.get('e1')).toBe(r1)
  })
  it('stable: the same input twice gives the same offsets', () => {
    const a = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const b = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    expect(a).toEqual(b)
  })
  it('an offset that would enter an obstacle is dropped to zero for that member', () => {
    const wall = { x: 500 + 2, y: 0, width: 100, height: 500 } // just right of the corridor
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, (id) => (id === 'e1' ? [wall] : []))
    expect(out.get('e1')!.points[1].x).toBe(500)
  })
  it('an offset whose RUN crosses an obstacle is dropped too, not only one landing a corner in it', () => {
    // The run out of A* legitimately hugs an obstacle's border, so the 6 px offset carries it
    // INSIDE — and this obstacle sits between the three points the check used to sample (the two
    // moved corners at y=50/350 and their midpoint at y=200), so the shift went through a node
    // body. Live case: a 1,728 px run nudged 24 px into a node it had been running alongside.
    const wall = { x: 500, y: 60, width: 240, height: 130 }
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, (id) => (id === 'e1' ? [wall] : []))
    expect(out.get('e1')!.points[1].x).toBe(500)
  })
})
