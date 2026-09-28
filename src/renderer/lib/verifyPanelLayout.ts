// WHERE A `verify` REVIEW PANEL GOES (candidates item 3). The panel is a lineage child of the caller,
// so it follows the rule every agent-opened node follows (livePlacement.ts): it joins the CALLER's
// innermost frame, which grows to hold it and moves its own neighbours out of the way (lib/reflow).
// It used to be wrapped as a TOP-LEVEL frame placed below the caller — and since the caller's own
// frames are not obstacles for a node that joins them, that put the panel on top of the caller's
// frame. Five re-verifies left five overlapping "Verify:" frames over an orchestrator's frame.
//
// Two rules, both pure and pinned in verifyPanelLayout.test.ts:
// 1. A NEW panel is laid out as one box (members in a grid, wrapped in a frame) and that WHOLE box is
//    placed at the first clear child slot below the caller — not just its first member, which let
//    the rest of the grid and the frame's header land on whatever was there.
// 2. A re-verify with the SAME label, from the same container, reuses that panel frame: the new
//    round goes below the earlier one inside it. Nothing of the earlier round is closed (those are
//    sessions); the caller closes a finished round itself (`close --node … --compact`).

import { ancestorFrameIds, placeChild, type Box } from '@shared/placement'
import {
  arrangeNodes,
  groupSelectedNodes,
  reparentNode,
  rootPosition,
  GROUP_HEADER,
  GROUP_PAD,
  type CanvasNode
} from '../state/workspace'
import { liveBox, liveBoxesOf, openedFrameId } from './livePlacement'
import { settle } from './reflow'

const MEMBER = { w: 600, h: 400 }
const GAP = 40 // arrangeNodes' default gap, so a reused round sits as far below as rows sit apart

const w = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? MEMBER.w
const h = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? MEMBER.h

/**
 * Lay out a review panel whose member nodes are already in `nodes` (top-level, any position). The
 * caller is `srcId`; `skip` holds ids that are not obstacles (ephemeral cards). Returns the canvas,
 * the panel frame's id and whether an earlier same-label frame was reused.
 */
export function layoutVerifyPanel(
  nodes: CanvasNode[],
  opts: { srcId: string; panelIds: string[]; label: string; grid?: number; skip?: ReadonlySet<string> }
): { nodes: CanvasNode[]; groupId: string; reused: boolean } {
  const grid = opts.grid ?? 0
  const src = nodes.find((n) => n.id === opts.srcId)
  if (!src) throw new Error(`verify: no caller node ${opts.srcId}`)
  const container = openedFrameId(nodes, src, [])
  const panel = new Set(opts.panelIds)

  const earlier = nodes.find(
    (n) =>
      n.type === 'group' &&
      !panel.has(n.id) &&
      (n.parentId ?? undefined) === container &&
      (n.data.title as string | undefined) === opts.label
  )
  if (earlier) {
    // Rule 2: below the earlier round, inside its frame.
    const at = rootPosition(earlier, nodes)
    const kids = nodes.filter((n) => n.parentId === earlier.id)
    const bottom = kids.length
      ? Math.max(...kids.map((k) => at.y + k.position.y + h(k))) + GAP
      : at.y + GROUP_HEADER + GROUP_PAD
    let next = arrangeNodes(nodes, opts.panelIds, { layout: 'grid', origin: { x: at.x + GROUP_PAD, y: bottom } })
    for (const id of opts.panelIds) next = reparentNode(next, id, earlier.id)
    next = settle(next, opts.panelIds[0], grid)
    return { nodes: next, groupId: earlier.id, reused: true }
  }

  // Rule 1: build the panel box anywhere, then place the whole box.
  let next = arrangeNodes(nodes, opts.panelIds, { layout: 'grid', origin: { x: 0, y: 0 } })
  const groupsBefore = new Set(next.filter((n) => n.type === 'group').map((n) => n.id))
  next = groupSelectedNodes(next, opts.panelIds, groupsBefore.size, grid)
  const made = next.find((n) => n.type === 'group' && !groupsBefore.has(n.id))
  if (!made) throw new Error('verify: the panel could not be grouped')
  // Obstacles: every node but the panel itself, the ephemeral cards, and the frames the panel joins
  // (it is filed into those, and they grow to hold it; their other children still are obstacles).
  const skip = new Set([...(opts.skip ?? []), ...panel, made.id, ...ancestorFrameIds(nodes, src.id)])
  const obstacles: Box[] = liveBoxesOf(nodes, MEMBER, skip)
  const spot = placeChild(obstacles, liveBox(src, nodes, MEMBER), { w: w(made), h: h(made) }, 0)
  const snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v)
  next = next.map((n) =>
    n.id === made.id
      ? { ...n, position: { x: snap(spot.x), y: snap(spot.y) }, data: { ...n.data, title: opts.label } }
      : n
  )
  if (container) {
    next = reparentNode(next, made.id, container)
    next = settle(next, made.id, grid)
  }
  return { nodes: next, groupId: made.id, reused: false }
}
