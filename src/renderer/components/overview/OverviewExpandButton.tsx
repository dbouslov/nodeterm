// The minimap's way into the Network overview (spec §5): ⤢ over the minimap's top-left corner,
// with the findings count as a badge, hidden at zero. Presentational — the count comes from the
// caller, which owns the store subscriptions.
import { Panel } from '@xyflow/react'

export function OverviewExpandButton({ count, onOpen }: { count: number; onOpen(): void }) {
  return (
    <Panel position="bottom-right" className="minimap-expand-panel">
      <button
        type="button"
        className="minimap-expand"
        title="Network overview"
        aria-label="Network overview"
        onClick={onOpen}
      >
        ⤢{count > 0 && <span className="minimap-expand__badge">{count}</span>}
      </button>
    </Panel>
  )
}
