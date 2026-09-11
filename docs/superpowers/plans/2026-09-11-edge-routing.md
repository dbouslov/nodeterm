# Edge Rendering and Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bezier `floating` edge with colour-and-style-coded, orthogonally routed
"circuit" edges that avoid nodes and foreign frames, bundle parallel runs, and light up on hover.

**Architecture:** A pure routing module (`src/renderer/lib/edge-routing/`: ports → obstacles →
visibility graph → A* → nudging → SVG path) with no React or store imports. A look table
(`lib/edgeKinds.ts`) maps an edge's KIND and STATE to colour, dash, width and arrows. Inside each
`<ReactFlow>` an `EdgeRouter` component routes every edge once per node-geometry change and
publishes the result to a tiny store keyed by the React Flow instance id; the `CircuitEdge`
component reads its route and paints it. `Canvas.tsx` stops styling edges inline and emits
`{ type: 'circuit', data: { kind, state } }`.

**Tech Stack:** TypeScript, React 18, `@xyflow/react` 12.11 (`useStore`, `BaseEdge`,
`EdgeLabelRenderer`, `Panel`), zustand, vitest (+ jsdom for component tests). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-11-edge-routing-design.md`

## Global Constraints

- No new npm dependency (spec Section 8). The router is hand-written.
- `src/renderer/lib/edge-routing/*` and `lib/edgeKinds.ts` import nothing from React, zustand,
  `@xyflow/react` (except `Position` and the `Rect` type from `../floatingEdge`), or any store.
- Constants, exact values (spec Section 3): `OBSTACLE_MARGIN = 24`, `PORT_STUB = 20`,
  `PORT_SPACING = 12`, `CHANNEL_SPACING = 12`, `BEND_COST = 60`, `WINDOW_PAD = 200`,
  `CORNER_RADIUS = 8`.
- Colour tokens (dark / light): `--edge-context: var(--accent)`, `--edge-note: #ffd60a / #b58a00`,
  `--edge-trigger: #bf5af2 / #8e44c9`, `--edge-annotation: #6ac4dc / #1f8fa8`,
  `--edge-handoff: #ff9f0a / #c97400`, `--edge-neutral: #8e8e93` both. Selected = `#ffffff`,
  driven = `#d97757`.
- Kind order for bundling: `context, rope, note, fanout, trigger, annotation, handoff`.
- Edge label strings are pinned by `src/renderer/canvas/edge-model.source.test.ts` and must
  survive unchanged: `` `${WAIT_LABEL} · ⌫ to stop waiting` ``, `'⇄ context · ⌫ to remove'`,
  `'⌫ to remove'`, `'⇄ context'`, `'🗒 note'`.
- Never `=== 'claude'` at a call site; agent colour comes from `agentConfig(id)?.color`.
- English in code, comments and UI. No "this Mac" in copy. `git diff --check`, `npm run typecheck`,
  `npm test` pass before the PR.
- Run tests with `npx vitest run <path>`; the worktree needs `npm install` first (node-pty is
  patched and rebuilt by it).

---

## File map

| File | Responsibility |
|---|---|
| `src/renderer/lib/edgeKinds.ts` (new) | `EdgeKind`, `EdgeState`, `EdgeData`, `KIND_ORDER`, `lookOf`, `edgeAnimated` |
| `src/renderer/lib/edge-routing/types.ts` (new) | shared types + constants |
| `src/renderer/lib/edge-routing/ports.ts` (new) | side per kind, flip rule, spread |
| `src/renderer/lib/edge-routing/obstacles.ts` (new) | obstacle set per edge, inflate, window, intersects |
| `src/renderer/lib/edge-routing/visibility.ts` (new) | candidate lines → vertices → adjacency |
| `src/renderer/lib/edge-routing/route.ts` (new) | A*, direction constraints, widening, fallback polyline |
| `src/renderer/lib/edge-routing/nudge.ts` (new) | channels and offsets |
| `src/renderer/lib/edge-routing/svgPath.ts` (new) | path string, arrowhead, label point, bbox |
| `src/renderer/lib/edge-routing/index.ts` (new) | `routeAll` full + incremental |
| `src/renderer/canvas/edges/edgeRoutes.ts` (new) | zustand store: routes per flow id, lit set, hover |
| `src/renderer/canvas/edges/EdgeRouter.tsx` (new) | reads React Flow's node lookup, runs `routeAll`, publishes |
| `src/renderer/canvas/edges/CircuitEdge.tsx` (new) | the edge component + `circuitEdgeTypes` |
| `src/renderer/canvas/edges/circuitEdgeModel.ts` (new) | pure "what to draw" for one edge |
| `src/renderer/canvas/edges/EdgeLegend.tsx` (new) | legend chip + body |
| `src/renderer/canvas/FloatingEdge.tsx` | deleted |
| `src/renderer/lib/triggerCard.ts` | `triggerEdges` drops `accent`, emits kind |
| `src/renderer/canvas/Canvas.tsx` | `displayEdges`, fan-out edges, `edgeTypes`, mounts, hover handlers |
| `src/renderer/styles.css` | tokens, `.edge-*` classes, legend |
| `CLAUDE.md`, `CONTRIBUTING.md` | the two edge paragraphs |

---

### Task 1: Edge kinds and the look table

**Files:**
- Create: `src/renderer/lib/edgeKinds.ts`
- Test: `src/renderer/lib/edgeKinds.test.ts`

**Interfaces:**
- Consumes: `ROPE_NEUTRAL` from `./edgeModel`.
- Produces:
  ```ts
  export type EdgeKind = 'context' | 'note' | 'rope' | 'fanout' | 'trigger' | 'annotation' | 'handoff'
  export const KIND_ORDER: readonly EdgeKind[]
  export interface EdgeState { waiting?: boolean; driven?: boolean; working?: boolean; agentColor?: string }
  export interface EdgeData { kind: EdgeKind; state?: EdgeState; ropeKind?: 'opener' | 'dep' }
  export interface EdgeLook { color: string; dash: string | null; width: number; opacity: number; arrowStart: boolean; arrowEnd: boolean; arrowShape: 'triangle' | 'diamond'; animated: boolean }
  export function lookOf(kind: EdgeKind, state?: EdgeState, selected?: boolean): EdgeLook
  export function edgeAnimated(kind: EdgeKind, state?: EdgeState): boolean
  export const SELECTED_COLOR = '#ffffff'
  export const DRIVEN_COLOR = '#d97757'
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edgeKinds.test.ts
import { describe, it, expect } from 'vitest'
import { KIND_ORDER, lookOf, edgeAnimated, SELECTED_COLOR, DRIVEN_COLOR, type EdgeKind } from './edgeKinds'
import { ROPE_NEUTRAL } from './edgeModel'

const KINDS: EdgeKind[] = ['context', 'note', 'rope', 'fanout', 'trigger', 'annotation', 'handoff']

describe('edge look table', () => {
  it('every kind has a look and KIND_ORDER lists each exactly once', () => {
    for (const k of KINDS) expect(lookOf(k)).toBeTruthy()
    expect([...KIND_ORDER].sort()).toEqual([...KINDS].sort())
  })
  it('no two kinds share both hue and dash (decision 1: colourblind-safe)', () => {
    const seen = new Set<string>()
    for (const k of KINDS) {
      const l = lookOf(k, { agentColor: '#d97757' })
      const key = `${l.color}|${l.dash ?? 'solid'}`
      expect(seen.has(key), `${k} collides on ${key}`).toBe(false)
      seen.add(key)
    }
  })
  it('context: accent token, solid, arrows both ends; note: dotted, one arrow', () => {
    expect(lookOf('context')).toMatchObject({ color: 'var(--edge-context)', dash: null, width: 2, arrowStart: true, arrowEnd: true })
    expect(lookOf('note')).toMatchObject({ color: 'var(--edge-note)', dash: '2 4', arrowStart: false, arrowEnd: true })
  })
  it('rope: agent colour or neutral; dashed and animated only while waiting', () => {
    expect(lookOf('rope', { agentColor: '#10a37f' })).toMatchObject({ color: '#10a37f', dash: null, animated: false })
    expect(lookOf('rope')).toMatchObject({ color: ROPE_NEUTRAL })
    expect(lookOf('rope', { agentColor: '#10a37f', waiting: true })).toMatchObject({ dash: '6 4', animated: true })
  })
  it('fanout: parent colour at 0.55, dash-dot, no arrows, animated while working', () => {
    expect(lookOf('fanout', { agentColor: '#4285f4', working: true })).toMatchObject({ color: '#4285f4', opacity: 0.55, dash: '8 3 2 3', arrowEnd: false, animated: true })
    expect(lookOf('fanout', { agentColor: '#4285f4' }).animated).toBe(false)
  })
  it('overlays apply in order: driven, then selected wins', () => {
    expect(lookOf('rope', { agentColor: '#10a37f', driven: true })).toMatchObject({ color: DRIVEN_COLOR, width: 2.5, animated: true })
    expect(lookOf('rope', { agentColor: '#10a37f', driven: true }, true)).toMatchObject({ color: SELECTED_COLOR, width: 4 })
    expect(lookOf('context', undefined, true)).toMatchObject({ color: SELECTED_COLOR, width: 3.5 })
  })
  it('edgeAnimated agrees with lookOf', () => {
    expect(edgeAnimated('rope', { waiting: true })).toBe(true)
    expect(edgeAnimated('trigger')).toBe(false)
  })
  it('handoff uses a diamond head; everything else a triangle', () => {
    expect(lookOf('handoff').arrowShape).toBe('diamond')
    expect(lookOf('context').arrowShape).toBe('triangle')
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edgeKinds.test.ts`
Expected: FAIL, cannot resolve `./edgeKinds`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/edgeKinds.ts
// The look of every canvas edge, derived from its KIND and STATE at render time — never stored on
// the edge object (spec: docs/superpowers/specs/2026-09-11-edge-routing-design.md, Section 1).
// Hue AND dash pattern both encode the kind (decision 1), so a colourblind reader still tells
// them apart; the test pins that no two kinds share both. Pure: no React, no store, no React Flow.
import { ROPE_NEUTRAL } from './edgeModel'

export type EdgeKind = 'context' | 'note' | 'rope' | 'fanout' | 'trigger' | 'annotation' | 'handoff'

/** Bundling order: members of one channel sit side by side in this order so colours read as
 *  stable ribbons. */
export const KIND_ORDER: readonly EdgeKind[] = ['context', 'rope', 'note', 'fanout', 'trigger', 'annotation', 'handoff']

export interface EdgeState {
  /** rope: the target is still armed on this source. */
  waiting?: boolean
  /** rope: the target is a driven browser. */
  driven?: boolean
  /** fanout: the subagent / loop card is working. */
  working?: boolean
  /** rope / fanout: the source agent's brand colour; absent ⇒ neutral. */
  agentColor?: string
}

/** What rides `edge.data` for every circuit edge. */
export interface EdgeData {
  kind: EdgeKind
  state?: EdgeState
  /** Smart Spawning's rope kind, when present; picks the port sides. */
  ropeKind?: 'opener' | 'dep'
}

export interface EdgeLook {
  color: string
  dash: string | null
  width: number
  opacity: number
  arrowStart: boolean
  arrowEnd: boolean
  arrowShape: 'triangle' | 'diamond'
  animated: boolean
}

export const SELECTED_COLOR = '#ffffff'
export const DRIVEN_COLOR = '#d97757'

interface KindLook {
  color: string | 'agent'
  dash: string | null
  width: number
  opacity: number
  arrowStart: boolean
  arrowEnd: boolean
  arrowShape: 'triangle' | 'diamond'
}

const TABLE: Record<EdgeKind, KindLook> = {
  context: { color: 'var(--edge-context)', dash: null, width: 2, opacity: 1, arrowStart: true, arrowEnd: true, arrowShape: 'triangle' },
  note: { color: 'var(--edge-note)', dash: '2 4', width: 2, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  rope: { color: 'agent', dash: null, width: 1.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  fanout: { color: 'agent', dash: '8 3 2 3', width: 1.25, opacity: 0.55, arrowStart: false, arrowEnd: false, arrowShape: 'triangle' },
  trigger: { color: 'var(--edge-trigger)', dash: '12 6', width: 1.5, opacity: 0.7, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  annotation: { color: 'var(--edge-annotation)', dash: '3 3', width: 1.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  handoff: { color: 'var(--edge-handoff)', dash: null, width: 2.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'diamond' }
}

export function edgeAnimated(kind: EdgeKind, state: EdgeState = {}): boolean {
  if (kind === 'rope') return !!state.waiting || !!state.driven
  if (kind === 'fanout') return !!state.working
  return false
}

export function lookOf(kind: EdgeKind, state: EdgeState = {}, selected = false): EdgeLook {
  const base = TABLE[kind]
  let look: EdgeLook = {
    color: base.color === 'agent' ? (state.agentColor ?? ROPE_NEUTRAL) : base.color,
    dash: kind === 'rope' && state.waiting ? '6 4' : base.dash,
    width: base.width,
    opacity: base.opacity,
    arrowStart: base.arrowStart,
    arrowEnd: base.arrowEnd,
    arrowShape: base.arrowShape,
    animated: edgeAnimated(kind, state)
  }
  // Overlays, in order: driven < selected. Each replaces colour; selected also thickens.
  if (kind === 'rope' && state.driven) look = { ...look, color: DRIVEN_COLOR, width: 2.5, animated: true }
  if (selected) look = { ...look, color: SELECTED_COLOR, width: look.width + 1.5 }
  return look
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edgeKinds.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/edgeKinds.ts src/renderer/lib/edgeKinds.test.ts
git commit -m "feat(edges): kind + state look table for circuit edges"
```

---

### Task 2: Routing types and ports

**Files:**
- Create: `src/renderer/lib/edge-routing/types.ts`, `src/renderer/lib/edge-routing/ports.ts`
- Test: `src/renderer/lib/edge-routing/ports.test.ts`

**Interfaces:**
- Consumes: `borderExit`, `Rect` from `../floatingEdge`; `Position` from `@xyflow/react`; `EdgeKind` from `../edgeKinds`.
- Produces (types.ts):
  ```ts
  export type Box = Rect                                   // { x, y, width, height }, root space
  export interface Point { x: number; y: number }
  export type Side = 'top' | 'right' | 'bottom' | 'left'
  export interface Port { x: number; y: number; side: Side }
  export interface RouteNode extends Box { id: string; parentId?: string; isFrame: boolean; hidden?: boolean; selected?: boolean; dragging?: boolean }
  export interface RouteEdge { id: string; source: string; target: string; kind: EdgeKind; ropeKind?: 'opener' | 'dep' }
  export interface RouteRequest { nodes: Map<string, RouteNode>; edges: RouteEdge[] }
  export interface Route { points: Point[]; ports: [Port, Port]; fallback: boolean; labelAt: Point; bbox: Box }
  export interface RoutedGraph { routes: Map<string, Route>; fallbacks: number }
  export const OBSTACLE_MARGIN = 24, PORT_STUB = 20, PORT_SPACING = 12, CHANNEL_SPACING = 12, BEND_COST = 60, WINDOW_PAD = 200, CORNER_RADIUS = 8
  export function centre(b: Box): Point
  export function outward(side: Side): Point                // unit normal, e.g. right → {1,0}
  ```
- Produces (ports.ts):
  ```ts
  export function preferredSides(edge: RouteEdge, a: Box, b: Box): [Side, Side]
  export function portsFor(req: RouteRequest): Map<string, [Port, Port]>   // edge id → ports, spread applied
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edge-routing/ports.test.ts
import { describe, it, expect } from 'vitest'
import { preferredSides, portsFor } from './ports'
import { PORT_SPACING, type RouteEdge, type RouteNode, type RouteRequest } from './types'

const node = (id: string, x: number, y: number, width = 200, height = 100): RouteNode => ({ id, x, y, width, height, isFrame: false })
const req = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((n) => [n.id, n])), edges })

describe('preferredSides', () => {
  const a = node('a', 0, 0)
  it('context and note leave left/right only, even for a target straight below', () => {
    const below = node('b', 0, 400)
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'context' }, a, below)).toEqual(['right', 'left'])
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'note' }, a, below)).toEqual(['right', 'left'])
  })
  it('an opener rope leaves the bottom and arrives at the top', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'opener' }, a, node('b', 300, 400))).toEqual(['bottom', 'top'])
  })
  it('a dep rope runs right to left', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'dep' }, a, node('b', 400, 20))).toEqual(['right', 'left'])
  })
  it('flip rule: a child dragged ABOVE its opener falls back to the dominant axis', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'opener' }, a, node('b', 20, -400))).toEqual(['top', 'bottom'])
  })
  it('an untagged rope and a trigger use the dominant axis', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope' }, a, node('b', 600, 10))).toEqual(['right', 'left'])
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'trigger' }, a, node('b', 10, 600))).toEqual(['bottom', 'top'])
  })
})

describe('portsFor — spread along a side', () => {
  it('three ropes leaving one bottom sit PORT_SPACING apart, centred, ordered by heading', () => {
    const hub = node('hub', 0, 0)
    const kids = [node('l', -300, 300), node('m', 0, 300), node('r', 300, 300)]
    const edges: RouteEdge[] = kids.map((k) => ({ id: `e-${k.id}`, source: 'hub', target: k.id, kind: 'rope', ropeKind: 'opener' }))
    const ports = portsFor(req([hub, ...kids], edges))
    const xs = ['l', 'm', 'r'].map((k) => ports.get(`e-${k}`)![0].x)
    expect(xs).toEqual([100 - PORT_SPACING, 100, 100 + PORT_SPACING])
    for (const k of ['l', 'm', 'r']) expect(ports.get(`e-${k}`)![0]).toMatchObject({ y: 100, side: 'bottom' })
  })
  it('compresses when the side is too short for the spread', () => {
    const hub = node('hub', 0, 0, 60, 100) // 60 wide, 16px inset each end ⇒ 28px usable
    const kids = Array.from({ length: 5 }, (_, i) => node(`k${i}`, -400 + i * 200, 300))
    const edges: RouteEdge[] = kids.map((k) => ({ id: `e-${k.id}`, source: 'hub', target: k.id, kind: 'rope', ropeKind: 'opener' }))
    const ports = portsFor(req([hub, ...kids], edges))
    const xs = edges.map((e) => ports.get(e.id)![0].x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(28)
    expect(new Set(xs).size).toBe(5) // still distinct
  })
  it('is deterministic', () => {
    const r = req([node('a', 0, 0), node('b', 400, 0)], [{ id: 'e', source: 'a', target: 'b', kind: 'context' }])
    expect(portsFor(r)).toEqual(portsFor(r))
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/ports.test.ts`
Expected: FAIL, cannot resolve `./ports`.

- [ ] **Step 3: Implement types.ts**

```ts
// src/renderer/lib/edge-routing/types.ts
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

/** Gutter every route keeps from a node it does not touch. */
export const OBSTACLE_MARGIN = 24
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
```

- [ ] **Step 4: Implement ports.ts**

```ts
// src/renderer/lib/edge-routing/ports.ts
// Which side an edge leaves and arrives on, and WHERE on that side (spec 3.1). Sides are fixed per
// kind so the picture is stable while nodes move; the flip rule keeps a fixed side from looping
// a route around its own node when the other endpoint sits behind that side's plane.
import { Position } from '@xyflow/react'
import { borderExit } from '../floatingEdge'
import { centre, PORT_INSET, PORT_SPACING, type Box, type Port, type RouteEdge, type RouteRequest, type Side } from './types'

const sideOf = (p: Position): Side =>
  p === Position.Top ? 'top' : p === Position.Right ? 'right' : p === Position.Bottom ? 'bottom' : 'left'

const dominant = (from: Box, toward: Box, sides: 'all' | 'horizontal'): Side => sideOf(borderExit(from, centre(toward), sides).position)

/** True when `toward`'s centre lies in front of `from`'s `side` (so leaving that side heads toward it). */
function inFront(from: Box, side: Side, toward: Box): boolean {
  const c = centre(toward)
  switch (side) {
    case 'bottom': return c.y > from.y + from.height
    case 'top': return c.y < from.y
    case 'right': return c.x > from.x + from.width
    case 'left': return c.x < from.x
  }
}

export function preferredSides(edge: RouteEdge, a: Box, b: Box): [Side, Side] {
  if (edge.kind === 'context' || edge.kind === 'note') return [dominant(a, b, 'horizontal'), dominant(b, a, 'horizontal')]
  let want: [Side, Side] | null = null
  if (edge.kind === 'fanout' || (edge.kind === 'rope' && edge.ropeKind === 'opener')) want = ['bottom', 'top']
  if (edge.kind === 'rope' && edge.ropeKind === 'dep') want = ['right', 'left']
  if (want && inFront(a, want[0], b) && inFront(b, want[1], a)) return want
  return [dominant(a, b, 'all'), dominant(b, a, 'all')]
}

interface Exit { edgeId: string; end: 0 | 1; heading: number }

/** Every edge's two ports, with exits on one side spread PORT_SPACING apart, centred on the side's
 *  midpoint, sorted by heading so fan-out leaves in the order it travels. */
export function portsFor(req: RouteRequest): Map<string, [Port, Port]> {
  const out = new Map<string, [Port, Port]>()
  const bySide = new Map<string, Exit[]>() // `${nodeId}:${side}` → exits
  const sidesOf = new Map<string, [Side, Side]>()
  for (const e of req.edges) {
    const a = req.nodes.get(e.source)
    const b = req.nodes.get(e.target)
    if (!a || !b) continue
    const sides = preferredSides(e, a, b)
    sidesOf.set(e.id, sides)
    const ca = centre(a)
    const cb = centre(b)
    const push = (nodeId: string, side: Side, end: 0 | 1, from: typeof ca, to: typeof cb) => {
      const key = `${nodeId}:${side}`
      const list = bySide.get(key) ?? []
      list.push({ edgeId: e.id, end, heading: Math.atan2(to.y - from.y, to.x - from.x) })
      bySide.set(key, list)
    }
    push(e.source, sides[0], 0, ca, cb)
    push(e.target, sides[1], 1, cb, ca)
  }
  const partial = new Map<string, [Port | undefined, Port | undefined]>()
  for (const [key, exits] of bySide) {
    const [nodeId, side] = key.split(':') as [string, Side]
    const box = req.nodes.get(nodeId)!
    const horizontal = side === 'top' || side === 'bottom'
    const len = horizontal ? box.width : box.height
    const mid = horizontal ? box.x + box.width / 2 : box.y + box.height / 2
    const fixed = horizontal ? (side === 'top' ? box.y : box.y + box.height) : side === 'left' ? box.x : box.x + box.width
    // Sort by heading, tie-break on id so the order never flickers.
    exits.sort((p, q) => p.heading - q.heading || p.edgeId.localeCompare(q.edgeId))
    const n = exits.length
    const usable = Math.max(0, len - 2 * PORT_INSET)
    const spacing = n > 1 ? Math.min(PORT_SPACING, usable / (n - 1)) : 0
    exits.forEach((ex, i) => {
      const along = mid + (i - (n - 1) / 2) * spacing
      const port: Port = horizontal ? { x: along, y: fixed, side } : { x: fixed, y: along, side }
      const pair = partial.get(ex.edgeId) ?? [undefined, undefined]
      pair[ex.end] = port
      partial.set(ex.edgeId, pair)
    })
  }
  for (const [id, pair] of partial) if (pair[0] && pair[1]) out.set(id, [pair[0], pair[1]])
  return out
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/ports.test.ts`
Expected: PASS (8 tests). If the "ordered by heading" test fails on order, check that `atan2`
for the left child is negative-most (heading toward −x, +y is > π/2), so sort ascending puts
`m` (π/2) before `l` (> π/2): fix the test expectation order to `['m', 'l', 'r']`? No: the
intent is left-to-right, so sort by the ALONG-AXIS component instead: for a horizontal side use
`Math.cos(heading)` ascending, for a vertical side `Math.sin(heading)` ascending. Apply that in
`exits.sort` and keep the test as written.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/edge-routing/types.ts src/renderer/lib/edge-routing/ports.ts src/renderer/lib/edge-routing/ports.test.ts
git commit -m "feat(edges): routing types and per-kind ports with spread"
```

---

### Task 3: Obstacles and the frame rule

**Files:**
- Create: `src/renderer/lib/edge-routing/obstacles.ts`
- Test: `src/renderer/lib/edge-routing/obstacles.test.ts`

**Interfaces:**
- Consumes: types from `./types`.
- Produces:
  ```ts
  export function inflate(b: Box, m: number): Box
  export function intersects(a: Box, b: Box): boolean
  export function containsStrict(b: Box, p: Point, eps?: number): boolean
  export function windowFor(a: Box, b: Box, pad: number): Box
  export function ancestorFrames(id: string, nodes: Map<string, RouteNode>): Set<string>
  export function obstaclesFor(edge: RouteEdge, req: RouteRequest, window?: Box): Box[]   // already inflated
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edge-routing/obstacles.test.ts
import { describe, it, expect } from 'vitest'
import { inflate, intersects, obstaclesFor, windowFor } from './obstacles'
import { OBSTACLE_MARGIN, WINDOW_PAD, type RouteNode, type RouteRequest } from './types'

const n = (id: string, x: number, y: number, o: Partial<RouteNode> = {}): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false, ...o })
const req = (nodes: RouteNode[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges: [] })
const edge = { id: 'e', source: 'a', target: 'b', kind: 'rope' as const }

describe('obstaclesFor', () => {
  it('excludes both endpoints, includes a bystander inflated by the margin', () => {
    const r = req([n('a', 0, 0), n('b', 800, 0), n('c', 400, 0)])
    const obs = obstaclesFor(edge, r)
    expect(obs).toHaveLength(1)
    expect(obs[0]).toEqual(inflate({ x: 400, y: 0, width: 200, height: 100 }, OBSTACLE_MARGIN))
  })
  it('a frame containing an endpoint is NOT an obstacle, its other members are', () => {
    const r = req([
      n('frame', -50, -50, { isFrame: true, width: 700, height: 300 }),
      n('a', 0, 0, { parentId: 'frame' }),
      n('sib', 300, 0, { parentId: 'frame' }),
      n('b', 1200, 0)
    ])
    const ids = obstaclesFor(edge, r).map((o) => `${o.x}`)
    expect(ids).toEqual([`${300 - OBSTACLE_MARGIN}`])
  })
  it('a foreign frame IS an obstacle and its members are dropped (the frame covers them)', () => {
    const r = req([
      n('a', 0, 0),
      n('b', 1500, 0),
      n('frame', 500, -100, { isFrame: true, width: 600, height: 400 }),
      n('inner', 600, 0, { parentId: 'frame' })
    ])
    const obs = obstaclesFor(edge, r)
    expect(obs).toHaveLength(1)
    expect(obs[0].width).toBe(600 + 2 * OBSTACLE_MARGIN)
  })
  it('hidden nodes are not obstacles', () => {
    expect(obstaclesFor(edge, req([n('a', 0, 0), n('b', 800, 0), n('c', 400, 0, { hidden: true })]))).toEqual([])
  })
  it('only obstacles intersecting the window are kept', () => {
    const r = req([n('a', 0, 0), n('b', 800, 0), n('far', 0, 5000)])
    const w = windowFor(r.nodes.get('a')!, r.nodes.get('b')!, WINDOW_PAD)
    expect(obstaclesFor(edge, r, w)).toEqual([])
    expect(obstaclesFor(edge, r)).toHaveLength(1)
  })
  it('intersects is inclusive of touching edges being NOT an intersection', () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 10, height: 10 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/obstacles.test.ts`
Expected: FAIL, cannot resolve `./obstacles`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/edge-routing/obstacles.ts
// The obstacle set for ONE edge (spec 3.2, decision 3). A frame that contains either endpoint is
// transparent (the route must be allowed to enter it) but its other members block; every other
// frame blocks as a whole and its members are dropped because the frame already covers them.
import type { Box, Point, RouteEdge, RouteNode, RouteRequest } from './types'
import { OBSTACLE_MARGIN } from './types'

export const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m })

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Strictly inside, with a small tolerance so a point ON the inflated border counts as outside. */
export const containsStrict = (b: Box, p: Point, eps = 0.5): boolean =>
  p.x > b.x + eps && p.x < b.x + b.width - eps && p.y > b.y + eps && p.y < b.y + b.height - eps

export function windowFor(a: Box, b: Box, pad: number): Box {
  const x = Math.min(a.x, b.x) - pad
  const y = Math.min(a.y, b.y) - pad
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) + pad - x, height: Math.max(a.y + a.height, b.y + b.height) + pad - y }
}

/** Every frame on the `parentId` chain above `id` (not `id` itself). Cycle-safe. */
export function ancestorFrames(id: string, nodes: Map<string, RouteNode>): Set<string> {
  const out = new Set<string>()
  let cur = nodes.get(id)?.parentId
  while (cur && !out.has(cur)) {
    out.add(cur)
    cur = nodes.get(cur)?.parentId
  }
  return out
}

export function obstaclesFor(edge: RouteEdge, req: RouteRequest, window?: Box): Box[] {
  const transparent = new Set([...ancestorFrames(edge.source, req.nodes), ...ancestorFrames(edge.target, req.nodes)])
  const out: Box[] = []
  for (const n of req.nodes.values()) {
    if (n.id === edge.source || n.id === edge.target || n.hidden) continue
    if (n.isFrame && transparent.has(n.id)) continue
    // Covered by an obstacle frame ⇒ skip (the frame is the obstacle).
    let covered = false
    for (const f of ancestorFrames(n.id, req.nodes)) if (!transparent.has(f)) { covered = true; break }
    if (covered) continue
    const box = inflate(n, OBSTACLE_MARGIN)
    if (window && !intersects(box, window)) continue
    out.push(box)
  }
  return out
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/obstacles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/edge-routing/obstacles.ts src/renderer/lib/edge-routing/obstacles.test.ts
git commit -m "feat(edges): obstacle set per edge with the frame rule"
```

---

### Task 4: Visibility graph, A*, and the fallback

**Files:**
- Create: `src/renderer/lib/edge-routing/visibility.ts`, `src/renderer/lib/edge-routing/route.ts`
- Test: `src/renderer/lib/edge-routing/route.test.ts`

**Interfaces:**
- Consumes: `obstaclesFor`, `containsStrict`, `windowFor`, `intersects` from `./obstacles`; `portsFor` from `./ports`; types.
- Produces:
  ```ts
  // visibility.ts
  export interface Graph { xs: number[]; ys: number[]; free: Uint8Array; index(ix: number, iy: number): number; at(v: number): Point; neighbors(v: number): number[] }
  export function buildGraph(blocked: Box[], ports: [Port, Port], endpoints: [Box, Box], window: Box): Graph
  // route.ts
  export function astar(g: Graph, from: Port, to: Port): Point[] | null      // corners only, incl. both ports
  export function fallbackPoints(ports: [Port, Port]): Point[]               // 3-segment orthogonal path, no avoidance
  export function routeOne(edge: RouteEdge, req: RouteRequest, ports: [Port, Port]): Route
  export function compressCollinear(points: Point[]): Point[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edge-routing/route.test.ts
import { describe, it, expect } from 'vitest'
import { routeOne, fallbackPoints, compressCollinear } from './route'
import { portsFor } from './ports'
import { obstaclesFor, containsStrict } from './obstacles'
import type { Point, RouteEdge, RouteNode, RouteRequest } from './types'

const n = (id: string, x: number, y: number, o: Partial<RouteNode> = {}): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false, ...o })
const mk = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges })
const rope = (id: string, source: string, target: string): RouteEdge => ({ id, source, target, kind: 'rope' })

/** Every point on every segment of an orthogonal polyline, sampled each 2px. */
function* samples(points: Point[]): Generator<Point> {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const steps = Math.max(1, Math.floor(len / 2))
    for (let s = 0; s <= steps; s++) yield { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
  }
}
function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false
  return true
}
function bends(points: Point[]): number { return Math.max(0, compressCollinear(points).length - 2) }

describe('routeOne', () => {
  it('a clear corridor is a straight line (no bends), starting and ending at the ports', () => {
    const r = mk([n('a', 0, 0), n('b', 600, 0)], [rope('e', 'a', 'b')])
    const ports = portsFor(r).get('e')!
    const route = routeOne(r.edges[0], r, ports)
    expect(route.fallback).toBe(false)
    expect(route.points[0]).toEqual({ x: ports[0].x, y: ports[0].y })
    expect(route.points.at(-1)).toEqual({ x: ports[1].x, y: ports[1].y })
    expect(bends(route.points)).toBe(0)
  })
  it('goes around a bystander, never entering its inflated box', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -40, { height: 180 })], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(route.fallback).toBe(false)
    const obs = obstaclesFor(r.edges[0], r)
    for (const p of samples(route.points)) for (const o of obs) expect(containsStrict(o, p)).toBe(false)
    expect(isOrthogonal(route.points)).toBe(true)
    expect(bends(route.points)).toBeLessThanOrEqual(4)
  })
  it('the Z case (offset rows) takes exactly two bends', () => {
    const r = mk([n('a', 0, 0), n('b', 600, 300)], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(bends(route.points)).toBe(2)
  })
  it('first step leaves along the port normal, last arrives along the target normal', () => {
    const r = mk([n('a', 0, 0), n('b', 300, 500)], [{ ...rope('e', 'a', 'b'), ropeKind: 'opener' }])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    const [p0, p1] = route.points
    expect(p1.x).toBe(p0.x); expect(p1.y).toBeGreaterThan(p0.y)         // leaves bottom, downward
    const [q1, q0] = [route.points.at(-2)!, route.points.at(-1)!]
    expect(q1.x).toBe(q0.x); expect(q1.y).toBeLessThan(q0.y)            // arrives at top, downward
  })
  it('property: 200 random canvases, no route enters an obstacle, all orthogonal', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let t = 0; t < 200; t++) {
      const nodes: RouteNode[] = []
      const count = 3 + Math.floor(rnd() * 10)
      for (let i = 0; i < count; i++) nodes.push(n(`n${i}`, Math.floor(rnd() * 2000), Math.floor(rnd() * 1400), { width: 160 + Math.floor(rnd() * 300), height: 80 + Math.floor(rnd() * 300) }))
      const r = mk(nodes, [rope('e', 'n0', 'n1')])
      const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
      expect(isOrthogonal(route.points)).toBe(true)
      if (route.fallback) continue
      const obs = obstaclesFor(r.edges[0], r)
      for (const p of samples(route.points)) for (const o of obs) expect(containsStrict(o, p), `t=${t}`).toBe(false)
    }
  })
  it('boxed in ⇒ fallback, still drawable', () => {
    const wall = (id: string, x: number, y: number, w: number, h: number) => n(id, x, y, { width: w, height: h })
    const r = mk([n('a', 0, 0), n('b', 2000, 0), wall('w1', -100, -100, 400, 20), wall('w2', -100, 200, 400, 20), wall('w3', -100, -100, 20, 320), wall('w4', 280, -100, 20, 320)], [rope('e', 'a', 'b')])
    const route = routeOne(r.edges[0], r, portsFor(r).get('e')!)
    expect(route.fallback).toBe(true)
    expect(route.points.length).toBeGreaterThanOrEqual(2)
  })
  it('is deterministic', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -40, { height: 180 })], [rope('e', 'a', 'b')])
    expect(routeOne(r.edges[0], r, portsFor(r).get('e')!)).toEqual(routeOne(r.edges[0], r, portsFor(r).get('e')!))
  })
})

describe('fallbackPoints', () => {
  it('right → left ports: a Z through the midpoint x', () => {
    const pts = fallbackPoints([{ x: 200, y: 50, side: 'right' }, { x: 600, y: 350, side: 'left' }])
    expect(pts).toEqual([{ x: 200, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 350 }, { x: 600, y: 350 }])
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/route.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Implement visibility.ts**

```ts
// src/renderer/lib/edge-routing/visibility.ts
// The orthogonal visibility graph (spec 3.3): candidate vertical lines at every obstacle's left
// and right (already inflated by the margin), horizontal lines at every top and bottom, plus the
// two ports and their stubs. Vertices are the intersections not inside an obstacle or an endpoint
// node; two vertices adjacent on one line are joined when the segment between them is clear.
import { containsStrict } from './obstacles'
import { outward, PORT_STUB, type Box, type Point, type Port } from './types'

export interface Graph {
  xs: number[]
  ys: number[]
  free: Uint8Array
  index(ix: number, iy: number): number
  at(v: number): Point
  ix(v: number): number
  iy(v: number): number
  neighbors(v: number): number[]
  vertexAt(p: Point): number
}

function uniqSorted(vals: number[]): number[] {
  return [...new Set(vals)].sort((a, b) => a - b)
}

export function buildGraph(blocked: Box[], ports: [Port, Port], endpoints: [Box, Box], window: Box): Graph {
  const xs: number[] = [window.x, window.x + window.width]
  const ys: number[] = [window.y, window.y + window.height]
  for (const b of blocked) {
    xs.push(b.x, b.x + b.width)
    ys.push(b.y, b.y + b.height)
  }
  for (const p of ports) {
    const o = outward(p.side)
    xs.push(p.x, p.x + o.x * PORT_STUB)
    ys.push(p.y, p.y + o.y * PORT_STUB)
  }
  const X = uniqSorted(xs)
  const Y = uniqSorted(ys)
  const W = X.length
  const free = new Uint8Array(W * Y.length)
  // Endpoint nodes are not obstacles for routing AROUND (their ports sit on them) but no vertex
  // may lie strictly inside them, so the route cannot cut through its own node.
  const solid = [...blocked, ...endpoints]
  for (let iy = 0; iy < Y.length; iy++)
    for (let ix = 0; ix < W; ix++) {
      const p = { x: X[ix], y: Y[iy] }
      free[iy * W + ix] = solid.some((b) => containsStrict(b, p)) ? 0 : 1
    }
  const clear = (a: Point, b: Point): boolean => {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return !solid.some((s) => containsStrict(s, m))
  }
  const g: Graph = {
    xs: X,
    ys: Y,
    free,
    index: (ix, iy) => iy * W + ix,
    at: (v) => ({ x: X[v % W], y: Y[Math.floor(v / W)] }),
    ix: (v) => v % W,
    iy: (v) => Math.floor(v / W),
    neighbors(v) {
      const ix = v % W, iy = Math.floor(v / W)
      const out: number[] = []
      const here = g.at(v)
      const tryV = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= Y.length) return
        const u = ny * W + nx
        if (free[u] && clear(here, g.at(u))) out.push(u)
      }
      tryV(ix - 1, iy); tryV(ix + 1, iy); tryV(ix, iy - 1); tryV(ix, iy + 1)
      return out
    },
    vertexAt: (p) => {
      const ix = X.indexOf(p.x), iy = Y.indexOf(p.y)
      return ix < 0 || iy < 0 ? -1 : iy * W + ix
    }
  }
  // A port lies ON its node's border: force it free so the search can start and end there.
  for (const p of ports) { const v = g.vertexAt(p); if (v >= 0) free[v] = 1 }
  return g
}
```

- [ ] **Step 4: Implement route.ts**

```ts
// src/renderer/lib/edge-routing/route.ts
// A* over the visibility graph (spec 3.4) with the two direction constraints: the first step
// leaves along the source port's outward normal, the last arrives along the target port's inward
// normal. Cost = Manhattan length + BEND_COST per turn; the heuristic is Manhattan distance.
// Failure inside the window widens once to the whole canvas; failure again ⇒ the fallback
// three-segment path (spec 3.5), so an edge is never left undrawn.
import { obstaclesFor, windowFor } from './obstacles'
import { buildGraph, type Graph } from './visibility'
import { BEND_COST, WINDOW_PAD, outward, type Box, type Point, type Port, type Route, type RouteEdge, type RouteRequest } from './types'

type Dir = 0 | 1 | 2 | 3 // right, down, left, up
const DIRS: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]
const dirOf = (from: Point, to: Point): Dir => (to.x > from.x ? 0 : to.x < from.x ? 2 : to.y > from.y ? 1 : 3)
const dirOfNormal = (n: Point): Dir => (n.x === 1 ? 0 : n.y === 1 ? 1 : n.x === -1 ? 2 : 3)

export function compressCollinear(points: Point[]): Point[] {
  if (points.length < 3) return points.slice()
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1]
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
    if (!collinear) out.push(b)
  }
  out.push(points[points.length - 1])
  return out
}

export function astar(g: Graph, from: Port, to: Port): Point[] | null {
  const start = g.vertexAt(from)
  const goal = g.vertexAt(to)
  if (start < 0 || goal < 0) return null
  const mustLeave = dirOfNormal(outward(from.side))
  const mustArrive = ((dirOfNormal(outward(to.side)) + 2) % 4) as Dir
  const goalP = g.at(goal)
  const h = (v: number) => { const p = g.at(v); return Math.abs(p.x - goalP.x) + Math.abs(p.y - goalP.y) }
  // State = vertex * 4 + incoming direction. 4 = "no direction yet" handled as separate start.
  const key = (v: number, d: Dir) => v * 4 + d
  const gScore = new Map<number, number>()
  const came = new Map<number, number>()
  const open: { k: number; f: number; v: number; d: Dir }[] = []
  const push = (k: number, f: number, v: number, d: Dir) => { open.push({ k, f, v, d }); open.sort((a, b) => a.f - b.f || a.k - b.k) }
  // Seed: only the neighbour in the mandated leaving direction.
  for (const u of g.neighbors(start)) {
    const d = dirOf(g.at(start), g.at(u))
    if (d !== mustLeave) continue
    const p = g.at(start), q = g.at(u)
    const cost = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
    gScore.set(key(u, d), cost)
    came.set(key(u, d), -1)
    push(key(u, d), cost + h(u), u, d)
  }
  const closed = new Set<number>()
  while (open.length) {
    const cur = open.shift()!
    if (closed.has(cur.k)) continue
    closed.add(cur.k)
    if (cur.v === goal && cur.d === mustArrive) {
      const pts: Point[] = [g.at(goal)]
      let k = cur.k
      while (came.get(k) !== -1 && came.has(k)) { k = came.get(k)!; pts.push(g.at(Math.floor(k / 4))) }
      pts.push(g.at(start))
      return compressCollinear(pts.reverse())
    }
    const p = g.at(cur.v)
    for (const u of g.neighbors(cur.v)) {
      const d = dirOf(p, g.at(u))
      if (d === ((cur.d + 2) % 4)) continue // no U-turn
      const q = g.at(u)
      const step = Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (d === cur.d ? 0 : BEND_COST)
      const nk = key(u, d)
      const ng = gScore.get(cur.k)! + step
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng)
        came.set(nk, cur.k)
        push(nk, ng + h(u), u, d)
      }
    }
  }
  return null
}

/** The no-avoidance path: out along the source normal, across, in along the target normal. */
export function fallbackPoints(ports: [Port, Port]): Point[] {
  const [a, b] = ports
  const ha = a.side === 'left' || a.side === 'right'
  const hb = b.side === 'left' || b.side === 'right'
  if (ha && hb) { const mx = (a.x + b.x) / 2; return compressCollinear([{ x: a.x, y: a.y }, { x: mx, y: a.y }, { x: mx, y: b.y }, { x: b.x, y: b.y }]) }
  if (!ha && !hb) { const my = (a.y + b.y) / 2; return compressCollinear([{ x: a.x, y: a.y }, { x: a.x, y: my }, { x: b.x, y: my }, { x: b.x, y: b.y }]) }
  // Mixed: one bend at the corner.
  return ha ? compressCollinear([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }]) : compressCollinear([{ x: a.x, y: a.y }, { x: a.x, y: b.y }, { x: b.x, y: b.y }])
}

function bboxOfPoints(points: Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function labelPointOf(points: Point[]): Point {
  let best = 0, bestLen = -1
  for (let i = 1; i < points.length; i++) {
    const len = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)
    if (len > bestLen) { bestLen = len; best = i }
  }
  const a = points[best - 1] ?? points[0], b = points[best] ?? points[0]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function routeOne(edge: RouteEdge, req: RouteRequest, ports: [Port, Port]): Route {
  const a = req.nodes.get(edge.source)!
  const b = req.nodes.get(edge.target)!
  const endpoints: [Box, Box] = [a, b]
  const attempt = (window: Box): Point[] | null => {
    const blocked = obstaclesFor(edge, req, window)
    return astar(buildGraph(blocked, ports, endpoints, window), ports[0], ports[1])
  }
  let points = attempt(windowFor(a, b, WINDOW_PAD))
  if (!points) {
    let all: Box = { x: 0, y: 0, width: 0, height: 0 }
    let first = true
    for (const n of req.nodes.values()) { all = first ? { ...n } : windowFor(all, n, 0); first = false }
    points = attempt(windowFor(all, all, WINDOW_PAD))
  }
  const fallback = !points
  const pts = points ?? fallbackPoints(ports)
  return { points: pts, ports, fallback, labelAt: labelPointOf(pts), bbox: bboxOfPoints(pts) }
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/route.test.ts`
Expected: PASS (9 tests). If "Z case takes exactly two bends" reports 0 or 4: check that
`compressCollinear` keeps the stub corner, and that the port for `b` at (600,300) is its LEFT
side (dominant axis: dx=600 > dy=300 ⇒ horizontal), so the path is right-stub, down, right: 2 bends.

- [ ] **Step 6: Mutation check, then commit**

Temporarily change `OBSTACLE_MARGIN` use in `obstaclesFor` to `0` and run the property test: it
must still pass (routes hug borders); then change `containsStrict` in `buildGraph` to always
return `false` and run: the "goes around a bystander" test MUST fail. Revert both.

```bash
git add src/renderer/lib/edge-routing/visibility.ts src/renderer/lib/edge-routing/route.ts src/renderer/lib/edge-routing/route.test.ts
git commit -m "feat(edges): orthogonal visibility-graph router with A* and fallback"
```

---

### Task 5: Bundling (nudge)

**Files:**
- Create: `src/renderer/lib/edge-routing/nudge.ts`
- Test: `src/renderer/lib/edge-routing/nudge.test.ts`

**Interfaces:**
- Consumes: `Route`, `RouteEdge`, `Box`, `CHANNEL_SPACING` from `./types`; `containsStrict` from `./obstacles`; `KIND_ORDER` from `../edgeKinds`.
- Produces:
  ```ts
  export function nudge(routes: Map<string, Route>, edges: RouteEdge[], obstaclesOf: (edgeId: string) => Box[]): Map<string, Route>
  ```
  Returns NEW Route objects for changed edges (points shifted, bbox and labelAt recomputed); unchanged edges keep identity.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edge-routing/nudge.test.ts
import { describe, it, expect } from 'vitest'
import { nudge } from './nudge'
import { CHANNEL_SPACING, type Route, type RouteEdge } from './types'

const route = (points: { x: number; y: number }[]): Route => ({
  points,
  ports: [{ ...points[0], side: 'right' }, { ...points[points.length - 1], side: 'left' }],
  fallback: false,
  labelAt: points[1],
  bbox: { x: 0, y: 0, width: 0, height: 0 }
})
// Two Z routes sharing the vertical run at x=500 between y=50 and y=350 / y=60 and y=340.
const r1 = route([{ x: 200, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 350 }, { x: 800, y: 350 }])
const r2 = route([{ x: 200, y: 60 }, { x: 500, y: 60 }, { x: 500, y: 340 }, { x: 800, y: 340 }])
const edges: RouteEdge[] = [
  { id: 'e1', source: 'a', target: 'b', kind: 'rope' },
  { id: 'e2', source: 'a', target: 'c', kind: 'context' }
]
const noObs = () => []

describe('nudge', () => {
  it('two parallel runs end up CHANNEL_SPACING apart, ordered by kind (context before rope)', () => {
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const x1 = out.get('e1')!.points[1].x
    const x2 = out.get('e2')!.points[1].x
    expect(Math.abs(x1 - x2)).toBe(CHANNEL_SPACING)
    expect(x2).toBeLessThan(x1) // context (order 0) takes the lower offset
  })
  it('adjoining horizontal segments follow the shifted vertical (still orthogonal)', () => {
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const p = out.get('e1')!.points
    expect(p[1].x).toBe(p[2].x)
    expect(p[0].y).toBe(p[1].y)
    expect(p[2].y).toBe(p[3].y)
  })
  it('a lone segment is untouched and keeps identity', () => {
    const out = nudge(new Map([['e1', r1]]), edges.slice(0, 1), noObs)
    expect(out.get('e1')).toBe(r1)
  })
  it('stable: the same input twice gives the same offsets', () => {
    const a = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    const b = nudge(new Map([['e1', r1], ['e2', r2]]), edges, noObs)
    expect(a).toEqual(b)
  })
  it('an offset that would enter an obstacle is dropped to zero for that member', () => {
    const wall = { x: 500 + 2, y: 0, width: 100, height: 500 } // just right of the corridor
    const out = nudge(new Map([['e1', r1], ['e2', r2]]), edges, (id) => (id === 'e1' ? [wall] : []))
    expect(out.get('e1')!.points[1].x).toBe(500)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/nudge.test.ts`
Expected: FAIL, cannot resolve `./nudge`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/edge-routing/nudge.ts
// Bundling (spec 3.6, decision 4). Interior segments that share a line and overlap in range form
// a CHANNEL; members are ordered by kind then ids (stable ribbons) and offset perpendicular by
// CHANNEL_SPACING. Moving a segment moves its two corner points, so the adjoining perpendicular
// segments stretch or shrink and the polyline stays orthogonal. First and last segments (the
// port stubs) are never nudged: the port spread already separates them.
import { KIND_ORDER } from '../edgeKinds'
import { containsStrict } from './obstacles'
import { labelPointOf } from './route'
import { CHANNEL_SPACING, type Box, type Point, type Route, type RouteEdge } from './types'

interface Seg { edgeId: string; i: number; lo: number; hi: number; kindRank: number; source: string; target: string }

function bbox(points: Point[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function nudge(routes: Map<string, Route>, edges: RouteEdge[], obstaclesOf: (edgeId: string) => Box[]): Map<string, Route> {
  const byId = new Map(edges.map((e) => [e.id, e]))
  const vertical = new Map<number, Seg[]>()
  const horizontal = new Map<number, Seg[]>()
  for (const [id, r] of routes) {
    const e = byId.get(id)
    if (!e) continue
    const rank = KIND_ORDER.indexOf(e.kind)
    // Interior segments only: i from 1 to length-3 (segment i is points[i] → points[i+1]).
    for (let i = 1; i < r.points.length - 2; i++) {
      const a = r.points[i], b = r.points[i + 1]
      const seg: Seg = { edgeId: id, i, lo: 0, hi: 0, kindRank: rank, source: e.source, target: e.target }
      if (a.x === b.x) { seg.lo = Math.min(a.y, b.y); seg.hi = Math.max(a.y, b.y); (vertical.get(a.x) ?? vertical.set(a.x, []).get(a.x)!).push(seg) }
      else if (a.y === b.y) { seg.lo = Math.min(a.x, b.x); seg.hi = Math.max(a.x, b.x); (horizontal.get(a.y) ?? horizontal.set(a.y, []).get(a.y)!).push(seg) }
    }
  }
  const shifted = new Map<string, Point[]>() // edgeId → mutable copy of points
  const pointsOf = (id: string) => shifted.get(id) ?? (shifted.set(id, routes.get(id)!.points.map((p) => ({ ...p }))).get(id)!)
  const order = (p: Seg, q: Seg) => p.kindRank - q.kindRank || p.source.localeCompare(q.source) || p.target.localeCompare(q.target) || p.edgeId.localeCompare(q.edgeId)

  const process = (buckets: Map<number, Seg[]>, axis: 'x' | 'y') => {
    for (const segs of buckets.values()) {
      if (segs.length < 2) continue
      segs.sort((p, q) => p.lo - q.lo)
      // Sweep into channels of overlapping ranges.
      let channel: Seg[] = [segs[0]]
      let hi = segs[0].hi
      const flush = () => {
        if (channel.length < 2) return
        channel.sort(order)
        const n = channel.length
        channel.forEach((s, k) => {
          const off = (k - (n - 1) / 2) * CHANNEL_SPACING
          if (off === 0) return
          const pts = pointsOf(s.edgeId)
          const a = pts[s.i], b = pts[s.i + 1]
          const moved = axis === 'x' ? [{ x: a.x + off, y: a.y }, { x: b.x + off, y: b.y }] : [{ x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }]
          const mid = { x: (moved[0].x + moved[1].x) / 2, y: (moved[0].y + moved[1].y) / 2 }
          if (obstaclesOf(s.edgeId).some((o) => containsStrict(o, mid) || containsStrict(o, moved[0]) || containsStrict(o, moved[1]))) return
          pts[s.i] = moved[0]
          pts[s.i + 1] = moved[1]
        })
      }
      for (let k = 1; k < segs.length; k++) {
        if (segs[k].lo < hi) { channel.push(segs[k]); hi = Math.max(hi, segs[k].hi) }
        else { flush(); channel = [segs[k]]; hi = segs[k].hi }
      }
      flush()
    }
  }
  process(vertical, 'x')
  process(horizontal, 'y')

  const out = new Map(routes)
  for (const [id, pts] of shifted) {
    const r = routes.get(id)!
    out.set(id, { ...r, points: pts, labelAt: labelPointOf(pts), bbox: bbox(pts) })
  }
  return out
}
```

Note `pointsOf` is only called for members that get a non-zero offset; a route whose members all
drop out keeps identity because `shifted` never sees it. If the "lone segment keeps identity" test
fails, that is the reason: check the early `return` placement.

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/nudge.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/edge-routing/nudge.ts src/renderer/lib/edge-routing/nudge.test.ts
git commit -m "feat(edges): channel nudging bundles parallel runs"
```

---

### Task 6: SVG path, arrowheads

**Files:**
- Create: `src/renderer/lib/edge-routing/svgPath.ts`
- Test: `src/renderer/lib/edge-routing/svgPath.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function svgPathFrom(points: Point[], radius?: number): string          // M/L/A only
  export function arrowheadPoints(points: Point[], at: 'start' | 'end', shape: 'triangle' | 'diamond', size?: number): string  // SVG polygon `points`
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/lib/edge-routing/svgPath.test.ts
import { describe, it, expect } from 'vitest'
import { svgPathFrom, arrowheadPoints } from './svgPath'

describe('svgPathFrom', () => {
  it('a straight line is M + L', () => {
    expect(svgPathFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe('M 0 0 L 100 0')
  })
  it('a corner becomes an arc of the radius, clamped to half the shorter leg', () => {
    const d = svgPathFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }], 8)
    // shorter leg is 10 ⇒ radius 5
    expect(d).toBe('M 0 0 L 95 0 A 5 5 0 0 1 100 5 L 100 10')
  })
  it('uses only M, L and A commands', () => {
    const d = svgPathFrom([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }])
    expect(d.replace(/[MLA0-9.\s-]/g, '')).toBe('')
  })
})

describe('arrowheadPoints', () => {
  it('points left-to-right at the end of a rightward last segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'end', 'triangle', 7)).toBe('100,0 93,-3.5 93,3.5')
  })
  it('points downward at the end of a downward last segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 0, y: 100 }], 'end', 'triangle', 7)).toBe('0,100 -3.5,93 3.5,93')
  })
  it('a start arrow points back along the first segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'start', 'triangle', 7)).toBe('0,0 7,-3.5 7,3.5')
  })
  it('a diamond has four points', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'end', 'diamond', 7).split(' ')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/svgPath.test.ts`
Expected: FAIL, cannot resolve `./svgPath`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/edge-routing/svgPath.ts
// Corners → SVG (spec 3.7). Rounded with CORNER_RADIUS clamped to half the shorter adjoining leg
// so a short jog never overshoots. The arrowhead is a polygon on the last (or first) segment's
// axis, which is one of four directions, so it needs no marker defs and is always the stroke's
// exact colour.
import { CORNER_RADIUS, type Point } from './types'

const f = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

export function svgPathFrom(points: Point[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${f(points[0].x)} ${f(points[0].y)}`
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const inLen = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const outLen = Math.abs(c.x - b.x) + Math.abs(c.y - b.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r <= 0) { d += ` L ${f(b.x)} ${f(b.y)}`; continue }
    const din = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
    const dout = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) }
    const p1 = { x: b.x - din.x * r, y: b.y - din.y * r }
    const p2 = { x: b.x + dout.x * r, y: b.y + dout.y * r }
    // Sweep flag: clockwise when the turn (in screen coordinates) is right-handed.
    const cross = din.x * dout.y - din.y * dout.x
    const sweep = cross > 0 ? 1 : 0
    d += ` L ${f(p1.x)} ${f(p1.y)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(p2.x)} ${f(p2.y)}`
  }
  const last = points[points.length - 1]
  d += ` L ${f(last.x)} ${f(last.y)}`
  return d
}

export function arrowheadPoints(points: Point[], at: 'start' | 'end', shape: 'triangle' | 'diamond', size = 7): string {
  if (points.length < 2) return ''
  const tip = at === 'end' ? points[points.length - 1] : points[0]
  const prev = at === 'end' ? points[points.length - 2] : points[1]
  // Unit direction from prev toward tip (the head points this way).
  const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y)
  const back = { x: tip.x - dx * size, y: tip.y - dy * size }
  const half = size / 2
  const nx = -dy, ny = dx // perpendicular
  const l = { x: back.x + nx * half, y: back.y + ny * half }
  const r = { x: back.x - nx * half, y: back.y - ny * half }
  const pt = (p: Point) => `${f(p.x)},${f(p.y)}`
  if (shape === 'diamond') {
    const tail = { x: tip.x - dx * size * 2, y: tip.y - dy * size * 2 }
    return [tip, l, tail, r].map(pt).join(' ')
  }
  // Emit the two base corners so that the left-hand one (negative perpendicular) comes first.
  const first = ny < 0 || (ny === 0 && nx < 0) ? l : r
  const second = first === l ? r : l
  return [tip, first, second].map(pt).join(' ')
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/svgPath.test.ts`
Expected: PASS (7 tests). If the arc test's sweep flag is wrong (`0 0 0` vs `0 0 1`), check the
sign of `cross` for a right-then-down turn (din=(1,0), dout=(0,1) ⇒ cross = 1 ⇒ sweep 1). If the
arrow base order differs, adjust the `first` rule, not the tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/edge-routing/svgPath.ts src/renderer/lib/edge-routing/svgPath.test.ts
git commit -m "feat(edges): rounded orthogonal SVG path and arrowhead polygons"
```

---

### Task 7: `routeAll` (full and incremental) and the performance pin

**Files:**
- Create: `src/renderer/lib/edge-routing/index.ts`
- Test: `src/renderer/lib/edge-routing/routeAll.test.ts`, `src/renderer/lib/edge-routing/perf.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function routeAll(req: RouteRequest, previous?: RoutedGraph, moved?: ReadonlySet<string>): RoutedGraph
  export * from './types'
  export { svgPathFrom, arrowheadPoints } from './svgPath'
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/lib/edge-routing/routeAll.test.ts
import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import type { RouteEdge, RouteNode, RouteRequest } from './types'

const n = (id: string, x: number, y: number): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false })
const mk = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges })

describe('routeAll', () => {
  const base = mk([n('a', 0, 0), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], [
    { id: 'ab', source: 'a', target: 'b', kind: 'context' },
    { id: 'cd', source: 'c', target: 'd', kind: 'context' }
  ])
  it('routes every edge whose endpoints exist, skips the rest', () => {
    const g = routeAll(mk([...base.nodes.values()], [...base.edges, { id: 'ax', source: 'a', target: 'ghost', kind: 'rope' }]))
    expect([...g.routes.keys()].sort()).toEqual(['ab', 'cd'])
    expect(g.fallbacks).toBe(0)
  })
  it('incremental: only edges touching a moved node (or crossing its box) are re-routed', () => {
    const g1 = routeAll(base)
    const moved = mk([n('a', 0, 20), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], base.edges)
    const g2 = routeAll(moved, g1, new Set(['a']))
    expect(g2.routes.get('cd')).toBe(g1.routes.get('cd'))     // identity kept
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
    expect(g2.routes.get('ab')!.points[0].y).toBe(70)          // follows the new port
  })
  it('incremental: an untouched edge whose route crosses the moved node re-routes too', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, 400), n('d', 400, 800)], [
      { id: 'ab', source: 'a', target: 'b', kind: 'context' },
      { id: 'cd', source: 'c', target: 'd', kind: 'context' }
    ])
    const g1 = routeAll(r)
    const r2 = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -20), n('d', 400, 800)], r.edges) // c now sits on the ab corridor
    const g2 = routeAll(r2, g1, new Set(['c']))
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
  })
})
```

```ts
// src/renderer/lib/edge-routing/perf.test.ts
import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import type { RouteEdge, RouteNode, RouteRequest } from './types'

function canvas(nodes: number, edges: number, frames: number): RouteRequest {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const ns: RouteNode[] = []
  for (let i = 0; i < frames; i++) ns.push({ id: `f${i}`, x: i * 1400, y: 2000, width: 1200, height: 800, isFrame: true })
  for (let i = 0; i < nodes; i++) {
    const inFrame = i % 5 === 0 && frames > 0 ? `f${i % frames}` : undefined
    ns.push({ id: `n${i}`, x: inFrame ? (i % frames) * 1400 + 50 + (i % 4) * 280 : Math.floor(rnd() * 4000), y: inFrame ? 2050 + Math.floor(i / 20) * 200 : Math.floor(rnd() * 1800), width: 240 + Math.floor(rnd() * 200), height: 120 + Math.floor(rnd() * 200), isFrame: false, parentId: inFrame })
  }
  const es: RouteEdge[] = []
  for (let i = 0; i < edges; i++) es.push({ id: `e${i}`, source: `n${i % nodes}`, target: `n${(i * 7 + 1) % nodes}`, kind: i % 3 === 0 ? 'context' : 'rope', ropeKind: i % 2 ? 'opener' : 'dep' })
  return { nodes: new Map(ns.map((v) => [v.id, v])), edges: es.filter((e) => e.source !== e.target) }
}

describe('routing performance pins (spec Section 6; CI bounds are generous)', () => {
  it('full pass, 40 nodes / 60 edges / 6 frames under 100 ms', () => {
    const req = canvas(40, 60, 6)
    routeAll(req) // warm
    const t0 = performance.now(); routeAll(req); const ms = performance.now() - t0
    expect(ms).toBeLessThan(100)
  })
  it('full pass, 120 nodes / 200 edges under 500 ms', () => {
    const req = canvas(120, 200, 8)
    routeAll(req)
    const t0 = performance.now(); routeAll(req); const ms = performance.now() - t0
    expect(ms).toBeLessThan(500)
  })
  it('drag pass (one node moved) on 120 / 200 under 50 ms', () => {
    const req = canvas(120, 200, 8)
    const g = routeAll(req)
    const moved = { nodes: new Map(req.nodes), edges: req.edges }
    const n5 = moved.nodes.get('n5')!
    moved.nodes.set('n5', { ...n5, y: n5.y + 30 })
    const t0 = performance.now(); routeAll(moved, g, new Set(['n5'])); const ms = performance.now() - t0
    expect(ms).toBeLessThan(50)
  })
})
```

- [ ] **Step 2: Run them, expect failure**

Run: `npx vitest run src/renderer/lib/edge-routing/routeAll.test.ts src/renderer/lib/edge-routing/perf.test.ts`
Expected: FAIL, cannot resolve `./index`.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/edge-routing/index.ts
// The whole-graph pass (spec 2.1, 3.6). Full: ports for every edge (spread needs them all), one
// route per edge, then nudging over all routes. Incremental (a drag): only edges touching a moved
// node, or whose current route's bbox meets a moved node's box, are re-routed; the rest keep
// identity, and nudging is skipped for the re-routed set — bundles reform on the full pass that
// runs when the drag ends.
import { intersects, obstaclesFor } from './obstacles'
import { portsFor } from './ports'
import { routeOne } from './route'
import { nudge } from './nudge'
import type { Route, RoutedGraph, RouteRequest } from './types'

export * from './types'
export { svgPathFrom, arrowheadPoints } from './svgPath'
export { obstaclesFor } from './obstacles'

export function routeAll(req: RouteRequest, previous?: RoutedGraph, moved?: ReadonlySet<string>): RoutedGraph {
  const live = req.edges.filter((e) => req.nodes.has(e.source) && req.nodes.has(e.target))
  const ports = portsFor({ nodes: req.nodes, edges: live })
  const routes = new Map<string, Route>()
  let fallbacks = 0

  if (previous && moved && moved.size) {
    const movedBoxes = [...moved].map((id) => req.nodes.get(id)).filter((b): b is NonNullable<typeof b> => !!b)
    for (const e of live) {
      const prev = previous.routes.get(e.id)
      const touches = moved.has(e.source) || moved.has(e.target)
      const crosses = !!prev && movedBoxes.some((b) => intersects(prev.bbox, b))
      if (prev && !touches && !crosses) { routes.set(e.id, prev); continue }
      const p = ports.get(e.id)
      if (!p) continue
      const r = routeOne(e, req, p)
      if (r.fallback) fallbacks++
      routes.set(e.id, r)
    }
    return { routes, fallbacks }
  }

  for (const e of live) {
    const p = ports.get(e.id)
    if (!p) continue
    const r = routeOne(e, req, p)
    if (r.fallback) fallbacks++
    routes.set(e.id, r)
  }
  const obstacleCache = new Map<string, ReturnType<typeof obstaclesFor>>()
  const obstaclesOf = (id: string) => {
    let o = obstacleCache.get(id)
    if (!o) { const e = live.find((x) => x.id === id)!; o = obstaclesFor(e, req); obstacleCache.set(id, o) }
    return o
  }
  return { routes: nudge(routes, live, obstaclesOf), fallbacks }
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `npx vitest run src/renderer/lib/edge-routing/`
Expected: PASS across all edge-routing files. If a perf pin fails, first check `astar`'s open
list: the `sort` on every push is O(n log n); replace with a binary heap (a 30-line
`MinHeap<{f,k}>` in `route.ts`) before touching anything else. If the bystander/property tests
pass but perf is still over, restrict `buildGraph` lines to the window (already the case) and
confirm `obstaclesFor` receives the window in `routeOne`'s first attempt.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/edge-routing/index.ts src/renderer/lib/edge-routing/routeAll.test.ts src/renderer/lib/edge-routing/perf.test.ts
git commit -m "feat(edges): routeAll with incremental drag pass and perf pins"
```

---

### Task 8: The routes store and the `EdgeRouter` component

**Files:**
- Create: `src/renderer/canvas/edges/edgeRoutes.ts`, `src/renderer/canvas/edges/EdgeRouter.tsx`, `src/renderer/canvas/edges/requestFromLookup.ts`
- Test: `src/renderer/canvas/edges/requestFromLookup.test.ts`, `src/renderer/canvas/edges/edgeRoutes.test.ts`

Why a store and not React context: React Flow renders edge components inside its own subtree,
not under anything the host mounts as a child of `<ReactFlow>`, so a context provider mounted
there never reaches them. A zustand store keyed by the React Flow instance id (`rfId`, from
`useStore((s) => s.rfId)`) does; the canvas uses the default id, the overview passes
`id="overview"` on its `<ReactFlow>`.

**Interfaces:**
- Consumes: `routeAll`, types from `../../lib/edge-routing`; `EdgeData` from `../../lib/edgeKinds`; zustand `create`; `useStore`, `useStoreApi` from `@xyflow/react`.
- Produces:
  ```ts
  // edgeRoutes.ts
  export interface FlowRoutes { routes: Map<string, Route>; nodes: Map<string, RouteNode>; litSet: Set<string>; anyLit: boolean }
  export const useEdgeRoutes: UseBoundStore<StoreApi<{ byFlow: Record<string, FlowRoutes>; hovered: Record<string, string | null>; publish(rfId: string, v: FlowRoutes): void; setHovered(rfId: string, edgeId: string | null): void }>>
  export function litSetFor(edges: { id: string; source: string; target: string; selected?: boolean }[], nodes: Map<string, RouteNode>, hovered: string | null): Set<string>
  // requestFromLookup.ts
  export function requestFromLookup(lookup: Iterable<InternalNodeLike>, edges: Edge[]): { req: RouteRequest; dragging: Set<string> }
  export function signatureOf(lookup: Iterable<InternalNodeLike>): string
  export interface InternalNodeLike { id: string; type?: string; parentId?: string; hidden?: boolean; selected?: boolean; dragging?: boolean; measured?: { width?: number; height?: number }; internals: { positionAbsolute: { x: number; y: number } } }
  // EdgeRouter.tsx
  export function EdgeRouter({ edges }: { edges: Edge[] }): null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/canvas/edges/requestFromLookup.test.ts
import { describe, it, expect } from 'vitest'
import { requestFromLookup, signatureOf, type InternalNodeLike } from './requestFromLookup'

const inode = (id: string, x: number, y: number, o: Partial<InternalNodeLike> = {}): InternalNodeLike => ({
  id, measured: { width: 200, height: 100 }, internals: { positionAbsolute: { x, y } }, ...o
})

describe('requestFromLookup', () => {
  it('uses absolute positions and measured sizes; groups are frames; unmeasured nodes are skipped', () => {
    const { req } = requestFromLookup(
      [inode('g', 0, 0, { type: 'group', measured: { width: 800, height: 600 } }), inode('a', 20, 20, { parentId: 'g' }), inode('u', 0, 0, { measured: {} })],
      [{ id: 'e', source: 'a', target: 'u', data: { kind: 'rope' } }]
    )
    expect(req.nodes.get('g')).toMatchObject({ isFrame: true, width: 800 })
    expect(req.nodes.get('a')).toMatchObject({ x: 20, y: 20, parentId: 'g', isFrame: false })
    expect(req.nodes.has('u')).toBe(false)
    expect(req.edges).toEqual([{ id: 'e', source: 'a', target: 'u', kind: 'rope', ropeKind: undefined }])
  })
  it('an edge without circuit data is dropped; dragging ids are reported', () => {
    const { req, dragging } = requestFromLookup([inode('a', 0, 0, { dragging: true }), inode('b', 500, 0)], [{ id: 'x', source: 'a', target: 'b' }])
    expect(req.edges).toEqual([])
    expect([...dragging]).toEqual(['a'])
  })
  it('signature changes on move, size, hidden, selected, dragging, parent — not on anything else', () => {
    const base = [inode('a', 0, 0)]
    const s = signatureOf(base)
    expect(signatureOf([inode('a', 1, 0)])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { hidden: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { selected: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { dragging: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { type: 'terminal' })])).toBe(s)
  })
})
```

```ts
// src/renderer/canvas/edges/edgeRoutes.test.ts
import { describe, it, expect } from 'vitest'
import { litSetFor } from './edgeRoutes'
import type { RouteNode } from '../../lib/edge-routing'

const nodes = new Map<string, RouteNode>([
  ['a', { id: 'a', x: 0, y: 0, width: 1, height: 1, isFrame: false, selected: true }],
  ['b', { id: 'b', x: 0, y: 0, width: 1, height: 1, isFrame: false }],
  ['c', { id: 'c', x: 0, y: 0, width: 1, height: 1, isFrame: false }]
])
const edges = [
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'bc', source: 'b', target: 'c', selected: true },
  { id: 'ca', source: 'c', target: 'a' }
]

describe('litSetFor', () => {
  it('lights the hovered edge, selected edges, and every edge touching a selected node', () => {
    expect([...litSetFor(edges, nodes, null)].sort()).toEqual(['ab', 'bc', 'ca'])
    const quiet = new Map(nodes); quiet.set('a', { ...nodes.get('a')!, selected: false })
    expect([...litSetFor(edges, quiet, 'ab')].sort()).toEqual(['ab', 'bc'])
    expect([...litSetFor(edges.map((e) => ({ ...e, selected: false })), quiet, null)]).toEqual([])
  })
})
```

- [ ] **Step 2: Run them, expect failure**

Run: `npx vitest run src/renderer/canvas/edges/`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement requestFromLookup.ts**

```ts
// src/renderer/canvas/edges/requestFromLookup.ts
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
```

- [ ] **Step 4: Implement edgeRoutes.ts**

```ts
// src/renderer/canvas/edges/edgeRoutes.ts
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
```

- [ ] **Step 5: Implement EdgeRouter.tsx**

```tsx
// src/renderer/canvas/edges/EdgeRouter.tsx
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
```

- [ ] **Step 6: Run the tests, expect pass; typecheck the new files**

Run: `npx vitest run src/renderer/canvas/edges/ && npm run typecheck`
Expected: PASS (4 tests), typecheck clean. If `s.rfId` or `s.nodeLookup` is not on the store
type, check `@xyflow/react`'s `ReactFlowState` (both exist in 12.x); `nodeLookup` is a `Map`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/canvas/edges/edgeRoutes.ts src/renderer/canvas/edges/EdgeRouter.tsx src/renderer/canvas/edges/requestFromLookup.ts src/renderer/canvas/edges/*.test.ts
git commit -m "feat(edges): EdgeRouter publishes routes per React Flow instance"
```

---

### Task 9: `CircuitEdge`, its pure model, and the CSS

**Files:**
- Create: `src/renderer/canvas/edges/circuitEdgeModel.ts`, `src/renderer/canvas/edges/CircuitEdge.tsx`, `src/renderer/canvas/edges/index.ts`
- Modify: `src/renderer/styles.css` (dark tokens after line 48 `--caution`; light tokens after line 151 `--accent-text`; new `.edge-*` rules at the end of the file)
- Test: `src/renderer/canvas/edges/circuitEdgeModel.test.ts`

**Interfaces:**
- Consumes: `lookOf`, `EdgeData` (Task 1); `Route`, `RouteNode`, `svgPathFrom`, `arrowheadPoints` (Tasks 6, 7); `useEdgeRoutes` (Task 8); `BaseEdge`, `EdgeLabelRenderer`, `useStore` from `@xyflow/react`.
- Produces:
  ```ts
  export interface EdgeDrawing { path: string; arrows: string[]; outlines: { x: number; y: number; width: number; height: number }[]; showLabel: boolean; className: string; style: { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity: number } }
  export function circuitEdgeModel(route: Route, data: EdgeData, flags: { selected: boolean; lit: boolean; anyLit: boolean; hasLabel: boolean }, endpoints: [RouteNode | undefined, RouteNode | undefined]): EdgeDrawing
  export function CircuitEdge(props: EdgeProps): JSX.Element | null
  export const circuitEdgeTypes: { circuit: typeof CircuitEdge }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/canvas/edges/circuitEdgeModel.test.ts
import { describe, it, expect } from 'vitest'
import { circuitEdgeModel } from './circuitEdgeModel'
import type { Route, RouteNode } from '../../lib/edge-routing'

const route: Route = {
  points: [{ x: 200, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 350 }, { x: 600, y: 350 }],
  ports: [{ x: 200, y: 50, side: 'right' }, { x: 600, y: 350, side: 'left' }],
  fallback: false, labelAt: { x: 400, y: 200 }, bbox: { x: 200, y: 50, width: 400, height: 300 }
}
const a: RouteNode = { id: 'a', x: 0, y: 0, width: 200, height: 100, isFrame: false }
const b: RouteNode = { id: 'b', x: 600, y: 300, width: 200, height: 100, isFrame: false }
const quiet = { selected: false, lit: false, anyLit: false, hasLabel: true }

describe('circuitEdgeModel', () => {
  it('context: solid accent path, two arrowheads, no outlines, label hidden while quiet', () => {
    const m = circuitEdgeModel(route, { kind: 'context' }, quiet, [a, b])
    expect(m.path.startsWith('M 200 50')).toBe(true)
    expect(m.arrows).toHaveLength(2)
    expect(m.outlines).toEqual([])
    expect(m.showLabel).toBe(false)
    expect(m.style).toMatchObject({ stroke: 'var(--edge-context)', strokeWidth: 2 })
    expect(m.className).toContain('edge-context')
  })
  it('lit: label shown, two endpoint outlines, lit class; dim class when another edge is lit', () => {
    const lit = circuitEdgeModel(route, { kind: 'rope', state: { agentColor: '#10a37f' } }, { ...quiet, lit: true, anyLit: true }, [a, b])
    expect(lit.showLabel).toBe(true)
    expect(lit.outlines).toHaveLength(2)
    expect(lit.className).toContain('edge-lit')
    const dim = circuitEdgeModel(route, { kind: 'rope' }, { ...quiet, anyLit: true }, [a, b])
    expect(dim.className).toContain('edge-dim')
  })
  it('selected: white stroke, thicker, label shown', () => {
    const m = circuitEdgeModel(route, { kind: 'rope', state: { agentColor: '#10a37f' } }, { ...quiet, selected: true, lit: true, anyLit: true }, [a, b])
    expect(m.style).toMatchObject({ stroke: '#ffffff', strokeWidth: 3 })
    expect(m.showLabel).toBe(true)
  })
  it('waiting rope: dasharray 6 4 and the animated class', () => {
    const m = circuitEdgeModel(route, { kind: 'rope', state: { waiting: true, agentColor: '#10a37f' } }, quiet, [a, b])
    expect(m.style.strokeDasharray).toBe('6 4')
    expect(m.className).toContain('edge-animated')
  })
  it('fanout has no arrowheads; no label without text', () => {
    const m = circuitEdgeModel(route, { kind: 'fanout', state: { agentColor: '#4285f4' } }, { ...quiet, lit: true, anyLit: true, hasLabel: false }, [a, b])
    expect(m.arrows).toEqual([])
    expect(m.showLabel).toBe(false)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/canvas/edges/circuitEdgeModel.test.ts`
Expected: FAIL, cannot resolve `./circuitEdgeModel`.

- [ ] **Step 3: Implement circuitEdgeModel.ts**

```ts
// src/renderer/canvas/edges/circuitEdgeModel.ts
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
```

- [ ] **Step 4: Implement CircuitEdge.tsx and index.ts**

```tsx
// src/renderer/canvas/edges/CircuitEdge.tsx
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
```

```ts
// src/renderer/canvas/edges/index.ts
export { CircuitEdge, circuitEdgeTypes } from './CircuitEdge'
export { EdgeRouter } from './EdgeRouter'
export { useEdgeRoutes } from './edgeRoutes'
export { EdgeLegend } from './EdgeLegend'
```
(`EdgeLegend` lands in Task 10; leave that line out until then, or add it there.)

- [ ] **Step 5: CSS**

In `src/renderer/styles.css`, after the dark `--caution: #ffd60a;` line (line 48):

```css
  /* Edge kinds (spec 2026-09-11 edge routing): hue per kind, theme-aware; ropes and fan-out use
     the agent's brand colour inline instead. */
  --edge-context: var(--accent);
  --edge-note: #ffd60a;
  --edge-trigger: #bf5af2;
  --edge-annotation: #6ac4dc;
  --edge-handoff: #ff9f0a;
  --edge-neutral: #8e8e93;
```

After the light `--accent-text: #0060df;` line (line 151):

```css
  --edge-context: var(--accent);
  --edge-note: #b58a00;
  --edge-trigger: #8e44c9;
  --edge-annotation: #1f8fa8;
  --edge-handoff: #c97400;
  --edge-neutral: #8e8e93;
```

At the end of the file:

```css
/* ---- circuit edges ---- */
.react-flow__edge g[class*='edge-'] { transition: opacity 120ms ease; }
.react-flow__edge .edge-dim { opacity: 0.2; }
.react-flow__edge .edge-lit .react-flow__edge-path { filter: drop-shadow(0 0 3px currentColor); }
.react-flow__edge .edge-animated .react-flow__edge-path { animation: dashdraw 0.5s linear infinite; }
.react-flow__edge .edge-arrow { stroke: none; }
.react-flow__edge .edge-outline { fill: none; stroke-width: 2; pointer-events: none; opacity: 0.9; }
.edge-label {
  position: absolute;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 6px;
  border-radius: 5px;
  background: rgba(28, 28, 30, 0.85);
  pointer-events: none;
  white-space: nowrap;
}
:root[data-theme='light'] .edge-label { background: rgba(255, 255, 255, 0.92); }
@media (prefers-reduced-motion: reduce) { .react-flow__edge .edge-animated .react-flow__edge-path { animation: none; } }
```

`dashdraw` is React Flow's own keyframe (shipped with its stylesheet, already imported by the
renderer). If `grep -rn dashdraw node_modules/@xyflow/react/dist/` finds nothing, add
`@keyframes dashdraw { to { stroke-dashoffset: -10; } }` above the rules.

- [ ] **Step 6: Run the test and typecheck**

Run: `npx vitest run src/renderer/canvas/edges/circuitEdgeModel.test.ts && npm run typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/canvas/edges/circuitEdgeModel.ts src/renderer/canvas/edges/circuitEdgeModel.test.ts src/renderer/canvas/edges/CircuitEdge.tsx src/renderer/canvas/edges/index.ts src/renderer/styles.css
git commit -m "feat(edges): CircuitEdge component, drawing model, and edge tokens"
```

---

### Task 10: The legend

**Files:**
- Create: `src/renderer/canvas/edges/EdgeLegend.tsx`
- Modify: `src/renderer/canvas/edges/index.ts` (export), `src/renderer/styles.css` (legend rules)
- Test: `src/renderer/canvas/edges/EdgeLegend.test.tsx`

**Interfaces:**
- Produces: `export function EdgeLegend(): JSX.Element` (wraps `<Panel position="bottom-left">`), `export function EdgeLegendBody({ open, onToggle }: { open: boolean; onToggle(): void }): JSX.Element`, `export const LEGEND_ROWS: { label: string; kind: EdgeKind; state?: EdgeState }[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// src/renderer/canvas/edges/EdgeLegend.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EdgeLegendBody, LEGEND_ROWS } from './EdgeLegend'

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = '' })

function mount(open: boolean) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<EdgeLegendBody open={open} onToggle={() => {}} />))
  return host
}

describe('EdgeLegendBody', () => {
  it('collapsed: one chip reading Legend, no rows', () => {
    const host = mount(false)
    expect(host.textContent).toBe('Legend')
    expect(host.querySelectorAll('.edge-legend-row')).toHaveLength(0)
  })
  it('expanded: the five live kinds plus waiting and selected, each with a sample stroke', () => {
    const host = mount(true)
    const rows = host.querySelectorAll('.edge-legend-row')
    expect(rows).toHaveLength(7)
    expect(LEGEND_ROWS.map((r) => r.label)).toEqual(['Context', 'Rope', 'Waiting', 'Note', 'Subagent / loop', 'Trigger', 'Selected'])
    expect(host.querySelectorAll('.edge-legend-row svg path')).toHaveLength(7)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npx vitest run src/renderer/canvas/edges/EdgeLegend.test.tsx`
Expected: FAIL, cannot resolve `./EdgeLegend`.

- [ ] **Step 3: Implement**

```tsx
// src/renderer/canvas/edges/EdgeLegend.tsx
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
```

Add `export { EdgeLegend } from './EdgeLegend'` to `canvas/edges/index.ts`.

CSS, appended to `styles.css`:

```css
.edge-legend-panel { margin: 0 0 56px 12px; } /* clears the pill cluster */
.edge-legend-chip {
  font: 600 11px/1 var(--font-ui, inherit);
  color: var(--muted);
  background: var(--bg-2, rgba(28, 28, 30, 0.85));
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 10px;
  cursor: pointer;
}
.edge-legend-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.edge-legend-rows { list-style: none; margin: 6px 0 0; padding: 8px 10px; display: grid; gap: 6px; background: var(--bg-2, rgba(28, 28, 30, 0.85)); border: 1px solid var(--border); border-radius: 8px; }
.edge-legend-row { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text); }
```

Check `styles.css` for the panel background token the pill cluster uses (`grep -n "canvas-pills" styles.css`) and use that token instead of the fallback if one exists; the legend should sit on the same surface.

- [ ] **Step 4: Run the test, expect pass**

Run: `npx vitest run src/renderer/canvas/edges/EdgeLegend.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/canvas/edges/EdgeLegend.tsx src/renderer/canvas/edges/EdgeLegend.test.tsx src/renderer/canvas/edges/index.ts src/renderer/styles.css
git commit -m "feat(edges): legend chip listing the live edge kinds"
```

---

### Task 11: Wire the canvas: kinds in `displayEdges`, router and legend mounted, hover, bezier removed

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx` — imports (lines 11 to 23), `ropeEdge` + `edgeTypes` (~835 to 842), subagent/loop edges (~1985 and ~2043), `displayEdges` (~2117 to 2210), `<ReactFlow>` props (~13797), children (~13916)
- Modify: `src/renderer/lib/triggerCard.ts:102-123`, `src/renderer/lib/triggerCard.test.ts:67-95`
- Modify: `src/renderer/canvas/edge-model.source.test.ts`
- Delete: `src/renderer/canvas/FloatingEdge.tsx`

**Interfaces:**
- Consumes: `circuitEdgeTypes`, `EdgeRouter`, `EdgeLegend`, `useEdgeRoutes` from `./edges`; `edgeAnimated`, `EdgeData` from `../lib/edgeKinds`.

- [ ] **Step 1: Update the source pins first (they are the failing test)**

In `src/renderer/canvas/edge-model.source.test.ts` replace the first two `it` blocks with:

```ts
  it('every edge is a circuit edge — no family picks a fixed handle side any more', () => {
    expect(src).toContain('edgeTypes={circuitEdgeTypes}')
    expect(src).not.toMatch(/sourceHandle:\s*'/)
    expect(src).not.toMatch(/targetHandle:\s*'/)
    expect(src).not.toContain("type: 'floating'")
    expect(src).not.toContain('FloatingEdge')
  })

  it('context and note links carry their kind; ropes carry state derived from the endpoints', () => {
    expect(src).toContain("data: { kind: isNote ? 'note' : 'context' }")
    expect(src).toContain("kind: 'rope'")
    expect(src).toContain("kind: 'fanout'")
    // No inline colour: the look is a table lookup in CircuitEdge (lib/edgeKinds.ts).
    expect(src).not.toMatch(/markerEnd:\s*\{\s*type:\s*MarkerType/)
  })
```

And add, in the same describe:

```ts
  it('the router and the legend are mounted inside <ReactFlow>, and hover feeds the lit set', () => {
    expect(src).toContain('<EdgeRouter edges={displayEdges} />')
    expect(src).toContain('<EdgeLegend />')
    expect(src).toContain('onEdgeMouseEnter={onEdgeMouseEnter}')
    expect(src).toContain('onEdgeMouseLeave={onEdgeMouseLeave}')
  })
```

Run: `npx vitest run src/renderer/canvas/edge-model.source.test.ts`
Expected: FAIL on the three edited/added tests.

- [ ] **Step 2: `triggerEdges` drops `accent`**

`src/renderer/lib/triggerCard.ts:102-123` becomes:

```ts
export function triggerEdges(
  nodes: Array<{ id: string; type?: string; data: { trigger?: TriggerSpec } }>
): Edge[] {
  const ids = new Set(nodes.map((n) => n.id))
  const out: Edge[] = []
  for (const n of nodes) {
    if (n.type !== 'trigger') continue
    const spec = sanitizeTriggerSpec(n.data.trigger)
    if (!spec || !ids.has(spec.target)) continue
    out.push({
      id: `trigger-edge-${n.id}`,
      source: n.id,
      target: spec.target,
      type: 'circuit',
      data: { kind: 'trigger' },
      selectable: false,
      focusable: false
    })
  }
  return out
}
```

In `triggerCard.test.ts` lines 81 and 94 drop the second argument, and where the test asserted
`style.stroke` or `strokeDasharray`, assert `data: { kind: 'trigger' }` and `type: 'circuit'`
instead. Run `npx vitest run src/renderer/lib/triggerCard.test.ts`: PASS.

- [ ] **Step 3: Canvas imports and the edge type**

In the `@xyflow/react` value import (lines 11 to 22) remove `MarkerType` if nothing else uses
it after this task (`grep -n MarkerType src/renderer/canvas/Canvas.tsx` must return only the
import line before you remove it). Remove `import { FloatingEdge } from './FloatingEdge'`. Add:

```ts
import { circuitEdgeTypes, EdgeLegend, EdgeRouter, useEdgeRoutes } from './edges'
import { edgeAnimated, type EdgeData } from '../lib/edgeKinds'
```

Replace `ropeEdge` and `edgeTypes` (~835 to 842):

```ts
const ropeEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: 'circuit'
})
```

and delete the `const edgeTypes = { floating: FloatingEdge }` line and its comment. In the
`<ReactFlow>` props, `edgeTypes={edgeTypes}` becomes `edgeTypes={circuitEdgeTypes}`.

- [ ] **Step 4: Subagent and loop card edges**

At both `eEdges.push({...})` sites (~1985 and ~2043) replace the object with:

```ts
      eEdges.push({
        id: `e-${lid}`,            // `e-${cid}` at the second site
        source: pid,
        target: lid,               // cid at the second site
        type: 'circuit',
        data: { kind: 'fanout', state: { working: st.state === 'working', agentColor: accent } } satisfies EdgeData,
        animated: st.state === 'working'    // v.state === 'working' at the second site
      })
```

- [ ] **Step 5: `displayEdges`**

Replace the body from `const labelBg = {` through the end of the `ropes` map (up to and
including `return base\n    })`) with:

```ts
    const decorated = linkEdges.filter((e) => !hiddenLinks.has(e.id)).map((e) => {
      const sel = !!e.selected
      const isNote = stickyIds.has(e.source)
      const baseLabel = isNote ? '🗒 note' : '⇄ context'
      return {
        ...e,
        type: 'circuit',
        data: { kind: isNote ? 'note' : 'context' } satisfies EdgeData,
        label: sel ? `${baseLabel} — ⌫ to remove` : baseLabel
      }
    })
    const ropeCoversLink = new Set(
      linkEdges.filter((e) => hiddenLinks.has(e.id)).map((e) => pairKey(e.source, e.target))
    )
    // Ropes: colour from the source's agent, dashed + ⏳ while the target still waits on the
    // source, white + a removal hint while selected, clay + flowing while the target is a driven
    // browser. The look is derived every render from KIND + STATE (lib/edgeKinds.ts) — nothing
    // about it is stored on the edge; CircuitEdge does the table lookup.
    const ropes = controlEdges.map((e) => {
      const v = ropeVisual(e, info)
      const state = { waiting: v.waiting, driven: drivenTargets.has(e.target), agentColor: info(e.source)?.agentColor }
      const ropeKind = (e.data as { kind?: 'opener' | 'dep' } | undefined)?.kind
      const label = e.selected
        ? v.waiting
          ? `${WAIT_LABEL} · ⌫ to stop waiting`
          : ropeCoversLink.has(pairKey(e.source, e.target))
            ? '⇄ context · ⌫ to remove'
            : '⌫ to remove'
        : v.waiting
          ? WAIT_LABEL
          : undefined
      return {
        ...e,
        type: 'circuit',
        data: { kind: 'rope', state, ropeKind } satisfies EdgeData,
        animated: edgeAnimated('rope', state),
        ...(label ? { label } : {})
      }
    })
```

Keep the `hiddenLinks` line above it and the `all` / `hidden` tail below it unchanged. Change
`const pairs = triggerEdges(nodes as never, accent)` to `triggerEdges(nodes as never)` and drop
`accent` from that memo's dependency list. Remove `accent` from the `displayEdges` dependency
list (it is no longer read there). Keep `const accent = settings.accent` only if something else
in the file still reads it (`grep -n "accent" Canvas.tsx`).

`info(e.source)?.agentColor` uses the `ropeInfoOf` lookup already built two lines above; the
`RopeNodeInfo` type has `agentColor`.

- [ ] **Step 6: Hover handlers and mounts**

Near `onEdgeDoubleClick` (~3506) add:

```ts
  // Edge focus (spec Section 4): hover lights one edge and dims the rest. Written to the routes
  // store, not to Canvas state — a hover must not re-render this component.
  const onEdgeMouseEnter = useCallback((_e: React.MouseEvent, edge: Edge) => {
    useEdgeRoutes.getState().setHovered('1', edge.id)
  }, [])
  const onEdgeMouseLeave = useCallback(() => {
    useEdgeRoutes.getState().setHovered('1', null)
  }, [])
```

`'1'` is React Flow's default `rfId` when `<ReactFlow>` has no `id` prop; confirm with
`grep -n "rfId" node_modules/@xyflow/react/dist/esm/store/initialState.js` (it reads `rfId: '1'`).
If the canvas's `<ReactFlow>` ever gets an `id`, pass the same string here.

In the `<ReactFlow>` props add `onEdgeMouseEnter={onEdgeMouseEnter}` and
`onEdgeMouseLeave={onEdgeMouseLeave}` after `onEdgeDoubleClick`. Among its children, after
`<StatusAwareMiniMap onNodeDoubleClick={goToNode} />`, add:

```tsx
          <EdgeRouter edges={displayEdges} />
          <EdgeLegend />
```

- [ ] **Step 7: Delete the bezier edge**

```bash
git rm src/renderer/canvas/FloatingEdge.tsx
grep -rn "FloatingEdge\b" src/ --include='*.ts' --include='*.tsx'   # must print nothing
```

`lib/floatingEdge.ts` and its test stay: `ports.ts` uses `borderExit`.

- [ ] **Step 8: Typecheck and run the whole renderer suite**

Run: `npm run typecheck && npx vitest run src/renderer`
Expected: clean typecheck; PASS including `edge-model.source.test.ts`, `canvas-wiring.test.tsx`,
`triggerCard.test.ts`. A likely failure: another source-pin test that greps for
`type: 'floating'` (run `grep -rn "'floating'" src --include='*.test.*'`); update each pin to
`'circuit'` with the same intent.

- [ ] **Step 9: Run the app and look**

`npm run dev`. Open a project with a hub agent that opened three nodes and one context link.
Check: right-angle edges, no edge crossing a node, hover lights one edge and dims the rest,
the legend chip expands, a waiting rope is dashed and flowing, selecting a rope turns it white
with the removal hint, deleting it still works (double-click and ⌫). Drag a node across a
rope's corridor: the rope re-routes around it. Switch to the light theme: note and trigger
edges read on the cream ground. Take the two screenshots for the PR (dark, light).

- [ ] **Step 10: Commit**

```bash
git add -A src/renderer/canvas/Canvas.tsx src/renderer/lib/triggerCard.ts src/renderer/lib/triggerCard.test.ts src/renderer/canvas/edge-model.source.test.ts
git commit -m "feat(canvas): circuit edges replace the bezier floating edge

Every family now emits { type: 'circuit', data: { kind, state } }; colour,
dash, arrows and animation come from lib/edgeKinds at render time. The
EdgeRouter routes all edges per geometry change; hover lights one edge."
```

---

### Task 12: Docs, guards, and the PR

**Files:**
- Modify: `CLAUDE.md:2131-2137` and `CLAUDE.md:3122-3130`, `CONTRIBUTING.md:453-460`
- Modify: `docs/superpowers/specs/2026-09-11-edge-routing-design.md` (status line only)

- [ ] **Step 1: CLAUDE.md, the `--after` paragraph (line 2131 onward)**

Replace the sentence starting "All edges route through the single `floating` edge type" through
"no family sets a handle side;" with:

```
All edges route through the single `circuit` edge type (`canvas/edges/CircuitEdge.tsx`):
orthogonal paths from the pure router in `lib/edge-routing/` (ports per kind → obstacles, with
frames blocking foreign edges → visibility graph → A* → channel nudging), looked up from a
per-instance store the `EdgeRouter` fills; hue AND dash encode the KIND (`lib/edgeKinds.ts`), a
rope's waiting look is still derived from `pendingLaunch`; an unmeasured node draws nothing rather
than a path to the origin — no family sets a handle side;
```

- [ ] **Step 2: CLAUDE.md, the Canvas interaction bullet (line 3122 onward)**

Replace the **Edges** bullet's text up to "where the `link-out`/`link-in` drag handles are drawn."
with:

```
- **Edges** are all one React Flow type, `circuit` (`canvas/edges/`, spec
  docs/superpowers/specs/2026-09-11-edge-routing-design.md). The look is a table lookup on the
  edge's KIND and STATE (`lib/edgeKinds.ts`: context, note, rope, fanout, trigger; annotation and
  handoff reserved) — never inline `style`/`markerEnd` on the edge object — and hue plus dash both
  encode the kind so a colourblind reader tells them apart. Paths are orthogonal, routed by the
  pure module `lib/edge-routing/` (no React, no store): ports are fixed per kind (context/note
  left–right, opener ropes and fan-out bottom→top, dep ropes right→left, with a flip rule),
  every route avoids nodes and any frame that holds neither endpoint (`OBSTACLE_MARGIN` 24 px),
  parallel runs are nudged `CHANNEL_SPACING` apart in kind order, and a route the A* cannot find
  falls back to a plain three-segment path — an edge is never left undrawn. `EdgeRouter` (a child
  of `<ReactFlow>`) routes all edges once per node-geometry change, incrementally during a drag,
  and publishes to `useEdgeRoutes` keyed by React Flow's `rfId` (edge components are not
  descendants of anything the host renders, so context cannot reach them). Hovering lights one
  edge and dims the rest; labels show only while lit or selected; the legend is a bottom-left chip.
```

- [ ] **Step 3: CONTRIBUTING.md (line 453 onward)**

Replace the bold lead sentence and the two sentences about `renderer/lib/floatingEdge.ts` with:

```
**Canvas edges are all `type: 'circuit'` with `data: { kind, state }`, and one relation gets one
edge.** Never set `sourceHandle`/`targetHandle`, and never put `style` or `markerEnd` on an edge
object — the look comes from `renderer/lib/edgeKinds.ts` at render time, so a new kind is one row
in that table (and one legend row), not a new colour at a call site. The path comes from the pure
router in `renderer/lib/edge-routing/`; if you need an edge to avoid something new, it is an
obstacle rule there, not a React change.
```

Keep the rest of the paragraph (the rope / `--after` sentences and the source-pin reference).

- [ ] **Step 4: Spec status line**

Change the spec's status to `implemented on feat/edge-routing` once Task 11 is merged into the
branch.

- [ ] **Step 5: Final verification**

```bash
git diff --check
npm run typecheck
npm test
```

All three clean. Mutation checks (report the results in the PR):
- In `obstacles.ts` set `OBSTACLE_MARGIN` use to `-OBSTACLE_MARGIN` → `route.test.ts` bystander test fails. Revert.
- In `nudge.ts` change `order` to compare `edgeId` only → `nudge.test.ts` "ordered by kind" fails. Revert.
- In `edgeKinds.ts` give `note` `dash: null` → `edgeKinds.test.ts` uniqueness test fails. Revert.

- [ ] **Step 6: Commit and open the PR**

```bash
git add CLAUDE.md CONTRIBUTING.md docs/superpowers/specs/2026-09-11-edge-routing-design.md
git commit -m "docs: circuit edges — CLAUDE.md and CONTRIBUTING.md edge paragraphs"
```

PR text follows the `pr-writing` skill: what + why (David's ask, the five decisions), how checked
(the suites above, the mutation checks, the two screenshots), what was not verified (no
automated visual test; routing under Smart Spawning's layered layout is untested until that
branch lands), risks (perf on canvases above 200 edges; the `floating` → `circuit` rename in the
Network Overview branch; `rfId` `'1'` hard-coded for the canvas instance). Three surfaces:
Desktop full, Server Edition full (renderer only), Mobile N/A (mention @eneskirca: nothing owed).

---

## Self-review

**Spec coverage.** Section 1 → Task 1 (table, uniqueness, overlays) and Task 9 (tokens, arrows
as polygons). Section 2 → Tasks 8, 9, 11 (with the store-not-context correction the spec now
carries). Section 3.1 → Task 2; 3.2 → Task 3; 3.3, 3.4, 3.5 → Task 4; 3.6 → Task 5; 3.7 → Task 6.
Section 4 → Tasks 9 (lit/dim/outlines/labels), 10 (legend), 11 (hover wiring, node selection via
`litSetFor`). Section 5 → Task 11 (canvas), the Network Overview leg is on the sibling branch and
is one import there. Section 6 → Task 7 perf pins. Section 7 → Task 4 fallback, Task 8 skips
unmeasured nodes. Section 9/10 → PR text in Task 12. Section 11 → every test listed has a task.
Not covered by a task: the "selecting a NODE lights its edges" behaviour is tested at the
`litSetFor` level only; there is no React Flow render test for it (jsdom cannot lay out a flow).

**Placeholders.** None. Every step has code or an exact command.

**Type consistency.** `RouteNode` uses `width`/`height` (the `Rect` shape) everywhere, never
`w`/`h`; `Route.ports` is `[Port, Port]`; `routeAll(req, previous?, moved?)` matches Task 7 and
Task 8; `lookOf(kind, state?, selected?)` matches Tasks 1, 9, 10; `EdgeData.ropeKind` is read by
`requestFromLookup` and written by `displayEdges`; `useEdgeRoutes.setHovered(rfId, id)` matches
Tasks 8 and 11; `labelPointOf` is exported from `route.ts` and imported by `nudge.ts`.
