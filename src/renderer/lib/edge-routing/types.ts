// Types and constants for the orthogonal edge router (spec Section 3). Pure module: no React, no
// store. Boxes are ROOT space (a frame child's stored position is frame-relative; the caller
// resolves it through React Flow's positionAbsolute before building a request).
import type { Rect } from '../floatingEdge'
import type { EdgeKind } from '../edgeKinds'

export type Box = Rect
export interface Point { x: number; y: number }
export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface Port { x: number; y: number; side: Side }

export interface RouteNode extends Box {
  id: string
  parentId?: string
  isFrame: boolean
  hidden?: boolean
  selected?: boolean
  dragging?: boolean
}
export interface RouteEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  ropeKind?: 'opener' | 'dep'
}
export interface RouteRequest { nodes: Map<string, RouteNode>; edges: RouteEdge[] }
export interface Route {
  /** Corners only, first = source port, last = target port. */
  points: Point[]
  ports: [Port, Port]
  /** True when A* gave up and the plain three-segment path was used. */
  fallback: boolean
  labelAt: Point
  bbox: Box
}
export interface RoutedGraph { routes: Map<string, Route>; fallbacks: number }

/** Gutter every route keeps from a node it does not touch. Under half the 40 px gap the canvas's
 *  tidy layouts leave between neighbours: at 24 the two margins met inside that gap, the corridor
 *  closed, and most edges on a tidy grid fell back to the straight path (routeAll.test.ts). */
export const OBSTACLE_MARGIN = 16
/** Straight run out of a port before the first bend. */
export const PORT_STUB = 20
/** Between exits on one side of one node. */
export const PORT_SPACING = 12
/** Between parallel runs sharing a corridor. */
export const CHANNEL_SPACING = 12
/** Per direction change, in px-equivalents. */
export const BEND_COST = 60
/** Search window padding around the endpoint pair. */
export const WINDOW_PAD = 200
export const CORNER_RADIUS = 8
/** Inset from each end of a side before the first port. */
export const PORT_INSET = 16

export const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

export function outward(side: Side): Point {
  switch (side) {
    case 'top': return { x: 0, y: -1 }
    case 'right': return { x: 1, y: 0 }
    case 'bottom': return { x: 0, y: 1 }
    case 'left': return { x: -1, y: 0 }
  }
}
