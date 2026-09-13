// Frames that follow their chats. When a node grows or shrinks, the siblings around it make room
// or close the gap, and every frame around it hugs its children again, up to the top level.
//
// THE RULES (each pinned in reflow.test.ts):
// 1. Siblings (same container) below the node and in its column band shift by how far its bottom
//    edge moved; siblings right of it and in its row band, by how far its right edge moved. The
//    bands are the node's rect BEFORE the change.
// 2. Growth pushes. A sibling that the grown node, or a pushed sibling, runs into moves on the way
//    it lay from its pusher (the shorter way for one off a corner, the shortest of the four for one
//    it already overlapped) and pushes in turn, until nothing it moved overlaps. A push keeps the
//    gap the pair had, capped at PLACEMENT_GAP. Shrink pulls the band back by at most the freed
//    space, and never closer to anything on the way than that same gap.
// 3. The changed node and pinned nodes (`isPinned`) never move; a sibling pushed onto one goes on
//    past it. Otherwise no sibling passes another it shares a column or row with: a push clears the
//    whole path it sweeps, not only the spot it lands on.
// 4. The parent frame then hugs its children (`fitAncestorChain`). A frame whose rect that changed
//    is the changed node one level up, its siblings moving by rules 1-3, and so on to the top level.
//
// Top and left edges have no band: growing up or left only pushes (rule 2), and shrinking from
// them pulls nothing. A pull reaches only the band, never what a push had moved beyond it.
//
// PURE. Canvas calls `reflow` when a hand resize ends, and `settle` when a drag inside a frame ends
// or a node joins a frame (`open-* --group`, `move --group`).
import type { NodeChange } from '@xyflow/react'
import { PLACEMENT_GAP } from '@shared/placement'
import { fitAncestorChain, isPinned, type CanvasNode } from '../state/workspace'
import type { Rect } from './nodeSizing'

// The measure the layout packs by, as in workspace.ts: React Flow's `measured` first.
const nodeW = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? 0

/** A node's rect in its container's space, the shape `reflow` takes as `prevRect`. */
export function nodeRect(n: CanvasNode): Rect {
  return { x: n.position.x, y: n.position.y, width: nodeW(n), height: nodeH(n) }
}

type Dir = 'down' | 'right' | 'up' | 'left'
const DIRS: readonly Dir[] = ['down', 'right', 'up', 'left'] // also the tie-break order
const vertical = (d: Dir): boolean => d === 'down' || d === 'up'
const sign = (d: Dir): number => (d === 'down' || d === 'right' ? 1 : -1)

// Edges as signed coordinates along `d`, so one comparison serves all four directions: larger is
// further along `d`. `lead` is the edge facing `d`, `trail` the one facing away.
const lead = (r: Rect, d: Dir): number =>
  vertical(d) ? (sign(d) > 0 ? r.y + r.height : -r.y) : sign(d) > 0 ? r.x + r.width : -r.x
const trail = (r: Rect, d: Dir): number =>
  vertical(d) ? (sign(d) > 0 ? r.y : -(r.y + r.height)) : sign(d) > 0 ? r.x : -(r.x + r.width)
const shift = (r: Rect, d: Dir, by: number): Rect =>
  vertical(d) ? { ...r, y: r.y + sign(d) * by } : { ...r, x: r.x + sign(d) * by }

/** `a` and `b` share a column (for up/down) or a row (for left/right). */
const across = (a: Rect, b: Rect, d: Dir): boolean =>
  vertical(d) ? a.x < b.x + b.width && b.x < a.x + a.width : a.y < b.y + b.height && b.y < a.y + a.height
const overlap = (a: Rect, b: Rect): boolean => across(a, b, 'down') && across(a, b, 'right')
/** How far `b` lies beyond `a` along `d`; negative when they overlap on that axis or `b` is behind. */
const gapAlong = (a: Rect, b: Rect, d: Dir): number => trail(b, d) - lead(a, d)

/** Rules 1-3 among the siblings of `changed`, whose rect was `prev` and is now its current one. */
function settleSiblings(nodes: CanvasNode[], changed: CanvasNode, prev: Rect): CanvasNode[] {
  const parentId = changed.parentId ?? null
  const siblings = nodes.filter((n) => n.id !== changed.id && (n.parentId ?? null) === parentId)
  if (siblings.length === 0) return nodes
  const cur = nodeRect(changed)
  // Every rect as this reflow found it (the changed node's from before its change), and as it is now.
  const was = new Map<string, Rect>(siblings.map((n) => [n.id, nodeRect(n)]))
  was.set(changed.id, prev)
  const at = new Map<string, Rect>(was)
  at.set(changed.id, cur)
  const fixed = new Set([changed.id, ...siblings.filter((n) => isPinned(n, nodes)).map((n) => n.id)])
  const movable = siblings.map((n) => n.id).filter((id) => !fixed.has(id))

  // The gap a pair keeps when one pushes or pulls toward the other: what it was, capped.
  const clearance = (a: string, b: string, d: Dir): number => {
    const gap = gapAlong(was.get(a)!, was.get(b)!, d)
    return gap >= 0 ? Math.min(PLACEMENT_GAP, gap) : PLACEMENT_GAP
  }
  const queue: { id: string; d: Dir }[] = []
  const move = (id: string, d: Dir, by: number): void => {
    at.set(id, shift(at.get(id)!, d, by))
    queue.push({ id, d })
  }

  // Rule 1: the bands, off the node's old rect.
  const dy = cur.y + cur.height - (prev.y + prev.height)
  const dx = cur.x + cur.width - (prev.x + prev.width)
  const band = (d: Dir) => movable.filter((id) => gapAlong(prev, was.get(id)!, d) >= 0 && across(prev, was.get(id)!, d))
  if (dy > 0) for (const id of band('down')) move(id, 'down', dy)
  if (dx > 0) for (const id of band('right')) move(id, 'right', dx)

  // Rule 2: what the node itself now overlaps moves off it, the way it lay from the node's old rect.
  for (const id of movable) {
    const r = at.get(id)!
    if (!overlap(cur, r)) continue
    const sides = DIRS.filter((d) => gapAlong(prev, was.get(id)!, d) >= 0)
    const need = (d: Dir): number => lead(cur, d) + clearance(changed.id, id, d) - trail(r, d)
    const d = (sides.length > 0 ? sides : DIRS).reduce((best, next) => (need(next) < need(best) ? next : best))
    move(id, d, need(d))
  }

  // Rule 2, the cascade: each mover pushes on the siblings ahead of it that it now reaches; a fixed
  // node it lands on, it goes past (rule 3). "Ahead" is the order this reflow found them in, so a
  // node the mover swept clear past is still pushed on ahead of it. A node is pushed only by nodes
  // that were behind it, so this ends; the budget only bounds a pathological canvas.
  for (let budget = 64 * (siblings.length + 1) ** 2; queue.length > 0 && budget > 0; budget--) {
    const { id, d } = queue.shift()!
    const p = at.get(id)!
    // Nearest first, so what lies before a fixed node is pushed before the mover goes past it.
    const inLine = [...at]
      .filter(([other, q]) => other !== id && across(p, q, d))
      .sort(([, a], [, b]) => trail(a, d) - trail(b, d))
    for (const [other, q] of inLine) {
      if (fixed.has(other)) {
        if (!overlap(p, q)) continue
        move(id, d, lead(q, d) + clearance(other, id, d) - trail(p, d))
        break
      }
      if (trail(was.get(other)!, d) > trail(was.get(id)!, d) && trail(q, d) < lead(p, d)) {
        move(other, d, lead(p, d) + clearance(id, other, d) - trail(q, d))
      }
    }
  }

  // Rule 2, shrink: pull the band back, nearest first, by at most the freed space, and never closer
  // to anything ahead than the pair's gap.
  const pull = (ids: string[], d: Dir, freed: number): void => {
    for (const id of ids.sort((a, b) => lead(at.get(b)!, d) - lead(at.get(a)!, d))) {
      const r = at.get(id)!
      let by = freed
      for (const [other, o] of at) {
        if (other === id || !across(r, o, d) || gapAlong(r, o, d) < 0) continue
        by = Math.min(by, gapAlong(r, o, d) - clearance(id, other, d))
      }
      if (by > 0) at.set(id, shift(r, d, by))
    }
  }
  if (dy < 0) pull(band('down'), 'up', -dy)
  if (dx < 0) pull(band('right'), 'left', -dx)

  let moved = false
  const out = nodes.map((n) => {
    const r = at.get(n.id)
    const w = was.get(n.id)
    if (n.id === changed.id || !r || !w || (r.x === w.x && r.y === w.y)) return n
    moved = true
    return { ...n, position: { x: r.x, y: r.y } }
  })
  return moved ? out : nodes
}

/**
 * Reflow the canvas after `changedId` changed from `prevRect` (its rect before the change, in its
 * container's space) to the rect it has in `nodes` now: its siblings make room or close the gap,
 * then each frame around it hugs its children and moves its own neighbours, up to the top level.
 * `grid` (0 = snapping off) is what the frames are fitted to, as in `fitGroupToChildren`.
 *
 * A caller that resized a node itself must drop its stale `measured` first (as `placeNodeInRect`
 * does): sizes are read `measured` first, so the old size would read as no change at all.
 */
export function reflow(nodes: CanvasNode[], changedId: string, prevRect: Rect, grid = 0): CanvasNode[] {
  const changed = nodes.find((n) => n.id === changedId)
  if (!changed) return nodes
  const settled = settleSiblings(nodes, changed, prevRect)
  return fitAncestorChain(settled, changed.parentId, grid, (fitted, frameId, unfitted) => {
    const was = unfitted.find((n) => n.id === frameId)
    const now = fitted.find((n) => n.id === frameId)
    if (!was || !now || was === now) return fitted
    // The fit writes width/height but leaves `measured` at the old size, and it is read first: drop
    // it, or this level and the next are laid out around the frame as it was.
    const frame = { ...now, measured: undefined }
    const prev = nodeRect(was)
    const next = nodeRect(frame)
    if (next.x === prev.x && next.y === prev.y && next.width === prev.width && next.height === prev.height) return fitted
    return settleSiblings(fitted.map((n) => (n.id === frameId ? frame : n)), frame, prev)
  })
}

/**
 * `reflow` for a node that moved rather than changed size: a drag ended, or it joined a frame.
 * Nothing grew, so no band moves; the siblings it now overlaps get out of its way, and the frames
 * around it hug, moving their own neighbours.
 */
export function settle(nodes: CanvasNode[], id: string, grid = 0): CanvasNode[] {
  const node = nodes.find((n) => n.id === id)
  return node ? reflow(nodes, id, nodeRect(node), grid) : nodes
}

/**
 * Resize bookkeeping for Canvas's `onNodesChange`. Remembers a node's rect when React Flow's
 * resizer first moves it (a `dimensions` change with `resizing: true`, read off `nodes` BEFORE the
 * change is applied) and hands it back when the resize ends (`resizing: false`). A measurement has
 * no `resizing` and is not a resize; an end that never started moved nothing.
 */
export function resizesEnded(
  changes: readonly NodeChange<CanvasNode>[],
  nodes: readonly CanvasNode[],
  started: Map<string, Rect>
): { id: string; prevRect: Rect }[] {
  const ended: { id: string; prevRect: Rect }[] = []
  for (const c of changes) {
    if (c.type !== 'dimensions' || typeof c.resizing !== 'boolean') continue
    if (c.resizing) {
      const n = started.has(c.id) ? undefined : nodes.find((x) => x.id === c.id)
      if (n) started.set(c.id, nodeRect(n))
      continue
    }
    const prevRect = started.get(c.id)
    started.delete(c.id)
    if (prevRect) ended.push({ id: c.id, prevRect })
  }
  return ended
}
