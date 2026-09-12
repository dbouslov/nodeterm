// Everything CircuitEdge draws, computed without React so it can be tested flat (spec 2.2, 4).
import { lookOf, type EdgeData } from '../../lib/edgeKinds'
import { arrowheadPoints, svgPathFrom, type Route, type RouteNode } from '../../lib/edge-routing'

export interface EdgeDrawing {
  path: string
  arrows: string[]
  outlines: { x: number; y: number; width: number; height: number }[]
  showLabel: boolean
  className: string
  style: { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity: number }
}

const OUTLINE_PAD = 4

export function circuitEdgeModel(
  route: Route,
  data: EdgeData,
  flags: { selected: boolean; lit: boolean; anyLit: boolean; hasLabel: boolean },
  endpoints: [RouteNode | undefined, RouteNode | undefined]
): EdgeDrawing {
  const look = lookOf(data.kind, data.state, flags.selected)
  const arrows: string[] = []
  if (look.arrowEnd) arrows.push(arrowheadPoints(route.points, 'end', look.arrowShape))
  if (look.arrowStart) arrows.push(arrowheadPoints(route.points, 'start', look.arrowShape))
  const focus = flags.lit || flags.selected
  const outlines = focus
    ? endpoints.filter((n): n is RouteNode => !!n).map((n) => ({ x: n.x - OUTLINE_PAD, y: n.y - OUTLINE_PAD, width: n.width + 2 * OUTLINE_PAD, height: n.height + 2 * OUTLINE_PAD }))
    : []
  const classes = [`edge-${data.kind}`]
  if (focus) classes.push('edge-lit')
  else if (flags.anyLit) classes.push('edge-dim')
  if (flags.selected) classes.push('edge-selected')
  if (look.animated) classes.push('edge-animated')
  if (route.fallback) classes.push('edge-fallback')
  return {
    path: svgPathFrom(route.points),
    arrows,
    outlines,
    showLabel: focus && flags.hasLabel,
    className: classes.join(' '),
    style: { stroke: look.color, strokeWidth: look.width, ...(look.dash ? { strokeDasharray: look.dash } : {}), opacity: look.opacity }
  }
}
