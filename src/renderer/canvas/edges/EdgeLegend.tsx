// The edge legend (spec Section 4): a bottom-left chip that expands to one row per LIVE kind (the
// reserved kinds have no producer yet and are left out) plus the two states a reader meets most.
// Expanded state is transient. The sample strokes come from the same look table the edges use, so
// the legend cannot drift from the canvas.
import { useState } from 'react'
import { Panel } from '@xyflow/react'
import { lookOf, type EdgeKind, type EdgeState } from '../../lib/edgeKinds'

export const LEGEND_ROWS: { label: string; kind: EdgeKind; state?: EdgeState; selected?: boolean }[] = [
  { label: 'Context', kind: 'context' },
  { label: 'Rope', kind: 'rope', state: { agentColor: '#d97757' } },
  { label: 'Waiting', kind: 'rope', state: { agentColor: '#d97757', waiting: true } },
  { label: 'Note', kind: 'note' },
  { label: 'Subagent / loop', kind: 'fanout', state: { agentColor: '#d97757' } },
  { label: 'Trigger', kind: 'trigger' },
  { label: 'Selected', kind: 'rope', state: { agentColor: '#d97757' }, selected: true }
]

export function EdgeLegendBody({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <div className={`edge-legend${open ? ' open' : ''}`}>
      <button type="button" className="edge-legend-chip" onClick={onToggle} aria-expanded={open}>
        Legend
      </button>
      {open && (
        <ul className="edge-legend-rows">
          {LEGEND_ROWS.map((r) => {
            const look = lookOf(r.kind, r.state, !!r.selected)
            return (
              <li key={r.label} className="edge-legend-row">
                <svg viewBox="0 0 40 8" width="40" height="8" aria-hidden>
                  <path d="M 1 4 H 39" style={{ stroke: look.color, strokeWidth: look.width, strokeDasharray: look.dash ?? undefined, opacity: look.opacity, fill: 'none' }} />
                </svg>
                <span>{r.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function EdgeLegend() {
  const [open, setOpen] = useState(false)
  return (
    <Panel position="bottom-left" className="edge-legend-panel">
      <EdgeLegendBody open={open} onToggle={() => setOpen((v) => !v)} />
    </Panel>
  )
}
