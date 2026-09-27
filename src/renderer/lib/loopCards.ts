import type { Edge } from '@xyflow/react'
import { agentConfig } from '@shared/agents/config'
import { oneLine } from '@shared/one-line'
import type { CanvasNode } from '../state/workspace'
import type { AgentNodeStatus } from '../state/agentStatus'
import type { EdgeData } from './edgeKinds'
import { containerOrigin, snapPointInRootSpace } from './gridSnap'

/**
 * The cron / schedule / loop cards drawn under an agent node: ONE builder for the canvas render
 * and for the canvas-control `list` / `geometry` verbs (issue #7). The cards are not React Flow
 * state — they are derived from `agentStatus.loop` plus the card's own UI overrides, and merged
 * into the `<ReactFlow>` prop only — so a verb reading the canvas's node array never saw them, and
 * `geometry` never reported one sitting on top of a node. Reading them through a second copy of
 * this rule would let the reported rect drift from the drawn one.
 */

/**
 * An ephemeral card's position: its parent agent's position plus either the offset the user
 * dragged it to or the laid-out default. Both live in the AGENT's coordinate space (the card
 * inherits the agent's `parentId`), which is the whole point of storing an offset — grouping or
 * ungrouping the agent flips that space between absolute and group-relative, and a stored
 * position would then teleport the card by the group's own x/y.
 *
 * `snap` (absent = off) rounds the LAID-OUT default onto the grid: React Flow's `snapToGrid` only
 * constrains a drag, so a fan-out card landed off-grid and only jumped into place once the user
 * nudged it. A DRAGGED offset is left alone — it was already snapped at drag time if the mode was
 * on, and re-rounding it here would move cards the user placed by hand while it was off.
 *
 * The snap carries its container's root-space `origin` because the composed position above is
 * container-relative, and React Flow's own drag snap works in root space — see
 * `snapPointInRootSpace`.
 */
export const offsetFrom = (
  parent: { position: { x: number; y: number } },
  stored: { x: number; y: number } | undefined,
  fallback: { x: number; y: number },
  snap?: { grid: number; origin: { x: number; y: number } }
): { x: number; y: number } => {
  const off = stored ?? fallback
  const position = { x: parent.position.x + off.x, y: parent.position.y + off.y }
  if (stored || !snap) {
    return position
  }
  return snapPointInRootSpace(position, snap.origin, snap.grid)
}

export interface LoopCardUi {
  /** Dragged offsets from the owning agent (useAgentNodes `positions`). */
  positions: Record<string, { x: number; y: number }>
  sizes: Record<string, { width: number; height: number }>
  expanded: Record<string, boolean>
  selectedId: string | null
  /** Grid the laid-out default rounds onto; 0 = snap off. */
  snap: number
}

/** Explicit width/height for an ephemeral card (so it resizes like any other node). Defaults
 *  switch with expand; a user resize override wins. */
export function ephemeralDims(
  ui: Pick<LoopCardUi, 'sizes' | 'expanded'>,
  id: string,
  baseW: number,
  expW: number,
  baseH: number,
  expH: number
): { width: number; height: number; style: { width: number; height: number } } {
  const sz = ui.sizes[id]
  const exp = !!ui.expanded[id]
  const width = sz?.width ?? (exp ? expW : baseW)
  const height = sz?.height ?? (exp ? expH : baseH)
  return { width, height, style: { width, height } }
}

/** Longest card title `list` / `geometry` print; the full task is on the card. */
export const LOOP_CARD_TITLE_MAX = 120

export function loopCardTitle(task: string | undefined): string {
  const t = oneLine(task ?? '')
  return t.length > LOOP_CARD_TITLE_MAX ? `${t.slice(0, LOOP_CARD_TITLE_MAX - 1)}…` : t
}

/** One loop card (plus its fan-out edge) per agent node on `nodes` with a live, undismissed loop.
 *  Pure. */
export function buildLoopCards(
  nodes: readonly CanvasNode[],
  byId: Readonly<Record<string, AgentNodeStatus>>,
  ui: LoopCardUi
): { nodes: CanvasNode[]; edges: Edge[] } {
  const eNodes: CanvasNode[] = []
  const eEdges: Edge[] = []
  for (const [pid, st] of Object.entries(byId)) {
    // A DISMISSED cron/schedule entry is kept on purpose (it is the hibernation guard's only
    // evidence that a wakeup is pending — see agentStatus's `loop.dismissed`), so the filter
    // lives here, in the render layer, and nowhere else.
    if (!st.loop || st.loop.dismissed) continue
    const parent = nodes.find((n) => n.id === pid)
    if (!parent || parent.data.hideFanout) continue
    const ph = parent.measured?.height ?? (parent.height as number) ?? 400
    const accent = agentConfig((parent.data.agentId as string) ?? 'claude')?.color ?? '#d97757'
    const snap = ui.snap ? { grid: ui.snap, origin: containerOrigin(parent.parentId, nodes as CanvasNode[]) } : undefined
    const lid = `loop-${pid}`
    eNodes.push({
      id: lid,
      type: 'loop',
      // parent.position is group-relative when the agent sits in a group frame; giving the
      // card the same parentId keeps this math in one coordinate space (and the card moves
      // with the group). Deliberately no extent:'parent' — the fan-out may hang below the
      // frame border without being clamped into it.
      ...(parent.parentId ? { parentId: parent.parentId } : {}),
      position: offsetFrom(parent, ui.positions[lid], { x: -250, y: ph + 60 }, snap),
      draggable: true,
      // NOT selectable: React Flow's rubber band would otherwise sweep a whole fan-out of cards
      // into the selection alongside the real nodes, and every selection action (Group,
      // Duplicate, Delete, colors) would then be handed ids it cannot act on — the frame ends up
      // drawn around the wrong things. Cards select one at a time, by click (`select` below).
      selectable: false,
      selected: ui.selectedId === lid,
      ...ephemeralDims(ui, lid, 230, 460, 92, 320),
      data: {
        // The card's NAME for `list` / `geometry` (the card itself draws `loopTask`). A cron prompt
        // is often multi-line, and `list` prints its title raw — one line, capped, or a prompt
        // holding "\nterm-x [claude] …" forges a row in every caller's listing.
        title: loopCardTitle(st.loop.task),
        color: accent,
        group: null,
        // The agent node this card belongs to — what `list` / `geometry` report as its owner.
        ownerNodeId: pid,
        loopCount: st.loop.count,
        loopItems: st.loop.items,
        loopActive: st.state === 'working',
        loopKind: st.loop.kind,
        loopSchedule: st.loop.schedule,
        loopTask: st.loop.task,
        ephExpanded: !!ui.expanded[lid]
      }
    } as CanvasNode)
    eEdges.push({
      id: `e-${lid}`,
      source: pid,
      type: 'circuit',
      target: lid,
      data: { kind: 'fanout', state: { working: st.state === 'working', agentColor: accent } } satisfies EdgeData,
      animated: st.state === 'working'
    })
  }
  return { nodes: eNodes, edges: eEdges }
}

/** `list` rows for the cards: the card id, its kind, its title and the agent node it hangs off. */
export function loopCardListRows(
  cards: readonly CanvasNode[]
): { id: string; kind: string; title: string; owner: string }[] {
  return cards.map((c) => ({
    id: c.id,
    kind: c.type ?? 'loop',
    title: typeof c.data.title === 'string' ? c.data.title : '',
    owner: String(c.data.ownerNodeId ?? '')
  }))
}
