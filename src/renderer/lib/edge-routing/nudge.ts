// Bundling (spec 3.6, decision 4). Interior segments that share a line and overlap in range form
// a CHANNEL; members are ordered by kind then ids (stable ribbons) and offset perpendicular by
// CHANNEL_SPACING. Moving a segment moves its two corner points, so the adjoining perpendicular
// segments stretch or shrink and the polyline stays orthogonal. First and last segments (the
// port stubs) are never nudged: the port spread already separates them.
import { KIND_ORDER } from '../edgeKinds'
import { segmentEnters } from './obstacles'
import { labelPointOf } from './route'
import { CHANNEL_SPACING, type Box, type Point, type Route, type RouteEdge } from './types'

interface Seg { edgeId: string; i: number; lo: number; hi: number; kindRank: number; source: string; target: string }

function bbox(points: Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function nudge(routes: Map<string, Route>, edges: RouteEdge[], obstaclesOf: (edgeId: string) => Box[]): Map<string, Route> {
  const byId = new Map(edges.map((e) => [e.id, e]))
  const vertical = new Map<number, Seg[]>()
  const horizontal = new Map<number, Seg[]>()
  for (const [id, r] of routes) {
    const e = byId.get(id)
    if (!e) continue
    const rank = KIND_ORDER.indexOf(e.kind)
    // Interior segments only: i from 1 to length-3 (segment i is points[i] → points[i+1]).
    for (let i = 1; i < r.points.length - 2; i++) {
      const a = r.points[i], b = r.points[i + 1]
      const seg: Seg = { edgeId: id, i, lo: 0, hi: 0, kindRank: rank, source: e.source, target: e.target }
      if (a.x === b.x) { seg.lo = Math.min(a.y, b.y); seg.hi = Math.max(a.y, b.y); (vertical.get(a.x) ?? vertical.set(a.x, []).get(a.x)!).push(seg) }
      else if (a.y === b.y) { seg.lo = Math.min(a.x, b.x); seg.hi = Math.max(a.x, b.x); (horizontal.get(a.y) ?? horizontal.set(a.y, []).get(a.y)!).push(seg) }
    }
  }
  const shifted = new Map<string, Point[]>() // edgeId → mutable copy of points
  const pointsOf = (id: string) => shifted.get(id) ?? (shifted.set(id, routes.get(id)!.points.map((p) => ({ ...p }))).get(id)!)
  const order = (p: Seg, q: Seg) => p.kindRank - q.kindRank || p.source.localeCompare(q.source) || p.target.localeCompare(q.target) || p.edgeId.localeCompare(q.edgeId)

  const process = (buckets: Map<number, Seg[]>, axis: 'x' | 'y') => {
    for (const segs of buckets.values()) {
      if (segs.length < 2) continue
      segs.sort((p, q) => p.lo - q.lo)
      // Sweep into channels of overlapping ranges.
      let channel: Seg[] = [segs[0]]
      let hi = segs[0].hi
      const flush = () => {
        if (channel.length < 2) return
        channel.sort(order)
        const n = channel.length
        channel.forEach((s, k) => {
          const off = (k - (n - 1) / 2) * CHANNEL_SPACING
          if (off === 0) return
          const pts = pointsOf(s.edgeId)
          const a = pts[s.i], b = pts[s.i + 1]
          const moved = axis === 'x' ? [{ x: a.x + off, y: a.y }, { x: b.x + off, y: b.y }] : [{ x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }]
          // The WHOLE moved run, not sample points: a corridor run hugs an obstacle's border, so
          // the offset carries it inside, and an obstacle sitting between the two corners and
          // their midpoint slipped through — the run then crossed a node body.
          if (obstaclesOf(s.edgeId).some((o) => segmentEnters(o, moved[0], moved[1]))) return
          pts[s.i] = moved[0]
          pts[s.i + 1] = moved[1]
        })
      }
      for (let k = 1; k < segs.length; k++) {
        if (segs[k].lo < hi) { channel.push(segs[k]); hi = Math.max(hi, segs[k].hi) }
        else { flush(); channel = [segs[k]]; hi = segs[k].hi }
      }
      flush()
    }
  }
  process(vertical, 'x')
  process(horizontal, 'y')

  const out = new Map(routes)
  for (const [id, pts] of shifted) {
    const r = routes.get(id)!
    out.set(id, { ...r, points: pts, labelAt: labelPointOf(pts), bbox: bbox(pts) })
  }
  return out
}
