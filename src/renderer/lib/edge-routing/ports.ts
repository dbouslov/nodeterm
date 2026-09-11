// Which side an edge leaves and arrives on, and WHERE on that side (spec 3.1). Sides are fixed per
// kind so the picture is stable while nodes move; the flip rule keeps a fixed side from looping
// a route around its own node when the other endpoint sits behind that side's plane.
import { Position } from '@xyflow/react'
import { borderExit } from '../floatingEdge'
import { centre, PORT_INSET, PORT_SPACING, type Box, type Port, type RouteEdge, type RouteRequest, type Side } from './types'

const sideOf = (p: Position): Side =>
  p === Position.Top ? 'top' : p === Position.Right ? 'right' : p === Position.Bottom ? 'bottom' : 'left'

const dominant = (from: Box, toward: Box, sides: 'all' | 'horizontal'): Side => sideOf(borderExit(from, centre(toward), sides).position)

/** True when `toward`'s centre lies in front of `from`'s `side` (so leaving that side heads toward it). */
function inFront(from: Box, side: Side, toward: Box): boolean {
  const c = centre(toward)
  switch (side) {
    case 'bottom': return c.y > from.y + from.height
    case 'top': return c.y < from.y
    case 'right': return c.x > from.x + from.width
    case 'left': return c.x < from.x
  }
}

export function preferredSides(edge: RouteEdge, a: Box, b: Box): [Side, Side] {
  // The target side MIRRORS the source's rather than being asked separately: with the centres
  // stacked (dx = 0) borderExit answers `right` for both ends, and the route would loop round.
  if (edge.kind === 'context' || edge.kind === 'note') {
    const s = dominant(a, b, 'horizontal')
    return [s, s === 'right' ? 'left' : 'right']
  }
  let want: [Side, Side] | null = null
  if (edge.kind === 'fanout' || (edge.kind === 'rope' && edge.ropeKind === 'opener')) want = ['bottom', 'top']
  if (edge.kind === 'rope' && edge.ropeKind === 'dep') want = ['right', 'left']
  if (want && inFront(a, want[0], b) && inFront(b, want[1], a)) return want
  return [dominant(a, b, 'all'), dominant(b, a, 'all')]
}

interface Exit { edgeId: string; end: 0 | 1; along: number }

/** Every edge's two ports, with exits on one side spread PORT_SPACING apart, centred on the side's
 *  midpoint, sorted by heading so fan-out leaves in the order it travels. */
export function portsFor(req: RouteRequest): Map<string, [Port, Port]> {
  const out = new Map<string, [Port, Port]>()
  const bySide = new Map<string, Exit[]>() // `${nodeId}:${side}` → exits
  for (const e of req.edges) {
    const a = req.nodes.get(e.source)
    const b = req.nodes.get(e.target)
    if (!a || !b) continue
    const sides = preferredSides(e, a, b)
    const ca = centre(a)
    const cb = centre(b)
    const push = (nodeId: string, side: Side, end: 0 | 1, from: typeof ca, to: typeof cb) => {
      const key = `${nodeId}:${side}`
      const list = bySide.get(key) ?? []
      // The heading's component ALONG the side (cos on top/bottom, sin on left/right), so exits
      // sit in the order their targets lie along that side — left to right, top to bottom.
      const heading = Math.atan2(to.y - from.y, to.x - from.x)
      list.push({ edgeId: e.id, end, along: side === 'top' || side === 'bottom' ? Math.cos(heading) : Math.sin(heading) })
      bySide.set(key, list)
    }
    push(e.source, sides[0], 0, ca, cb)
    push(e.target, sides[1], 1, cb, ca)
  }
  const partial = new Map<string, [Port | undefined, Port | undefined]>()
  for (const [key, exits] of bySide) {
    const [nodeId, side] = key.split(':') as [string, Side]
    const box = req.nodes.get(nodeId)!
    const horizontal = side === 'top' || side === 'bottom'
    const len = horizontal ? box.width : box.height
    const mid = horizontal ? box.x + box.width / 2 : box.y + box.height / 2
    const fixed = horizontal ? (side === 'top' ? box.y : box.y + box.height) : side === 'left' ? box.x : box.x + box.width
    // Tie-break on id so the order never flickers.
    exits.sort((p, q) => p.along - q.along || p.edgeId.localeCompare(q.edgeId))
    const n = exits.length
    const usable = Math.max(0, len - 2 * PORT_INSET)
    const spacing = n > 1 ? Math.min(PORT_SPACING, usable / (n - 1)) : 0
    exits.forEach((ex, i) => {
      const along = mid + (i - (n - 1) / 2) * spacing
      const port: Port = horizontal ? { x: along, y: fixed, side } : { x: fixed, y: along, side }
      const pair = partial.get(ex.edgeId) ?? [undefined, undefined]
      pair[ex.end] = port
      partial.set(ex.edgeId, pair)
    })
  }
  for (const [id, pair] of partial) if (pair[0] && pair[1]) out.set(id, [pair[0], pair[1]])
  return out
}
