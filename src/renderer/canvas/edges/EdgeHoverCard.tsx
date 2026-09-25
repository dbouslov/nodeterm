// The edge hover card (#40). Mounted INSIDE <ReactFlow> so it can read the hovered node's data from
// the flow's own lookup; painted into document.body at the pointer, offset so it never covers the
// point on the link the pointer is on (drag/select of the link stay reachable).
import { createPortal } from 'react-dom'
import { useStore } from '@xyflow/react'
import { useAgentStatus } from '../../state/agentStatus'
import { EDGE_CARD_STATUS_LABEL, edgeCardInfo, useEdgeHoverCard, type EdgeCardInfo } from './edgeHoverCardModel'

const OFFSET = 14

export function EdgeHoverCardView({
  info,
  x,
  y,
  onJump,
  onEnter,
  onLeave
}: {
  info: EdgeCardInfo
  x: number
  y: number
  onJump(nodeId: string): void
  onEnter(): void
  onLeave(): void
}) {
  return (
    <button
      type="button"
      className="edge-hover-card nodrag nopan"
      style={{ left: x + OFFSET, top: y + OFFSET }}
      title="Go to this node"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => onJump(info.nodeId)}
    >
      <span className="edge-hover-card__head">
        <span className="edge-hover-card__title">{info.title}</span>
        {info.status && (
          <span className={`edge-hover-card__status edge-hover-card__status--${info.status}`}>
            {EDGE_CARD_STATUS_LABEL[info.status]}
          </span>
        )}
      </span>
      {info.summary && <span className="edge-hover-card__summary">{info.summary}</span>}
    </button>
  )
}

export function EdgeHoverCard({ onJump }: { onJump(nodeId: string): void }) {
  const card = useEdgeHoverCard((s) => s.card)
  const nodeId = card?.nodeId
  const data = useStore((s) => (nodeId ? s.nodeLookup.get(nodeId)?.data : undefined))
  const status = useAgentStatus((s) => (nodeId ? s.byId[nodeId] : undefined))
  // The node went away under the card (deleted, project switch): show nothing, not a stale card.
  if (!card || !data) return null
  const { hold, leave, dismiss } = useEdgeHoverCard.getState()
  return createPortal(
    <EdgeHoverCardView
      info={edgeCardInfo(card.nodeId, data, status)}
      x={card.x}
      y={card.y}
      onEnter={hold}
      onLeave={leave}
      onJump={(id) => {
        dismiss()
        onJump(id)
      }}
    />,
    document.body
  )
}
