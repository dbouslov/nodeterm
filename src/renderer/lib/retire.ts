// `retire --successor <id>` — the canvas half. A retiring chat hands its place to a session it
// opened: the successor takes the caller's position, width and height as the caller would restore
// them (un-maximized, expanded), its parent frame and its kanban column; Canvas then closes the
// caller (deleteNodes), after the reply.
//
// MAIN has already decided whether the caller MAY (verified, and the successor its own current-run
// creation — `src/core/retire-verb.ts`). This decides the rest against the live canvas.
//
// PURE, so it is testable where the 12k-line component is not — same reasoning as closeTargets.ts.
import type { ProjectKanban } from '@shared/types'
import {
  fitGroupToChildren,
  isPinned,
  reparentNode,
  restoreMaximizedNode,
  shrinkPinnedGroupToChildren,
  type CanvasNode
} from '../state/workspace'
import { assignNode } from './kanban'

export type RetirePlan =
  | { error: string }
  /** The next canvas (the caller still on it — Canvas tears it down) and board (undefined = none yet). */
  | { nodes: CanvasNode[]; kanban: ProjectKanban | undefined }

export interface RetireInput {
  callerId: string
  successorId: string
  /** The caller's canvas — the live one, because retire travels as `move` does. */
  live: CanvasNode[]
  /** Another project holds the successor id: decides which refusal a missing successor gets. */
  successorElsewhere: boolean
  /** The caller's project board; undefined when it has none yet. */
  kanban: ProjectKanban | undefined
  grid: number
}

export function planRetire(input: RetireInput): RetirePlan {
  const { callerId, successorId, live, grid } = input
  if (successorId === callerId) {
    return { error: `retire: --successor names you (${callerId}) — name the session that replaces you` }
  }
  const successor = live.find((n) => n.id === successorId)
  if (!successor) {
    return {
      error: input.successorElsewhere
        ? `retire: ${successorId} is in another project — your successor must be on your own canvas`
        : `retire: no node with id ${successorId} on this canvas — nothing changed`
    }
  }
  if (successor.type !== 'terminal') {
    return { error: `retire: ${successorId} is not a session (terminal or agent) node — nothing changed` }
  }
  // The caller's LOGICAL rect, not its display rect. A maximized caller or successor is first put
  // back where its restore toggle would put it (every frame the maximize grew refits back down); a
  // collapsed caller hands over the height it expands to. The successor ends expanded and un-maximized.
  const base = restoreMaximizedNode(restoreMaximizedNode(live, callerId), successorId)
  const caller = base.find((n) => n.id === callerId)
  if (!caller) return { error: 'retire: your node is not on this canvas — nothing changed' }

  const width = caller.width ?? caller.measured?.width
  const height =
    (caller.data.collapsed ? caller.data.expandedHeight : undefined) ?? caller.height ?? caller.measured?.height
  let nodes = reparentNode(base, successorId, caller.parentId ?? null).map((n) =>
    n.id === successorId
      ? {
          ...n,
          position: { ...caller.position },
          width,
          height,
          style: { ...n.style, width, height },
          // Drop the stale measurement, as withNodeRect does: persistence prefers `measured`.
          measured: undefined,
          // The collapse toggle expands back to `expandedHeight`: a stale one would undo the handover.
          data: { ...n.data, collapsed: false, expandedHeight: height }
        }
      : n
  )
  // Refit every frame the swap touched, as `move` does. A pinned frame is the user's fixed layout:
  // it keeps its position and its children where they are, and never grows or moves. One the
  // successor entered from outside never grew for it, so it keeps its exact size; only the one the
  // successor was already in gives back the room its old slot took.
  for (const id of new Set([successor.parentId, caller.parentId])) {
    const frame = id ? nodes.find((n) => n.id === id) : undefined
    if (!frame || !nodes.some((n) => n.parentId === frame.id)) continue
    if (!isPinned(frame, nodes)) nodes = fitGroupToChildren(nodes, frame.id, grid)
    else if (frame.id === successor.parentId) nodes = shrinkPinnedGroupToChildren(nodes, frame.id, grid)
  }
  return { nodes, kanban: input.kanban && inheritColumn(input.kanban, callerId, successorId) }
}

/** The successor takes the caller's board slot: its column (Ungrouped included) and its place in it. */
function inheritColumn(k: ProjectKanban, callerId: string, successorId: string): ProjectKanban {
  const columns = new Set(k.columns.map((c) => c.id))
  const column =
    k.assignments.find((a) => a.nodeId === callerId && columns.has(a.columnId))?.columnId ?? null
  return assignNode(assignNode(k, successorId, column, callerId), callerId, null, null)
}
