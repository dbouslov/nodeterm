import type { Edge } from '@xyflow/react'
import { agentConfig } from '@shared/agents/config'
import type { CanvasNode } from '../state/workspace'
import type { SubagentViz } from '../state/agentNodes'
import type { EdgeData } from './edgeKinds'
import { containerOrigin } from './gridSnap'
import { ephemeralDims, loopCardTitle, offsetFrom, type LoopCardUi } from './loopCards'
import { cardOffset, cardRowOf, clampToChat } from './cardBand'

/**
 * The subagent cards drawn under an agent node: ONE builder for the canvas render and for the
 * canvas-control `list` / `geometry` verbs — the loop-card rule (lib/loopCards), for the same
 * reason. The cards come from the transient `agentNodes` store and are merged into the
 * `<ReactFlow>` prop only, so a verb reading the canvas's node array never saw them.
 *
 * A card's id is the hook's own id for the subagent (claude's tool_use_id, codex's agent_id,
 * grok's subagentId) — there is no prefix, which is why `close` is handed the drawn card ids
 * (lib/closeTargets) rather than recognising them by shape.
 */

/** One card (plus its fan-out edge) per subagent whose agent is on `nodes`, in its agent's card row
 *  (lib/cardBand) after the loop card of an agent in `loopParents`. Pure. */
export function buildSubagentCards(
  nodes: readonly CanvasNode[],
  byId: Readonly<Record<string, SubagentViz>>,
  ui: LoopCardUi,
  loopParents: ReadonlySet<string> = new Set()
): { nodes: CanvasNode[]; edges: Edge[] } {
  const eNodes: CanvasNode[] = []
  const eEdges: Edge[] = []
  const byParent: Record<string, string[]> = {}
  for (const id of Object.keys(byId)) {
    ;(byParent[byId[id].parentNodeId] ??= []).push(id)
  }
  for (const [pid, childIds] of Object.entries(byParent)) {
    const parent = nodes.find((n) => n.id === pid)
    if (!parent || parent.data.hideFanout) continue
    const row = cardRowOf(parent, loopParents.has(pid), childIds, ui.sizes)
    const accent = agentConfig((parent.data.agentId as string) ?? 'claude')?.color ?? '#d97757'
    const snap = ui.snap ? { grid: ui.snap, origin: containerOrigin(parent.parentId, nodes as CanvasNode[]) } : undefined
    childIds.forEach((cid) => {
      const v = byId[cid]
      const dims = ephemeralDims(ui, cid, 230, 480, 96, 340)
      const width = clampToChat(parent, dims.width)
      eNodes.push({
        id: cid,
        type: 'subagent',
        // Same coordinate-space rule as the loop card: inherit the agent's group.
        ...(parent.parentId ? { parentId: parent.parentId } : {}),
        position: offsetFrom(parent, ui.positions[cid], cardOffset(parent, row, cid), snap),
        draggable: true,
        selectable: false, // see the loop card (lib/loopCards)
        selected: ui.selectedId === cid,
        // No wider than its agent, so the row never hangs past the agent's right edge.
        ...dims,
        width,
        style: { ...dims.style, width },
        data: {
          // The card's NAME for `list` / `geometry` (the card itself draws `subagentTask`): one
          // line, capped, or a task holding "\nterm-x [claude] …" forges a row in every listing.
          title: loopCardTitle(v.label),
          color: accent,
          group: null,
          // The agent node this card belongs to — what `list` / `geometry` report as its owner.
          ownerNodeId: pid,
          subagentTask: v.label ?? '',
          subagentType: v.type,
          subagentState: v.state,
          subagentStartedAt: v.startedAt,
          subagentDurationMs: v.durationMs,
          subagentTokens: v.tokens,
          subagentToolUses: v.toolUses,
          subagentResult: v.result,
          ephExpanded: !!ui.expanded[cid]
        }
      } as CanvasNode)
      eEdges.push({
        id: `e-${cid}`,
        source: pid,
        type: 'circuit',
        target: cid,
        data: { kind: 'fanout', state: { working: v.state === 'working', agentColor: accent } } satisfies EdgeData,
        animated: v.state === 'working'
      })
    })
  }
  return { nodes: eNodes, edges: eEdges }
}
