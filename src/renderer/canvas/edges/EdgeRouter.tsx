// Mounted INSIDE <ReactFlow>. Subscribes to one primitive signature of the node lookup (never to
// the node array), routes every edge when it changes, and publishes to useEdgeRoutes under this
// instance's rfId. During a drag the previous graph and the moved ids go in, so only affected
// edges re-route (spec 2.1).
import { useEffect, useMemo, useRef } from 'react'
import { useStore, useStoreApi, type Edge } from '@xyflow/react'
import { routeAll, type RoutedGraph } from '../../lib/edge-routing'
import { litSetFor, useEdgeRoutes } from './edgeRoutes'
import { requestFromLookup, signatureOf } from './requestFromLookup'

export function EdgeRouter({ edges }: { edges: Edge[] }): null {
  const rfId = useStore((s) => s.rfId)
  const sig = useStore((s) => signatureOf(s.nodeLookup.values()))
  const hovered = useEdgeRoutes((s) => s.hovered[rfId] ?? null)
  const api = useStoreApi()
  const prevRef = useRef<RoutedGraph | undefined>(undefined)
  const graph = useMemo(() => {
    const { req, dragging } = requestFromLookup(api.getState().nodeLookup.values(), edges)
    const g = dragging.size ? routeAll(req, prevRef.current, dragging) : routeAll(req)
    prevRef.current = g
    return { g, nodes: req.nodes }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig stands in for the lookup
  }, [sig, edges])
  useEffect(() => {
    const litSet = litSetFor(edges, graph.nodes, hovered)
    useEdgeRoutes.getState().publish(rfId, { routes: graph.g.routes, nodes: graph.nodes, litSet, anyLit: litSet.size > 0 })
  }, [rfId, graph, edges, hovered])
  return null
}
