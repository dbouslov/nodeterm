// Routes per React Flow instance, plus which edges are LIT (hovered, selected, or touching a
// selected node). Keyed by rfId because two instances (canvas, overview) can be mounted at once.
import { create } from 'zustand'
import type { Route, RouteNode } from '../../lib/edge-routing'

export interface FlowRoutes {
  routes: Map<string, Route>
  nodes: Map<string, RouteNode>
  litSet: Set<string>
  anyLit: boolean
}

interface EdgeRoutesState {
  byFlow: Record<string, FlowRoutes>
  hovered: Record<string, string | null>
  publish(rfId: string, v: FlowRoutes): void
  setHovered(rfId: string, edgeId: string | null): void
}

export const useEdgeRoutes = create<EdgeRoutesState>((set) => ({
  byFlow: {},
  hovered: {},
  publish: (rfId, v) => set((s) => ({ byFlow: { ...s.byFlow, [rfId]: v } })),
  setHovered: (rfId, edgeId) => set((s) => (s.hovered[rfId] === edgeId ? s : { hovered: { ...s.hovered, [rfId]: edgeId } }))
}))

export function litSetFor(
  edges: { id: string; source: string; target: string; selected?: boolean }[],
  nodes: Map<string, RouteNode>,
  hovered: string | null
): Set<string> {
  // `hovered` is only honoured for an edge that is still HERE: the pointer leaves no `mouseleave`
  // behind when the edge it sat on is deleted, hidden by the eye, or dropped by a project switch,
  // so a stale id would light a ghost — `anyLit` true, every real edge dimmed to 0.2, nothing lit.
  const out = new Set<string>()
  for (const e of edges) {
    if (e.id === hovered || e.selected || nodes.get(e.source)?.selected || nodes.get(e.target)?.selected) out.add(e.id)
  }
  return out
}
