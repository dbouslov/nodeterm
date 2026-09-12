// Card and frame renderers for the Network overview's own React Flow instance (spec §3). They draw
// precomputed `OverviewNodeData` (lib/networkOverview.ts) — no store reads, no handlers of their own.
import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import type { OverviewNodeData } from '../../lib/networkOverview'

type OverviewNodeProps = NodeProps<Node<OverviewNodeData>>

const KIND_GLYPH: Record<string, string> = {
  terminal: '▣',
  sticky: '🗒',
  editor: '✎',
  diff: '±',
  video: '▶',
  web: '⌂',
  browser: '◎',
  files: '🗂',
  dino: '🦖',
  trigger: '⏰'
}

export const OverviewNode = memo(function OverviewNode({ id, data }: OverviewNodeProps) {
  return (
    <div
      className={`ov-node ov-node--${data.statusKind}`}
      style={{ borderLeftColor: data.color }}
      data-node-id={id}
      title={data.title}
    >
      <div className="ov-node__head">
        <span className="ov-node__glyph" aria-hidden>
          {KIND_GLYPH[data.kind] ?? '▣'}
        </span>
        <span className="ov-node__title">{data.title || 'Untitled'}</span>
        {data.unread && <span className="ov-node__unread" aria-label="unread" />}
        {data.findingCount > 0 && <span className="ov-node__count">{data.findingCount}</span>}
      </div>
      <div className={`ov-node__role${data.role ? '' : ' ov-node__role--none'}`}>{data.role ?? 'no role'}</div>
      {data.textPreview && <pre className="ov-node__text">{data.textPreview}</pre>}
      {(data.statusLabel || data.chips.length > 0) && (
        <div className="ov-node__chips">
          {data.statusLabel && (
            <span className={`ov-chip ov-chip--${data.statusKind}`}>
              {data.statusLabel}
              {data.ageLabel ? ` · ${data.ageLabel}` : ''}
            </span>
          )}
          {data.chips.map((c) => (
            <span key={c} className="ov-chip ov-chip--verdict">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  )
})

export const OverviewGroup = memo(function OverviewGroup({ id, data }: OverviewNodeProps) {
  return (
    <div className="ov-group" style={{ borderColor: data.color }} data-node-id={id}>
      <span className="ov-group__label" style={{ borderColor: data.color }}>
        <span className="ov-group__dot" style={{ background: data.color }} />
        {data.title || 'Group'}
        {data.worktreeBranch && <span className="ov-group__branch">⎇ {data.worktreeBranch}</span>}
        {data.noLead && <span className="ov-group__nolead">no lead</span>}
      </span>
    </div>
  )
})

/** Frames register as `group`: the edge router treats only that type as a frame. */
export const overviewNodeTypes = { ovNode: OverviewNode, group: OverviewGroup }
