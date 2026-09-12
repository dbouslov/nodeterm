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
  const out = new Set<string>()
  if (hovered) out.add(hovered)
  for (const e of edges) {
    if (e.selected || nodes.get(e.source)?.selected || nodes.get(e.target)?.selected) out.add(e.id)
  }
  return out
}
