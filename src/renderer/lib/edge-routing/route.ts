// A* over the visibility graph (spec 3.4) with the two direction constraints: the first step
// leaves along the source port's outward normal, the last arrives along the target port's inward
// normal. Cost = Manhattan length + BEND_COST per turn; the heuristic is Manhattan distance.
// Failure inside the window widens once to the whole canvas; failure again ⇒ the fallback
// three-segment path (spec 3.5), so an edge is never left undrawn.
import { containsStrict, obstaclesFor, windowFor } from './obstacles'
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

/** The open list: a binary min-heap on (f, state key). Ties on f break on the lower key, the
 *  order a fully sorted list gives, so the search — and the route — stay deterministic at
 *  O(log n) a push and a pop instead of a sort per push. */
function openList() {
  const fs: number[] = [], ks: number[] = []
  const less = (i: number, j: number) => fs[i] < fs[j] || (fs[i] === fs[j] && ks[i] < ks[j])
  const swap = (i: number, j: number) => {
    const f = fs[i]; fs[i] = fs[j]; fs[j] = f
    const k = ks[i]; ks[i] = ks[j]; ks[j] = k
  }
  return {
    get size() { return fs.length },
    push(f: number, k: number) {
      fs.push(f); ks.push(k)
      for (let i = fs.length - 1; i > 0; ) {
        const p = (i - 1) >> 1
        if (!less(i, p)) break
        swap(i, p); i = p
      }
    },
    /** Removes and returns the state key with the lowest (f, key). */
    pop(): number {
      const top = ks[0]
      const f = fs.pop()!, k = ks.pop()!
      if (fs.length) {
        fs[0] = f; ks[0] = k
        for (let i = 0; ; ) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < fs.length && less(l, m)) m = l
          if (r < fs.length && less(r, m)) m = r
          if (m === i) break
          swap(i, m); i = m
        }
      }
      return top
    }
  }
}

export function astar(g: Graph, from: Port, to: Port): Point[] | null {
  const start = g.vertexAt(from)
  const goal = g.vertexAt(to)
  if (start < 0 || goal < 0) return null
  const X = g.xs, Y = g.ys, W = X.length
  const mustLeave = dirOfNormal(outward(from.side))
  const mustArrive = ((dirOfNormal(outward(to.side)) + 2) % 4) as Dir
  const gx = X[goal % W], gy = Y[Math.floor(goal / W)]
  const h = (v: number) => Math.abs(X[v % W] - gx) + Math.abs(Y[Math.floor(v / W)] - gy)
  // State = vertex * 4 + incoming direction, in flat typed arrays rather than Maps: a target that
  // cannot be reached makes the search visit every state of the widened graph, and this
  // bookkeeping was then most of a drag frame.
  const states = W * Y.length * 4
  const gScore = new Float64Array(states).fill(Infinity)
  const came = new Int32Array(states).fill(-2) // -1 = seeded from the start port
  const closed = new Uint8Array(states)
  const open = openList()
  // Seed: only the neighbour in the mandated leaving direction.
  const s = g.at(start)
  for (const u of g.neighbors(start)) {
    const q = g.at(u)
    const d = dirOf(s, q)
    if (d !== mustLeave) continue
    const cost = Math.abs(q.x - s.x) + Math.abs(q.y - s.y)
    gScore[u * 4 + d] = cost
    came[u * 4 + d] = -1
    open.push(cost + h(u), u * 4 + d)
  }
  while (open.size) {
    const ck = open.pop()
    if (closed[ck]) continue
    closed[ck] = 1
    const cv = Math.floor(ck / 4), cd = (ck % 4) as Dir
    if (cv === goal && cd === mustArrive) {
      const pts: Point[] = [g.at(goal)]
      let k = ck
      while (came[k] >= 0) { k = came[k]; pts.push(g.at(Math.floor(k / 4))) }
      pts.push(g.at(start))
      return compressCollinear(pts.reverse())
    }
    const px = X[cv % W], py = Y[Math.floor(cv / W)]
    for (const u of g.neighbors(cv)) {
      // Neighbours are the four grid steps, and X and Y are sorted: ±1 is right/left, ±W down/up.
      const d: Dir = u === cv + 1 ? 0 : u === cv - 1 ? 2 : u > cv ? 1 : 3
      if (d === ((cd + 2) % 4)) continue // no U-turn
      const step = Math.abs(X[u % W] - px) + Math.abs(Y[Math.floor(u / W)] - py) + (d === cd ? 0 : BEND_COST)
      const nk = u * 4 + d
      const ng = gScore[ck] + step
      if (ng < gScore[nk]) {
        gScore[nk] = ng
        came[nk] = ck
        open.push(ng + h(u), nk)
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
  const attempt = (window: Box, blocked: Box[]): Point[] | null =>
    astar(buildGraph(blocked, ports, endpoints, window), ports[0], ports[1])
  const near = windowFor(a, b, WINDOW_PAD)
  const nearBlocked = obstaclesFor(edge, req, near)
  // A port strictly inside another node's margin (or inside the other endpoint) can be neither
  // left nor reached, so A* would exhaust the graph — twice, with the widening — before giving
  // up. Measured on the perf canvases and 1,700 random ones: every such search failed and no
  // successful route had one, so it goes straight to the fallback. The obstacle that holds a port
  // always meets the window, so the window's list is enough to decide.
  const portBlocked = ports.some((p) => [...nearBlocked, a, b].some((s) => containsStrict(s, p)))
  let points = portBlocked ? null : attempt(near, nearBlocked)
  const widened = !points && !portBlocked
  if (widened) {
    let all: Box = { x: 0, y: 0, width: 0, height: 0 }
    let first = true
    for (const n of req.nodes.values()) { all = first ? { ...n } : windowFor(all, n, 0); first = false }
    const wide = windowFor(all, all, WINDOW_PAD)
    points = attempt(wide, obstaclesFor(edge, req, wide))
  }
  const fallback = !points
  const pts = points ?? fallbackPoints(ports)
  return { points: pts, ports, fallback, widened, labelAt: labelPointOf(pts), bbox: bboxOfPoints(pts) }
}
