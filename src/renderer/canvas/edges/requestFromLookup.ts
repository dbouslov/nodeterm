// React Flow's node lookup → a RouteRequest (root-space boxes) and the SIGNATURE the router keys
// its memo on. Pure so it is testable without a React Flow store.
import type { Edge } from '@xyflow/react'
import type { EdgeData } from '../../lib/edgeKinds'
import type { RouteNode, RouteRequest } from '../../lib/edge-routing'

export interface InternalNodeLike {
  id: string
  type?: string
  parentId?: string
  hidden?: boolean
  selected?: boolean
  dragging?: boolean
  measured?: { width?: number; height?: number }
  internals: { positionAbsolute: { x: number; y: number } }
}

export function signatureOf(lookup: Iterable<InternalNodeLike>): string {
  let s = ''
  for (const n of lookup) {
    const w = n.measured?.width ?? 0, h = n.measured?.height ?? 0
    s += `${n.id}:${n.internals.positionAbsolute.x},${n.internals.positionAbsolute.y},${w},${h},${n.parentId ?? ''},${n.hidden ? 1 : 0}${n.selected ? 's' : ''}${n.dragging ? 'd' : ''}|`
  }
  return s
}

export function requestFromLookup(lookup: Iterable<InternalNodeLike>, edges: Edge[]): { req: RouteRequest; dragging: Set<string> } {
  const nodes = new Map<string, RouteNode>()
  const dragging = new Set<string>()
  for (const n of lookup) {
    const width = n.measured?.width ?? 0, height = n.measured?.height ?? 0
    if (!(width > 0) || !(height > 0)) continue
    nodes.set(n.id, { id: n.id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, width, height, parentId: n.parentId, isFrame: n.type === 'group', hidden: !!n.hidden, selected: !!n.selected, dragging: !!n.dragging })
    if (n.dragging) dragging.add(n.id)
  }
  const out: RouteRequest['edges'] = []
  for (const e of edges) {
    const d = e.data as EdgeData | undefined
    if (!d?.kind) continue
    out.push({ id: e.id, source: e.source, target: e.target, kind: d.kind, ropeKind: d.ropeKind })
  }
  return { req: { nodes, edges: out }, dragging }
}
