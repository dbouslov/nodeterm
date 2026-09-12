// The canvas's ONE edge type (spec 2.2). Reads its route from useEdgeRoutes (published by
// EdgeRouter for this React Flow instance) and paints: the rounded orthogonal path, arrowheads as
// polygons, and — only while lit or selected — the two endpoint outlines and the label.
import { BaseEdge, EdgeLabelRenderer, useStore, type EdgeProps } from '@xyflow/react'
import type { EdgeData } from '../../lib/edgeKinds'
import { circuitEdgeModel } from './circuitEdgeModel'
import { useEdgeRoutes } from './edgeRoutes'

export function CircuitEdge(props: EdgeProps) {
  const { id, source, target, label, selected, interactionWidth = 16 } = props
  const rfId = useStore((s) => s.rfId)
  const flow = useEdgeRoutes((s) => s.byFlow[rfId])
  const route = flow?.routes.get(id)
  const data = props.data as EdgeData | undefined
  if (!route || !data?.kind || !flow) return null
  const m = circuitEdgeModel(
    route,
    data,
    { selected: !!selected, lit: flow.litSet.has(id), anyLit: flow.anyLit, hasLabel: !!label },
    [flow.nodes.get(source), flow.nodes.get(target)]
  )
  return (
    <g className={m.className}>
      <BaseEdge id={id} path={m.path} style={m.style} interactionWidth={interactionWidth} />
      {m.arrows.map((pts, i) => (
        <polygon key={i} points={pts} className="edge-arrow" style={{ fill: m.style.stroke, opacity: m.style.opacity }} />
      ))}
      {m.outlines.map((o, i) => (
        <rect key={i} x={o.x} y={o.y} width={o.width} height={o.height} rx={10} className="edge-outline" style={{ stroke: m.style.stroke }} />
      ))}
      {m.showLabel && (
        <EdgeLabelRenderer>
          <div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${route.labelAt.x}px, ${route.labelAt.y}px)`, color: m.style.stroke }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  )
}

export const circuitEdgeTypes = { circuit: CircuitEdge }
