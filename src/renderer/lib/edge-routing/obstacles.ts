// The obstacle set for ONE edge (spec 3.2, decision 3). A frame that contains either endpoint is
// transparent (the route must be allowed to enter it) but its other members block; every other
// frame blocks as a whole and its members are dropped because the frame already covers them.
import type { Box, Point, RouteEdge, RouteNode, RouteRequest } from './types'
import { OBSTACLE_MARGIN } from './types'

export const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m })

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Strictly inside, with a small tolerance so a point ON the inflated border counts as outside. */
export const containsStrict = (b: Box, p: Point, eps = 0.5): boolean =>
  p.x > b.x + eps && p.x < b.x + b.width - eps && p.y > b.y + eps && p.y < b.y + b.height - eps

export function windowFor(a: Box, b: Box, pad: number): Box {
  const x = Math.min(a.x, b.x) - pad
  const y = Math.min(a.y, b.y) - pad
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) + pad - x, height: Math.max(a.y + a.height, b.y + b.height) + pad - y }
}

/** Every frame on the `parentId` chain above `id` (not `id` itself). Cycle-safe. */
export function ancestorFrames(id: string, nodes: Map<string, RouteNode>): Set<string> {
  const out = new Set<string>()
  let cur = nodes.get(id)?.parentId
  while (cur && !out.has(cur)) {
    out.add(cur)
    cur = nodes.get(cur)?.parentId
  }
  return out
}

export function obstaclesFor(edge: RouteEdge, req: RouteRequest, window?: Box): Box[] {
  const transparent = new Set([...ancestorFrames(edge.source, req.nodes), ...ancestorFrames(edge.target, req.nodes)])
  const out: Box[] = []
  for (const n of req.nodes.values()) {
    if (n.id === edge.source || n.id === edge.target || n.hidden) continue
    if (n.isFrame && transparent.has(n.id)) continue
    // Covered by an obstacle frame ⇒ skip (the frame is the obstacle).
    let covered = false
    for (const f of ancestorFrames(n.id, req.nodes)) if (!transparent.has(f)) { covered = true; break }
    if (covered) continue
    const box = inflate(n, OBSTACLE_MARGIN)
    if (window && !intersects(box, window)) continue
    out.push(box)
  }
  return out
}
