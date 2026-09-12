// `close --compact` — close nodes and leave no hole where they sat.
//
// WHY: `close` removes nodes and nothing else, so each frame keeps its size and its surviving
// children keep their spots, around a gap. An orchestrator tidying after a finished wave had to
// follow with `arrange` per frame — and then per enclosing frame, which the inner shrink left
// oversized. `--compact` does that right after the close, in the same decision.
//
// THE RULES (decided; each is pinned in closeCompact.test.ts):
// 1. Each frame that held a closed node, unless pinned, re-lays out its remaining children with
//    `arrangeNodes`' grid (the `arrange` verb's grid, default gap included), in reading order, at
//    the frame's column count, then hugs them (`fitGroupToChildren`).
// 2. Each enclosing frame whose child frame changed size gets the same, up the chain. The top
//    level is never re-laid out. There is no pin check on the way up: pinning is inherited
//    (`isPinned` — a frame carries its children), so a frame that is not pinned has no pinned
//    ancestor, and the walk "stops at the first pinned frame" by never starting under one.
// 3. A frame the close emptied stays where it is, empty. Ungrouping it is the caller's call.
//
// THE GRID A FRAME KEEPS is the one it had BEFORE the close, which is why this is a plan read off
// the canvas as the close found it and applied to the canvas the delete left:
// - columns: children are read in rows — sorted by top edge, a child joins the current row while
//   its top is above the middle of that row's FIRST child, each row then left to right — and the
//   column count is the longest row. `arrangeNodes` puts a row on one y, so an arranged frame
//   reads back exactly; a hand-placed one tolerates up to half a node of vertical drift. Closing a
//   2-column frame's whole right column therefore leaves 2 columns, not 1.
// - origin: the top-left of the children before the close, so closing a frame's top row pulls the
//   rest up instead of letting the frame's top edge follow them down.
//
// PURE, like `closeTargets.ts`: the Canvas dispatch plans before `deleteNodes` and applies in a
// `setNodes` updater after it.
import { arrangeNodes, fitGroupToChildren, isPinned, type CanvasNode } from '../state/workspace'

// The measure `arrangeNodes` packs by (see restructure.ts).
const nodeW = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? 0

/**
 * Did the caller pass `--compact`? Presence-based like `dryRunRequested`: the sh shim sends a
 * valueless flag as `arg.compact=` (empty), which must read as on. `false`/`no`/`0`/`off` are off.
 */
export function compactRequested(args: Record<string, string | undefined>): boolean {
  const v = args.compact
  if (v === undefined) return false
  return !/^(false|no|0|off)$/i.test(v.trim())
}

/** `nodes` as rows in reading order (the rule in the header). */
export function readingRows(nodes: readonly CanvasNode[]): CanvasNode[][] {
  const byTop = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const rows: CanvasNode[][] = []
  let rowMid = -Infinity
  for (const n of byTop) {
    if (rows.length > 0 && n.position.y < rowMid) {
      rows[rows.length - 1].push(n)
    } else {
      rows.push([n])
      rowMid = n.position.y + nodeH(n) / 2
    }
  }
  return rows.map((row) => row.sort((a, b) => a.position.x - b.position.x))
}

export interface CompactPlan {
  /** Frames that held a closed node and keep at least one child: re-packed. */
  frames: string[]
  /** Frames that held a closed node but are pinned, or sit inside a pinned frame: untouched. */
  pinned: string[]
  /** Frames every child of which was closed: left where they are, empty. */
  emptied: string[]
  /** The canvas as the close found it — every column count and origin is read from here. */
  before: readonly CanvasNode[]
}

/** Classify the frames a close of `closedIds` leaves a hole in. Run it BEFORE the delete. */
export function planCompaction(before: readonly CanvasNode[], closedIds: readonly string[]): CompactPlan {
  const closed = new Set(closedIds)
  const byId = new Map(before.map((n) => [n.id, n]))
  const plan: CompactPlan = { frames: [], pinned: [], emptied: [], before }
  const seen = new Set<string>()
  for (const id of closedIds) {
    const parentId = byId.get(id)?.parentId
    // A frame that is itself being closed has no hole to fill.
    if (!parentId || closed.has(parentId) || seen.has(parentId)) continue
    seen.add(parentId)
    const frame = byId.get(parentId)
    if (!frame || frame.type !== 'group') continue
    if (isPinned(frame, before)) plan.pinned.push(parentId)
    else if (before.some((n) => n.parentId === parentId && !closed.has(n.id))) plan.frames.push(parentId)
    else plan.emptied.push(parentId)
  }
  return plan
}

/** How many frames enclose `id`. Cycle-guarded like `isPinned`. */
function depthOf(id: string, nodes: readonly CanvasNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  let depth = 0
  let cur = byId.get(id)
  while (cur?.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    depth++
    cur = byId.get(cur.parentId)
  }
  return depth
}

/**
 * Apply `plan` to `after` — the canvas once the closed nodes are gone. Innermost frame first, so a
 * frame is re-laid out only once every frame inside it has its final size. Returns `after` itself
 * when there is nothing to re-pack.
 */
export function applyCompaction(after: CanvasNode[], plan: CompactPlan, grid = 0): CanvasNode[] {
  let next = after
  const pending = new Set(plan.frames)
  while (pending.size > 0) {
    const id = [...pending].reduce((a, b) => (depthOf(b, next) > depthOf(a, next) ? b : a))
    pending.delete(id)
    const frame = next.find((n) => n.id === id)
    const children = next.filter((n) => n.parentId === id)
    if (!frame || children.length === 0) continue
    const was = plan.before.filter((n) => n.parentId === id)
    const cols = Math.max(...readingRows(was).map((row) => row.length))
    const origin = {
      x: Math.min(...was.map((n) => n.position.x)),
      y: Math.min(...was.map((n) => n.position.y))
    }
    const order = readingRows(children).flat()
    // Only the children go in, in reading order: `arrangeNodes` lays members out in ARRAY order.
    const laid = new Map(
      arrangeNodes(order, order.map((n) => n.id), { layout: 'grid', cols, origin }).map((n) => [n.id, n.position])
    )
    next = next.map((n) => (laid.has(n.id) ? { ...n, position: laid.get(n.id)! } : n))
    next = fitGroupToChildren(next, id, grid)
    const fitted = next.find((n) => n.id === id)!
    if (fitted.width === nodeW(frame) && fitted.height === nodeH(frame)) continue
    // Drop the stale measurement (as `placeNodeInRect` does): `nodeW` prefers `measured`, so the
    // frame one level up would otherwise be laid out around this frame's OLD size.
    next = next.map((n) => (n.id === id ? { ...n, measured: undefined } : n))
    const parent = frame.parentId ? next.find((n) => n.id === frame.parentId) : undefined
    if (parent?.type === 'group') pending.add(parent.id)
  }
  return next
}

/** The reply's account of what `--compact` did. */
export function compactNote(plan: CompactPlan): string {
  const parts = [
    plan.frames.length ? `re-packed ${plan.frames.join(', ')}` : '',
    plan.pinned.length ? `left pinned ${plan.pinned.join(', ')} as is` : '',
    plan.emptied.length ? `left ${plan.emptied.join(', ')} empty (ungroup it)` : ''
  ].filter(Boolean)
  return ` — compact: ${parts.length ? parts.join('; ') : 'no frame held these nodes'}`
}
