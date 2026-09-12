// WHERE AN AGENT-OPENED NODE GOES ON THE LIVE CANVAS — the live leg of the rule the cold open
// (`coldOpen.ts`) and the Server Edition's headless factory follow too: below the source (right of
// its `--after` deps), and a source inside a frame keeps what it opens inside that frame, which
// grows to hold it. Pure, because the control dispatch that uses it lives inside Canvas's IPC
// listener with no unit seam: Canvas passes `nodesRef.current` and applies the result with
// `setNodes`.

import { absolutePosition, type FocusableNode } from './nodeFocus'
import { coldPlaceBelow, type ColdNode } from './coldOpen'
import { addSelectionToGroup, type CanvasNode } from '../state/workspace'
import { centerOf, framesJoinedBy, placeOpened, type Box, type Point, type Size } from '@shared/placement'

/** A live node as the placement engine sees it: ROOT-space position (a frame child's stored
 *  position is frame-relative), then measured size, else stored size, else `dflt`. */
export const liveBox = (n: CanvasNode, all: readonly CanvasNode[], dflt: Size): Box => ({
  ...absolutePosition(n as FocusableNode, all as readonly FocusableNode[]),
  w: (n.measured?.width as number | undefined) ?? (n.width as number | undefined) ?? dflt.w,
  h: (n.measured?.height as number | undefined) ?? (n.height as number | undefined) ?? dflt.h
})

/** Every live node except `skip` as a ROOT-space box — what a new node must not land on. */
export function liveBoxesOf(all: readonly CanvasNode[], dflt: Size, skip?: ReadonlySet<string>): Box[] {
  return all.filter((n) => !skip?.has(n.id)).map((n) => liveBox(n, all, dflt))
}

/** The `--after` deps a node opened from `src` is placed beside: the live nodes `after` names,
 *  minus the source itself (waiting on the opener is still lineage, so that node stays below). */
function liveDeps(all: readonly CanvasNode[], src: CanvasNode, after: readonly string[], dflt: Size): Box[] {
  return after
    .filter((d) => d !== src.id)
    .flatMap((d) => all.filter((n) => n.id === d))
    .map((n) => liveBox(n, all, dflt))
}

/**
 * The frame an opened node is filed into (`withOpenedNode`): the source's innermost frame for a
 * LINEAGE child; none for a node placed beside `--after` deps — it stays top-level beside them.
 */
export function openedFrameId(
  all: readonly CanvasNode[],
  src: CanvasNode,
  after: readonly string[]
): string | undefined {
  return liveDeps(all, src, after, { w: 0, h: 0 }).length ? undefined : src.parentId
}

/**
 * Top-left (ROOT space) of the `index`-th node an agent opens from `src` — the control dispatch's
 * `placeNext`. `placeOpened` over every live node except `skip` (ephemeral cards) and, for a
 * LINEAGE child, the SOURCE'S OWN FRAMES (`framesJoinedBy`), plus `reserved` (siblings this call
 * already placed: `setNodes` is async, so the live array does not show them yet). A lineage child
 * is filed into the innermost frame (`withOpenedNode`), so the frames are not obstacles for it;
 * their other children are. A node beside `--after` deps stays top-level and clears every frame.
 */
export function livePlaceOpened(
  all: readonly CanvasNode[],
  src: CanvasNode,
  after: readonly string[],
  size: Size,
  index: number,
  opts: { reserved?: readonly Box[]; skip?: ReadonlySet<string> } = {}
): Point {
  const deps = liveDeps(all, src, after, size)
  const skip = new Set([...(opts.skip ?? []), ...framesJoinedBy(all, src.id, deps)])
  return placeOpened(
    [...liveBoxesOf(all, size, skip), ...(opts.reserved ?? [])],
    liveBox(src, all, { w: 600, h: 400 }),
    deps,
    size,
    index
  )
}

/**
 * CENTER of the `index`-th node placed below the source, NOT reserved — the control dispatch's
 * `placeBelow` (the display verbs, single-node opens, the members of a panel/team grid).
 * `offCanvas` is the source's own project when that project is not on screen: the live array is
 * then ANOTHER project's canvas, and measuring against it put the node wherever that canvas
 * happened to be clear. Off canvas the node is placed over the stored project by the cold rule.
 */
export function placeBelowSource(
  live: readonly CanvasNode[],
  src: CanvasNode,
  size: Size,
  index: number,
  opts: {
    reserved?: readonly Box[]
    skip?: ReadonlySet<string>
    offCanvas?: { nodes: readonly ColdNode[]; source: ColdNode }
  } = {}
): Point {
  if (opts.offCanvas) return coldPlaceBelow(opts.offCanvas.nodes, opts.offCanvas.source, index, { size })
  return centerOf(livePlaceOpened(live, src, [], size, index, opts), size)
}

/**
 * The live canvas with an agent-opened node added. `node.position` is ROOT space. A node opened
 * from a source inside a frame (`srcFrameId`) is filed into that frame and every frame up the
 * chain is re-fitted in the SAME transform — `extent: 'parent'` clamps a child that lands past its
 * frame's edge, which put it straight back onto its source. Converting here, against the frame as
 * it is in `nodes`, keeps a multi-node open right even when an earlier sibling's fit moved the
 * frame. A node that arrives already parented (`--group`: frame-relative, and `addGrouped` fits
 * once for the whole call) is appended untouched.
 */
export function withOpenedNode(
  nodes: CanvasNode[],
  node: CanvasNode,
  srcFrameId: string | undefined,
  grid = 0
): CanvasNode[] {
  if (node.parentId || !srcFrameId) return [...nodes, node]
  return addSelectionToGroup([...nodes, node], [node.id], srcFrameId, grid)
}
