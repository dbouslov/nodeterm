// WHERE AN AGENT-OPENED NODE GOES ON THE LIVE CANVAS — the live leg of the rule the cold open
// (`coldOpen.ts`) and the Server Edition's headless factory follow too: below the source (right of
// its `--after` deps), and a source inside a frame keeps what it opens inside that frame, which
// grows to hold it. Pure, because the control dispatch that uses it lives inside Canvas's IPC
// listener with no unit seam: Canvas passes `nodesRef.current` and applies the result with
// `setNodes`.

import { absolutePosition, type FocusableNode } from './nodeFocus'
import { addSelectionToGroup, type CanvasNode } from '../state/workspace'
import { ancestorFrameIds, placeOpened, type Box, type Point, type Size } from '@shared/placement'

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

/**
 * Top-left (ROOT space) of the `index`-th node an agent opens from `src` — the control dispatch's
 * `placeNext`. `placeOpened` over every live node except `skip` (ephemeral cards) and the SOURCE'S
 * OWN FRAMES, plus `reserved` (siblings this call already placed: `setNodes` is async, so the live
 * array does not show them yet). The frames are not obstacles because the node is filed into the
 * innermost one (`withOpenedNode`); their other children are. Waiting on the source itself is
 * still lineage, so that node stays below it rather than beside it.
 */
export function livePlaceOpened(
  all: readonly CanvasNode[],
  src: CanvasNode,
  after: readonly string[],
  size: Size,
  index: number,
  opts: { reserved?: readonly Box[]; skip?: ReadonlySet<string> } = {}
): Point {
  const skip = new Set([...(opts.skip ?? []), ...ancestorFrameIds(all, src.id)])
  const deps = after
    .filter((d) => d !== src.id)
    .flatMap((d) => all.filter((n) => n.id === d))
    .map((n) => liveBox(n, all, size))
  return placeOpened(
    [...liveBoxesOf(all, size, skip), ...(opts.reserved ?? [])],
    liveBox(src, all, { w: 600, h: 400 }),
    deps,
    size,
    index
  )
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
