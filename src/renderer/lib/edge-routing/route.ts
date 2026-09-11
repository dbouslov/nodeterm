// A* over the visibility graph (spec 3.4) with the two direction constraints: the first step
// leaves along the source port's outward normal, the last arrives along the target port's inward
// normal. Cost = Manhattan length + BEND_COST per turn; the heuristic is Manhattan distance.
// Failure inside the window widens once to the whole canvas; failure again ⇒ the fallback
// three-segment path (spec 3.5), so an edge is never left undrawn.
import { obstaclesFor, windowFor } from './obstacles'
import { buildGraph, type Graph } from './visibility'
import { BEND_COST, WINDOW_PAD, outward, type Box, type Point, type Port, type Route, type RouteEdge, type RouteRequest } from './types'

type Dir = 0 | 1 | 2 | 3 // right, down, left, up
const dirOf = (from: Point, to: Point): Dir => (to.x > from.x ? 0 : to.x < from.x ? 2 : to.y > from.y ? 1 : 3)
const dirOfNormal = (n: Point): Dir => (n.x === 1 ? 0 : n.y === 1 ? 1 : n.x === -1 ? 2 : 3)

export function compressCollinear(points: Point[]): Point[] {
  if (points.length < 3) return points.slice()
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1]
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
    if (!collinear) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

export function astar(g: Graph, from: Port, to: Port): Point[] | null {
  const start = g.vertexAt(from)
  const goal = g.vertexAt(to)
  if (start < 0 || goal < 0) return null
  const mustLeave = dirOfNormal(outward(from.side))
  const mustArrive = ((dirOfNormal(outward(to.side)) + 2) % 4) as Dir
  const goalP = g.at(goal)
  const h = (v: number) => { const p = g.at(v); return Math.abs(p.x - goalP.x) + Math.abs(p.y - goalP.y) }
  // State = vertex * 4 + incoming direction. 4 = "no direction yet" handled as separate start.
  const key = (v: number, d: Dir) => v * 4 + d
  const gScore = new Map<number, number>()
  const came = new Map<number, number>()
  const open: { k: number; f: number; v: number; d: Dir }[] = []
  const push = (k: number, f: number, v: number, d: Dir) => { open.push({ k, f, v, d }); open.sort((a, b) => a.f - b.f || a.k - b.k) }
  // Seed: only the neighbour in the mandated leaving direction.
  for (const u of g.neighbors(start)) {
    const d = dirOf(g.at(start), g.at(u))
    if (d !== mustLeave) continue
    const p = g.at(start), q = g.at(u)
    const cost = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
    gScore.set(key(u, d), cost)
    came.set(key(u, d), -1)
    push(key(u, d), cost + h(u), u, d)
  }
  const closed = new Set<number>()
  while (open.length) {
    const cur = open.shift()!
    if (closed.has(cur.k)) continue
    closed.add(cur.k)
    if (cur.v === goal && cur.d === mustArrive) {
      const pts: Point[] = [g.at(goal)]
      let k = cur.k
      while (came.get(k) !== -1 && came.has(k)) { k = came.get(k)!; pts.push(g.at(Math.floor(k / 4))) }
      pts.push(g.at(start))
      return compressCollinear(pts.reverse())
    }
    const p = g.at(cur.v)
    for (const u of g.neighbors(cur.v)) {
      const d = dirOf(p, g.at(u))
      if (d === ((cur.d + 2) % 4)) continue // no U-turn
      const q = g.at(u)
      const step = Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (d === cur.d ? 0 : BEND_COST)
      const nk = key(u, d)
      const ng = gScore.get(cur.k)! + step
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng)
        came.set(nk, cur.k)
        push(nk, ng + h(u), u, d)
      }
    }
  }
  return null
}

/** The no-avoidance path: out along the source normal, across, in along the target normal. */
export function fallbackPoints(ports: [Port, Port]): Point[] {
  const [a, b] = ports
  const ha = a.side === 'left' || a.side === 'right'
  const hb = b.side === 'left' || b.side === 'right'
  if (ha && hb) { const mx = (a.x + b.x) / 2; return compressCollinear([{ x: a.x, y: a.y }, { x: mx, y: a.y }, { x: mx, y: b.y }, { x: b.x, y: b.y }]) }
  if (!ha && !hb) { const my = (a.y + b.y) / 2; return compressCollinear([{ x: a.x, y: a.y }, { x: a.x, y: my }, { x: b.x, y: my }, { x: b.x, y: b.y }]) }
  // Mixed: one bend at the corner.
  return ha ? compressCollinear([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }]) : compressCollinear([{ x: a.x, y: a.y }, { x: a.x, y: b.y }, { x: b.x, y: b.y }])
}

function bboxOfPoints(points: Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function labelPointOf(points: Point[]): Point {
  let best = 0, bestLen = -1
  for (let i = 1; i < points.length; i++) {
    const len = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
    if (len > bestLen) { bestLen = len; best = i }
  }
  const a = points[best - 1] ?? points[0], b = points[best] ?? points[0]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function routeOne(edge: RouteEdge, req: RouteRequest, ports: [Port, Port]): Route {
  const a = req.nodes.get(edge.source)!
  const b = req.nodes.get(edge.target)!
  const endpoints: [Box, Box] = [a, b]
  const attempt = (window: Box): Point[] | null => {
    const blocked = obstaclesFor(edge, req, window)
    return astar(buildGraph(blocked, ports, endpoints, window), ports[0], ports[1])
  }
  let points = attempt(windowFor(a, b, WINDOW_PAD))
  if (!points) {
    let all: Box = { x: 0, y: 0, width: 0, height: 0 }
    let first = true
    for (const n of req.nodes.values()) { all = first ? { ...n } : windowFor(all, n, 0); first = false }
    points = attempt(windowFor(all, all, WINDOW_PAD))
  }
  const fallback = !points
  const pts = points ?? fallbackPoints(ports)
  return { points: pts, ports, fallback, labelAt: labelPointOf(pts), bbox: bboxOfPoints(pts) }
}
