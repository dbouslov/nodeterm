// Full-page overlay: the project's node network at a glance (spec:
// docs/superpowers/specs/2026-09-11-network-overview-design.md §3). Its OWN read-only React Flow
// instance over the SERIALIZED project — nothing here parks, releases or spawns a PTY, and the main
// canvas stays mounted underneath.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, ReactFlow, ReactFlowProvider, type NodeMouseHandler } from '@xyflow/react'
import { agentConfig, type AgentId } from '@shared/agents/config'
import { circuitEdgeTypes, EdgeRouter } from '../../canvas/edges'
import { buildFindings, buildOverviewGraph, type Finding, type OverviewInput } from '../../lib/networkOverview'
import { relativeTime } from '../../lib/relativeTime'
import { overviewNodeTypes } from './OverviewNodes'

export interface NetworkOverviewViewProps {
  projectName: string
  projectColor: string
  input: OverviewInput
  onClose(): void
  onGoToNode(id: string): void
}

/**
 * The overview's React Flow id. EdgeRouter publishes routes keyed by `rfId`, and React Flow's
 * default ('1') is the main canvas's — sharing it would overwrite the canvas's edge routes.
 */
const OVERVIEW_FLOW_ID = 'network-overview'

const colorOf = (agentId: string): string | undefined => agentConfig(agentId as AgentId)?.color

function FindingRow({ f, now, onGo }: { f: Finding; now: number; onGo(id: string): void }) {
  const target = f.nodeId ?? f.groupId
  const meta = [f.byTitle ? `↻ ${f.byTitle}` : '', f.at !== undefined ? relativeTime(f.at, now) : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      type="button"
      className={`overview-finding overview-finding--${f.severity} overview-finding--${f.source}`}
      onClick={() => target && onGo(target)}
    >
      <span className="overview-finding__kind">{f.kind.replace(/-/g, ' ')}</span>
      <span className="overview-finding__text">{f.text}</span>
      {meta && <span className="overview-finding__meta">{meta}</span>}
    </button>
  )
}

export function NetworkOverviewView({ projectName, projectColor, input, onClose, onGoToNode }: NetworkOverviewViewProps) {
  // Transient on purpose (spec §3): the sidebar reopens with the overview.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const findings = useMemo(() => buildFindings(input), [input])

  // Take the keyboard off the canvas underneath: a terminal still focused there would eat Escape
  // (xterm sends ESC to the agent CLI and cancels the event) and every keystroke after it.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    rootRef.current?.focus()
  }, [])
  const graph = useMemo(() => buildOverviewGraph(input, colorOf, findings), [input, findings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog above the overview that already answered this Escape keeps the overview open.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onNodeClick: NodeMouseHandler = useCallback((_e, n) => onGoToNode(n.id), [onGoToNode])

  return (
    <div ref={rootRef} tabIndex={-1} className="overview-overlay" role="region" aria-label="Network overview">
      <div className="overview-header">
        <span className="overview-header__dot" style={{ background: projectColor }} />
        <span className="overview-header__name">{projectName}</span>
        <span className="overview-header__title">Network overview</span>
        <span className="overview-header__spacer" />
        <button
          type="button"
          className="overview-header__toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle findings"
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? '⟩' : '⟨'} {findings.length}
        </button>
        <button type="button" className="overview-header__close" onClick={onClose} aria-label="Close overview">
          ×
        </button>
      </div>
      <div className="overview-body">
        <div className="overview-graph">
          {/* Its own provider: without one, <ReactFlow> would join the MAIN canvas's store. */}
          <ReactFlowProvider>
            <ReactFlow
              id={OVERVIEW_FLOW_ID}
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={overviewNodeTypes}
              edgeTypes={circuitEdgeTypes}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.05}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              onNodeClick={onNodeClick}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} size={1} />
              <EdgeRouter edges={graph.edges} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        {sidebarOpen && (
          <aside className="overview-findings">
            <div className="overview-findings__head">Findings · {findings.length}</div>
            {findings.length === 0 && (
              <div className="overview-findings__empty">
                Nothing to flag. Roles and recommendations arrive from agents through <code>annotate</code>.
              </div>
            )}
            {findings.map((f) => (
              <FindingRow key={f.id} f={f} now={input.now} onGo={onGoToNode} />
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
