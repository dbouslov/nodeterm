# Edge Rendering and Routing — circuit-board edges

Date: 2026-09-11 · Branch: `feat/edge-routing` · Status: approved design (decisions 1 to 5); implemented on `feat/edge-routing-impl`; plan at docs/superpowers/plans/2026-09-11-edge-routing.md

## Problem

Every relation on the canvas is one bezier between the facing sides of two nodes
(`canvas/FloatingEdge.tsx`, `lib/floatingEdge.ts`). Five families ride it, styled inline in
`displayEdges` (`Canvas.tsx` ~2117): context bridges, note links, ropes ("opened by",
"sequenced after"), ephemeral subagent and loop fan-out, and trigger edges. Three of the five share
the accent colour. A bezier takes the straight way, so on any canvas with more than a handful of
nodes the lines cross nodes, cross each other, and converge on one midpoint per side. David's
words: "the arrows kind of suck right now and constantly overlap and look messy. color coded and
a circuitboard like layout would look great."

Three things are asked for: colour coding by kind, orthogonal routing that avoids nodes and
frames and bundles parallel runs, and legibility aids (hover and selection focus, a legend, labels
only on demand).

## Decisions taken (David, 2026-09-11)

1. **Hue AND line style both encode the kind** (option D). Colourblind-safe by construction: no
   two kinds share both. Agent brand colour stays on ropes and fan-out, so "which agent opened
   this" survives.
2. **Every family goes orthogonal.** One router, one look. The Network Overview's second React
   Flow instance inherits it unchanged. Context bridges keep left/right ports so they still meet
   the drag handles.
3. **Frames are obstacles for foreign edges.** An edge into a member enters through the frame
   border and routes inside around sibling members. A line never crosses a frame it does not
   touch. (Frames never collapse in this app; `collapsed` exists on terminal nodes only, so the
   brief's "pass under collapsed frames" has no referent.)
4. **Bundling on.** Edges sharing a corridor sit in a channel at fixed spacing, ordered by kind so
   colours stay stable side by side; fan-out from one side spreads along that side.
5. **Circuit replaces bezier. No setting.** One renderer to maintain; the canvas and the overview
   are identical.

Grounding facts the design rests on (read from code, 2026-09-11):

- React Flow `12.11.5` ships `getSmoothStepPath` (right angles, corner radius, offset) but no
  obstacle avoidance. No routing library is needed; see Section 8 for what one would cost.
- Frames are React Flow parent nodes (`parentId`, `extent: 'parent'`); a child's stored position
  is frame-relative, and `useInternalNode(...).internals.positionAbsolute` resolves it.
- The look of a rope is derived, never stored (`lib/edgeModel.ts` `ropeVisual`). That rule
  extends to every family here: the edge object carries a KIND and a STATE, and the look is a
  table lookup at render time.
- Themes: dark default and `:root[data-theme='light']` in `renderer/styles.css`. Palette sources:
  `SYSTEM_NODE_COLOR_SWATCHES` (seven macOS system colours) in `shared/node-colors.ts`, agent brand
  colours in `shared/agents/config.ts`, the user accent in `settings.accent`.

## 1. Edge kinds and the look table

`src/renderer/lib/edgeKinds.ts` (pure, no React):

```ts
export type EdgeKind =
  | 'context'    // bridge, readable context, bidirectional
  | 'note'       // sticky → node, one way
  | 'rope'       // opened-by / sequenced-after (state: waiting)
  | 'fanout'     // ephemeral subagent / loop card ← parent agent
  | 'trigger'    // trigger node → target
  | 'annotation' // reserved (no producer yet)
  | 'handoff'    // reserved (no producer yet)

export interface EdgeState {
  waiting?: boolean      // rope: target still armed on this source
  driven?: boolean       // rope: target is a driven browser
  working?: boolean      // fanout: the card is working
  agentColor?: string    // rope / fanout: the source agent's brand colour, else neutral
}

export interface EdgeLook {
  colorVar: string           // CSS custom property, theme-aware; ropes/fanout use agentColor
  dash: string | null        // strokeDasharray or solid
  width: number
  opacity: number
  arrowStart: boolean
  arrowEnd: boolean
  animate: (s: EdgeState) => boolean
}
export const EDGE_LOOK: Record<EdgeKind, EdgeLook>
export function lookOf(kind: EdgeKind, state: EdgeState): ResolvedLook  // colour string, dash, …
```

| Kind | Hue (dark / light) | Line | Width | Arrows | Animated |
|---|---|---|---|---|---|
| context | `--edge-context` = accent | solid | 2 | both | never |
| note | `--edge-note` `#ffd60a` / `#b58a00` | dotted `2 4` | 2 | end | never |
| rope | agent colour, or `--edge-neutral` `#8e8e93` | solid; **dashed `6 4` while waiting** | 1.5 | end | waiting |
| fanout | agent colour at 0.55 | dash-dot `8 3 2 3` | 1.25 | none | working |
| trigger | `--edge-trigger` `#bf5af2` / `#8e44c9` | long dash `12 6`, opacity 0.7 | 1.5 | end | never |
| annotation | `--edge-annotation` `#6ac4dc` / `#1f8fa8` | dash `3 3` | 1.5 | end | never |
| handoff | `--edge-handoff` `#ff9f0a` / `#c97400` | solid | 2.5 | end, diamond | never |

State overlays, applied after the kind look, in this order:

- **driven** (rope): clay `#d97757`, width 2.5, animated. The RUNNING badge's colour, as today.
- **selected**: `--edge-selected` (`#ffffff` dark / `#3a3026` light), width +1.5, label shown with
  the removal hint (Section 4). A token, not a literal: the stroke is also the label's TEXT colour,
  and white on the light theme's near-white card is unreadable.
- **lit** (hovered, or an endpoint node selected): width +1, a soft glow (`filter: drop-shadow`
  in the edge colour), endpoint outlines (Section 4).
- **dim**: when any edge is lit or selected, every other edge drops to opacity 0.2 over 120 ms.

The colour tokens live in `styles.css` under both theme blocks. A test in `edgeKinds.test.ts`
pins that no two kinds share both hue token and dash pattern, and that every kind has an entry.

Arrowheads are drawn by the edge itself, a small polygon at the end of the last segment, which is
axis-aligned so the direction is one of four. No SVG `<marker>` defs and no `MarkerType` objects:
the head is always exactly the stroke's colour, including agent colours and theme tokens.

## 2. Architecture

```
Canvas.tsx / NetworkOverviewView.tsx
  <ReactFlow edges={displayEdges} edgeTypes={circuitEdgeTypes}
             onEdgeMouseEnter onEdgeMouseLeave>
    <EdgeRouter edges/>          // routes ALL edges once per change, publishes to useEdgeRoutes
    <EdgeLegend/>                // <Panel position="bottom-left">, a chip that expands
  edge type 'circuit' → <CircuitEdge/>   // reads its Route from useEdgeRoutes[rfId], paints it

src/renderer/lib/edge-routing/   (pure; no React, no store imports)
  types.ts        Box, Port, Route, RouteRequest, RoutedGraph
  ports.ts        which side, and where on it (spread)
  obstacles.ts    obstacle set per edge (frame rule), inflation by margin
  visibility.ts   candidate lines → vertices → adjacency
  route.ts        A* over the visibility graph; fallback
  nudge.ts        channel detection and offsets (bundling)
  svgPath.ts      points → path with rounded corners; label point; arrowhead polygon
  index.ts        routeAll(request): RoutedGraph
src/renderer/lib/edgeKinds.ts    kind → look table (Section 1)
src/renderer/canvas/edges/
  EdgeRouter.tsx, edgeRoutes.ts (store), requestFromLookup.ts, CircuitEdge.tsx,
  circuitEdgeModel.ts, EdgeLegend.tsx, index.ts
```

`FloatingEdge.tsx` is deleted. `lib/floatingEdge.ts` stays: `borderExit` is the dominant-axis
side rule `ports.ts` reuses.

### 2.1 EdgeRouter and the routes store

Mounted as a child of `<ReactFlow>` (so `useStore` works). It subscribes to one primitive
SIGNATURE, not to the node array: for every node, `id:x,y,w,h,parent,hidden,selected,dragging`
from `internals.positionAbsolute` and `measured`, joined. React Flow re-runs the selector on
every store change, but the router re-renders only when the string changes. It receives `edges`
as a prop from its host (the same array the host gave `<ReactFlow>`), so both instances feed it
the same way.

Routes travel through a small zustand store (`useEdgeRoutes`), keyed by React Flow's instance id
(`rfId`, read with `useStore`), not through React context: React Flow renders edge components in
its own subtree, so a context provider mounted as a child of `<ReactFlow>` never reaches them.
The canvas uses the default id; the overview passes `id="overview"` on its `<ReactFlow>`. The
store also holds the hovered edge id per instance, written by the host's `onEdgeMouseEnter` /
`onEdgeMouseLeave` through `getState()` so a hover never re-renders the host.

```ts
interface RouteRequest {
  boxes: Map<string, Box & { parentId?: string; isFrame: boolean }>   // measured nodes only
  edges: { id: string; source: string; target: string; kind: EdgeKind; ropeKind?: 'opener' | 'dep' }[]
}
interface Route { points: Point[]; ports: [Port, Port]; fallback: boolean; labelAt: Point }
interface RoutedGraph { routes: Map<string, Route> }
export function routeAll(req: RouteRequest, previous?: RoutedGraph, moved?: Set<string>): RoutedGraph
```

Full pass when the signature changes and no node is dragging. During a drag (any node with
`dragging`), the router passes `moved` (the dragged ids) and the previous graph; `routeAll` then
re-routes only edges that touch a moved node or whose current route's bounding box intersects a
moved node's new box, and keeps the rest; nudging is skipped for the re-routed set. On drag stop the signature settles and the full
pass runs. This is what keeps a 100-edge canvas fluid under the mouse; Section 6 has the budget.

Per instance the store publishes `{ routes, nodes, litSet, anyLit }`: `litSet` is the hovered
edge, every selected edge, and every edge touching a selected node.

### 2.2 CircuitEdge

`EdgeProps` in, one `<g>` out: the path (`BaseEdge`-style, with `interactionWidth` 16 so hovering
a 1.5 px line is easy), the arrowhead polygon(s), and, only when lit or selected, the two endpoint
outlines and the label (through `EdgeLabelRenderer`, at `labelAt`). An unmeasured endpoint, or an
edge with no route yet, draws nothing this frame, as today. The look is `lookOf(data.kind,
data.state)` plus the overlays; class names `edge-<kind>`, `edge-lit`, `edge-dim`,
`edge-selected` carry the CSS-side parts (glow, dim transition, animation).

### 2.3 What the host emits

`displayEdges` keeps its shape and its label composition (the pinned strings in
`edge-model.source.test.ts` survive), but every edge becomes:

```ts
{ id, source, target, type: 'circuit', data: { kind, state, ropeKind? }, selected? }
```

No inline `style`, no `markerEnd`; `animated` is set from `edgeAnimated(kind, state)` because
React Flow applies its dash animation class from that edge property, outside the component. The
subagent/loop builder and `triggerEdges` emit the same shape with `kind: 'fanout'` and
`kind: 'trigger'`. `data.anchor` goes away: the port rule is a function of the kind.

## 3. The router

All numbers are constants in `types.ts`, exported for the tests:

```
OBSTACLE_MARGIN = 16   // gutter every route keeps from a node it does not touch (under half a
                       // tidy layout's 40 px gap, or the corridor between neighbours closes)
PORT_STUB       = 20   // straight run out of a port before the first bend
PORT_SPACING    = 12   // between exits on one side
CHANNEL_SPACING = 12   // between parallel runs in one corridor
BEND_COST       = 60   // in px-equivalents, per direction change
WINDOW_PAD      = 200  // search window around the endpoint pair
CORNER_RADIUS   = 8
```

### 3.1 Ports (`ports.ts`)

Side per kind, fixed so the picture is stable while nodes move:

- `context`, `note`: left or right only, by the sign of the horizontal distance (as
  `borderExit(…, 'horizontal')` does today). These meet the `link-out` / `link-in` handles.
- `rope` with `ropeKind: 'opener'`: source bottom, target top. With `'dep'`: source right, target
  left. Both match where Smart Spawning places a child (below) and a dependent (right). A rope
  without `ropeKind` (the field lands with Smart Spawning; absent until then and on legacy ropes)
  uses the dominant-axis rule.
- `fanout`: source bottom, target top (cards sit below their parent).
- `trigger`, `annotation`, `handoff`: dominant axis (`borderExit` with `'all'`).
- **Flip rule**: if the other endpoint's centre lies behind the plane of the preferred side (a
  child dragged above its opener), the side falls back to the dominant-axis choice. Without it the
  route would loop around the node. Deterministic; tested.

Spread on a side: every edge leaving that side of that node is sorted by the angle to its other
endpoint, then placed at `PORT_SPACING` intervals centred on the side's midpoint, clamped to the
side minus a 16 px inset at each end; when they do not fit, the spacing compresses. Two edges
therefore never share an exit point, and a hub with twelve ropes fans them in the order they
head out.

### 3.2 Obstacles (`obstacles.ts`)

For one edge, the obstacle set is every measured, non-hidden node except:

- its two endpoints;
- any frame that contains either endpoint (walking `parentId` upward), so the route may enter a
  frame to reach a member. Every OTHER frame is an obstacle (decision 3);
- nodes inside an obstacle frame: they are covered by the frame, so they are dropped, which keeps
  the graph small.

Each obstacle is inflated by `OBSTACLE_MARGIN`. Endpoint nodes are not obstacles but their own box
still blocks the route from crossing them: the port stub leaves outward and the graph excludes
vertices inside them.

Only obstacles intersecting the search window (the bounding box of the two endpoints padded by
`WINDOW_PAD`) enter the graph. If A* fails inside the window, the window widens once to the whole
canvas; if it fails again the edge gets the fallback (3.5).

### 3.3 Visibility graph (`visibility.ts`)

Candidate vertical lines: for each obstacle, `left − M` and `right + M`; for each port, its x and
the stub's x. Candidate horizontal lines likewise. Vertices are the intersections that are not
strictly inside an inflated obstacle. Two vertices adjacent on one line are joined when the
segment between them crosses no inflated obstacle. With the window restriction a typical edge
sees 5 to 15 obstacles, so a few hundred vertices, which is why the per-edge cost stays in the
tens of microseconds.

### 3.4 A* (`route.ts`)

Cost of a step = its Manhattan length + `BEND_COST` when the direction changes; the heuristic is
the Manhattan distance to the target port. The first step must leave the source along the port's
outward normal and the last must arrive along the target port's inward normal (the stub vertices
enforce this). Ties break on lower vertex index so the result is deterministic. Output is the
corner list only.

### 3.5 Fallback

A plain three-segment orthogonal path between the same two ports (out along the source normal,
across the midline, in along the target normal), with no avoidance. Pure, so the routing module
never imports React Flow. Marked `fallback: true` so tests can tell and the edge carries an
`edge-fallback` class. An edge is never left undrawn because the router gave up.

### 3.6 Bundling (`nudge.ts`, decision 4)

After every route is known: every axis-aligned segment goes into a bucket by (axis, coordinate).
Segments in one bucket whose ranges overlap form a **channel**. Members are ordered by (kind
order as in Section 1's table, source id, target id) so the same edges always sit in the same
order and colours read as stable ribbons. Member *i* of *n* is offset by `(i − (n − 1) / 2) ·
CHANNEL_SPACING` perpendicular to the channel; the adjoining segments' endpoints follow. An
offset that would enter an inflated obstacle is clamped to the obstacle margin; if the corridor
is narrower than the channel, the spacing compresses. Segments already separated by the port
spread are not re-bundled (they share no coordinate).

### 3.7 Path (`svgPath.ts`)

Corners are rounded with `CORNER_RADIUS`, clamped to half the shorter adjoining segment so a
short jog does not overshoot. `labelAt` is the midpoint of the longest segment. The arrowhead is
a triangle (diamond for `handoff`) of 7 px on the last segment's axis, inset so the tip touches
the port.

## 4. Interaction and legibility

- **Hover**: `onEdgeMouseEnter` sets `litEdgeId`; leave clears it. The lit edge gets the lit
  overlay and its label; all other edges dim. Nothing about nodes is written: the endpoint
  highlight is two rounded outlines (2 px, the edge's colour, radius 10, `pointer-events: none`)
  drawn by the lit edge around both endpoint boxes, which it already knows from its route.
- **Selection**: a selected edge is lit persistently, and its label carries the removal hint
  (`⇄ context · ⌫ to remove`, `⏳ waits for · ⌫ to stop waiting`, `⌫ to remove`), composed in
  `displayEdges` as today. Selecting a NODE lights every edge touching it (the provider reads
  `selected` off the node signature) so "what is this node wired to" is one click.
- **Labels only on demand**: `⇄ context`, `🗒 note`, `⏳ waits for` render only while lit or
  selected. The waiting state stays visible without a label: dashed and animated.
- **Legend**: `<EdgeLegend>` is a React Flow `<Panel position="bottom-left">`. Collapsed it is a
  chip reading "Legend"; expanded it lists the five live kinds (reserved kinds are omitted until
  they have a producer) with a 28 px sample stroke and arrowhead in the kind's look, plus one row
  for "waiting" (dashed sample) and one for "selected". Expanded state is transient. The overview
  mounts the same component.
- `interactionWidth` 16 makes a thin line easy to hit; `elevateEdgesOnSelect` stays off (edges
  render under nodes, which the outlines already account for).

## 5. Host integration

**Canvas.tsx**

- `edgeTypes` becomes `circuitEdgeTypes` imported from `canvas/edges`; `ropeEdge` keeps its
  shape (it writes `type: 'circuit'`; the `kind` Smart Spawning adds rides through `data`).
- `displayEdges` emits kind and state (2.3). Colour decisions leave this memo: `accent` is no
  longer an input, `ropeVisual` still is (it answers `waiting`; `agentColor` comes from the same
  `ropeInfoOf`). The eye (`hideFanout`) filter is unchanged.
- The subagent/loop card builder emits `kind: 'fanout'`, `state: { working, agentColor }`.
- `triggerEdges(nodes)` drops its `accent` parameter and emits `kind: 'trigger'`.
- `<EdgeRouter edges={displayEdges}/>` and `<EdgeLegend/>` are rendered inside
  `<ReactFlow>`, beside the minimap; `onEdgeMouseEnter` / `onEdgeMouseLeave` wire the focus.
- `edge-model.source.test.ts` pins move with the change: `type: 'circuit'`, `edgeTypes=
  {circuitEdgeTypes}`, the `anchor: 'horizontal'` pin becomes "context and note edges carry
  `kind: 'context'` / `kind: 'note'`", label strings unchanged.

**Network Overview** (`components/overview/NetworkOverviewView.tsx`, sibling branch): its
`buildOverviewGraph` emits the same edge shape; it mounts the same router, edge types and
legend inside its own `<ReactFlowProvider>` and passes `id="overview"` to `<ReactFlow>`. Its spec names "the existing `floating` edge type";
that becomes `circuit`, one import. Whichever branch lands second makes that one-line change.

**Smart Spawning** (sibling branch): `ropeEdge(id, source, target, kind)` puts `kind` in `data`;
`ports.ts` reads it as `ropeKind`. Until it lands, ropes route by the dominant-axis rule, which
is what today's `borderExit` already does, so nothing degrades. Under its layered layout (opener
top-centre, children in a row below, dependents to the right), opener ropes leave bottom ports
and arrive at top ports, and dep ropes run left to right, so the tree reads as a circuit board
with no diagonal runs.

**Styles** (`styles.css`): the eight `--edge-*` tokens in both theme blocks; `.edge-lit`,
`.edge-dim`, the flow animation (the existing React Flow `animated` dash animation is reused by
class), `.edge-legend`.

## 6. Performance

Budget, pinned by `edge-routing/perf.test.ts` with generous CI bounds:

| Scenario | Target (laptop) | CI pin |
|---|---|---|
| Full pass, 40 nodes / 60 edges, 6 frames | < 8 ms | < 100 ms |
| Full pass, 120 nodes / 200 edges | < 40 ms | < 500 ms |
| Drag pass (one node moved, 120 / 200) | < 4 ms | < 50 ms |

Why it fits: the window restriction bounds each edge's graph; A* with a Manhattan heuristic
expands a small fraction of a few hundred vertices; nudging is a bucket sort over segments. No
worker in v1. If the pin ever fails on a real canvas, the next step is a sweep-line obstacle
index, not a library.

The router's memo is keyed on the node signature string and the `edges` array identity, the
same discipline `displayEdges` uses (`edgeSig`), so a pan or zoom routes nothing.

## 7. Errors and degrades

- Unmeasured node (first tick after mount): the edge draws nothing this frame, as today.
- Router failure after widening: the three-segment fallback, never a missing edge. A count of
  fallback routes is on the routed graph for the test harness; the UI does not show it.
- An edge whose endpoint is gone is dropped by React Flow before the provider sees it.
- Hostile input: none reaches this layer; `project.json` is validated upstream and the router
  only reads measured boxes. A NaN box (impossible from React Flow, guarded anyway) is skipped as
  an obstacle and its edges fall back.
- Theme switch: tokens are CSS, so no re-route; agent colours are literal and read the same in
  both themes, as they do on node headers today.

## 8. Approaches considered

1. **`getSmoothStepPath` with computed ports, no avoidance.** Two days of work, right angles,
   but lines still cross nodes. Rejected; it is this design's fallback only.
2. **In-repo orthogonal router: visibility graph + A* + nudging (chosen).** About 400 lines of
   pure TypeScript with tests, the technique draw.io and libavoid use. Deterministic, unit-testable
   without a DOM, no dependency.
3. **A routing library.** `elkjs` (about 1.6 MB minified, a whole layout engine for one
   connector router), `libavoid-js` (WASM build of libavoid, about 900 KB, async init, no types),
   `@antv/x6`'s router (drags in a second graph framework). Each would be the largest dependency
   in the renderer bundle for a feature that fits in one small module. The repo has already
   refused `dagre` on the same grounds (Smart Spawning spec, decision 8). Rejected.

## 9. Overlaps with the sibling design nodes

| File | This spec | Smart Spawning | Network Overview |
|---|---|---|---|
| `canvas/Canvas.tsx` | `displayEdges`, `edgeTypes`, `ropeEdge` type string, `<ReactFlow>` props, router + legend mount | `ropeEdge` gains `kind`, `arrangeAllNodes`, placement call sites | mounts the overlay beside `KanbanView`, `.minimap-expand` beside the minimap |
| `canvas/FloatingEdge.tsx` | deleted, replaced by `canvas/edges/CircuitEdge.tsx` | no | imports it by name (becomes `circuit`) |
| `lib/floatingEdge.ts` | kept; `borderExit` reused | no | no |
| `lib/edgeModel.ts` | unchanged (`ropeVisual` still answers `waiting`) | `missingDepRopes` writes `kind` | no |
| `canvas/edge-model.source.test.ts` | pins updated | pins `ropeEdge(…, kind)` | no |
| `lib/triggerCard.ts` | `triggerEdges` drops `accent`, emits `kind` | no | no |
| `styles.css` | edge tokens, lit/dim, legend | no | overview styles |
| `shared/types.ts` | no | rope `kind` | `annotation` |
| `components/overview/NetworkOverviewView.tsx` | one import once both land | no | owner |

Merge order that costs least: Smart Spawning (adds `kind`), then this (reads it), then Network
Overview (imports the new edge type). Any other order is one or two lines of conflict, named
above.

## 10. Surfaces

- **Desktop**: full.
- **Server Edition**: full. Everything here is renderer code the browser build ships; no bridge
  call, no core change.
- **Relay tabs**: full; the edges come from the mirrored project the tab already holds.
- **Kanban board**: N/A. Cards, no edges.
- **Mobile**: N/A. No canvas. Nothing is persisted, so the iOS repo owes nothing; noted for
  @eneskirca in the PR.

## 11. Testing

- `lib/edge-routing/ports.test.ts`: side per kind; flip rule; spread never shares an exit point;
  spread compresses on a short side; determinism.
- `lib/edge-routing/obstacles.test.ts`: a frame containing an endpoint is not an obstacle and its
  members are; a foreign frame is, and its members are dropped; hidden nodes excluded; window
  selection.
- `lib/edge-routing/route.test.ts`: a route never enters an inflated obstacle (property test
  over 200 random canvases); straight line when nothing is in the way; minimal bends on the
  canonical U and Z cases; first and last steps normal to their ports; widening then fallback;
  determinism (same input, same output, twice).
- `lib/edge-routing/nudge.test.ts`: two parallel runs offset by exactly `CHANNEL_SPACING`; order
  stable across calls; no offset into an obstacle; compression in a narrow corridor.
- `lib/edge-routing/svgPath.test.ts`: corner radius clamped; label on the longest segment;
  arrowhead direction for all four axes; the path string parses (`M`, `L`, `A` only).
- `lib/edge-routing/perf.test.ts`: the three pins in Section 6.
- `lib/edgeKinds.test.ts`: every kind has a look; hue and dash unique per kind; overlays applied
  in order (driven < selected); neutral colour when no agent.
- `canvas/edges/circuitEdgeModel.test.ts`: lit edge yields two outlines and the label; dimmed
  edge has the class; arrowheads per kind; `requestFromLookup` skips unmeasured nodes;
  `litSetFor` lights hovered, selected, and node-selected edges.
- `canvas/edges/EdgeLegend.test.tsx`: collapsed chip, expands to five kinds plus two states.
- `canvas/edge-model.source.test.ts`: updated pins (Section 5).
- `canvas/edge-model.source.test.ts`: the router, legend and hover handlers are wired (source
  pins; jsdom cannot lay out a React Flow instance, so there is no render test of hover).
- Mutation checks before the PR: break the obstacle inflation and watch the property test fail;
  break the channel ordering and watch the nudge test fail.
- `git diff --check`, `npm run typecheck`, `npm test`.

Not verified by tests: how it looks. The PR carries two screenshots, dark and light, of a
12-node hub canvas before and after.

## 12. Out of scope

- A classic/circuit setting (decision 5).
- User-placed waypoints or edge editing.
- Producers for `annotation` and `handoff`; the table reserves the looks so a later kind cannot
  collide.
- A web worker for routing (only if the perf pin fails on real canvases).
- Edge routing on the phone.
