# Smart Spawning — placement engine + Smart Restructure

Date: 2026-09-11 · Branch: `feat/smart-spawning` · Status: approved design, awaiting plan

## 1. Problem

New nodes have no logical placement. They land on top of each other, and there is no default
structure. Two asks: (a) a sensible default placement rule for new nodes, and (b) collision sensing
so a new node never lands over another.

Measured in code, eight placement rules exist today and only two check for collisions:

| Path | Rule today | Collision check |
|---|---|---|
| Hand: pane right-click (`Canvas.tsx` ~4203) | centered on the cursor via `placeAt` | none |
| Hand: dock / ⌘K / kanban `+` (`emptyNodePos`, `lib/placement.ts`) | `freeSpot` ring search around the view center | yes, but it passes a CENTER to a function that reads a TOP-LEFT, so the box it clears is half a node away from where the node lands |
| Hand: Duplicate / Branch / Transfer (`besideNode`) | right of the source + 32 px | none |
| Agent: `open-terminal` / `open-claude` / `open-agent` (`placeBelow`, `Canvas.tsx` ~9967) | 80 px below the opener, fanned right 460 px per node | none |
| Agent: `--group` (`lib/coldOpen.ts` `groupSlot`) | 2-column grid by child COUNT | none — assumes earlier children never moved |
| Agent: `spawn-team` | `arrangeNodes` grid at `placeBelow(0)`, then wrapped in a frame | none against non-members |
| Cold open into another project (`lib/projectOpen.ts` `nextFreePosition`) | below the lowest node | yes (by construction) |
| Any path with no cursor (`staggeredPosition`) | 360×320 steps keyed on node COUNT, for 600×400 nodes | none, and the step is smaller than the node |

The Server Edition's headless factory (`server/headless-node-factory.ts` `placeRight`) is the one
agent path that scans for a free cell — to the RIGHT of the source, while the desktop places BELOW.
Same verb, two layouts, three copies of the geometry (live `placeBelow`, cold `coldPlaceBelow`,
headless `placeRight`).

## 2. Decisions (David, 2026-09-11)

1. **Two rules, not one.** By hand: the node lands where you clicked, nudged to the nearest free
   spot. By agent: the node attaches to its opener in a fixed direction, never overlapping.
2. **`--after` dependents go to the RIGHT of their dependency.** Dependency reads left-to-right.
3. **No auto-grouping of agent-opened nodes.** Ropes only. `spawn-team` keeps its own frame.
4. **"Hierarchical" = opener lineage top-down, dependency left-to-right within a row.**
5. **Spawning moves only the new node. A separate, explicit Smart Restructure action re-lays out
   the whole project** by that hierarchy, frames kept intact, minimal movement, from the command
   palette and as an agent verb. Restructure REPLACES "Tidy canvas" (same chord, same row): on a
   canvas with no ropes it produces exactly the tidy grid.
6. Loose nodes (no ropes) are packed as a grid below the structured rows.
7. Ropes carry a persisted `kind` (`opener` | `dep`) so dependency order survives launch.
8. Approaches: one shared pure placement engine (A2) + a layered layout over the rope graph built
   on `arrangeNodes` (R1). Rejected: per-call-site patches (keeps eight rules), full re-layout on
   every spawn (moves the user's nodes), force-directed (nondeterministic), dagre (new dependency;
   this repo wrote `@shared/cron` to avoid one).

## 3. The placement engine — `src/shared/placement/` (pure)

One module answers "where does a new node go" for every consumer. It lives in `src/shared` because
the Server Edition's headless factory must import it and `src/server` may not import the renderer.
Renderer-only concerns (React Flow `measured`, ephemeral cards, settings) are resolved by the
caller into plain boxes before calling in.

### 3.1 Types and constants

```ts
export interface Box { x: number; y: number; w: number; h: number }          // root space
export const PLACEMENT_GAP = 40   // between boxes — the same gap arrangeNodes already uses
export const ROW_GAP = 80         // opener → child row; restructure row spacing
export const SCAN_STEPS = 12      // directed scan length before the ring fallback
```

`freeSpot(existing, preferredTopLeft, size, gap = PLACEMENT_GAP)` moves here from
`renderer/lib/placement.ts` unchanged in algorithm (ring search, 60-ring cap, returns `preferred`
past the cap). `renderer/lib/placement.ts` re-exports it so existing imports and its test keep
working. The default gap changes from 28 to 40 so the two engines never disagree about spacing; the
test's gap expectations move with it.

### 3.2 Entry points

- **`placeByHand(existing, center, size)`** → top-left. Centers `size` on `center`, then
  `freeSpot` from that TOP-LEFT (this is the fix for the half-node bug in `emptyNodePos`). If the
  centered spot is clear the node lands exactly where the cursor was — an empty canvas or a lone
  node keeps today's behaviour byte-for-byte.
- **`placeChild(existing, opener: Box, size, index)`** → top-left. Anchor =
  `(opener.x + index * (size.w + GAP), opener.y + opener.h + ROW_GAP)`, then `freeSpotDirected`.
  Same geometry family as today's `placeBelow`, now collision-resolved.
- **`placeDependent(existing, deps: Box[], size)`** → top-left. Anchor =
  `(max(dep.x + dep.w) + GAP, min(dep.y))`, then `freeSpotDirected`. Used whenever `--after` names
  at least one dep that is on this canvas; dependency wins over lineage when both apply.
- **`placeLoose(existing, size)`** → top-left. Below the lowest box, left-aligned with the leftmost
  — today's `nextFreePosition`, moved here (returns a top-left, not a center).
- **`placeInFrame(children: Box[] /* frame-relative */, size)`** → frame-relative top-left. Walks
  `groupSlot(slot)` for `slot = children.length, +1, +2 …` and returns the first slot that does
  not overlap any current child (today's version returns slot `children.length` blind). Capped at
  200 slots, then `freeSpot` inside the frame. `groupSlot`/`GROUP_PAD_*` move here from
  `lib/coldOpen.ts` (re-exported there).
- **`freeSpotDirected(existing, anchor, size, gap)`**: try `anchor`; then step RIGHT up to
  `SCAN_STEPS`; then the next row DOWN (`anchor.y + size.h + gap`, back to `anchor.x`) and repeat,
  up to `SCAN_STEPS` rows; then fall back to `freeSpot`. An agent-placed node therefore never
  lands above or left of its anchor unless the ring fallback is reached — which the tests treat as
  the failure it is (a dense fill of 100 boxes must be satisfied by the directed scan).

### 3.3 Rules every consumer follows

- **Reserve as you place.** A call that opens N nodes appends each placed box to `existing` before
  placing the next (the headless `placeRight` already does this; the live path does not).
- **Sizes**: live path uses `measured ?? width/height ?? default`; serialized paths use
  `CanvasNodeState.size`. A collapsed node counts at its collapsed height.
- **Boxes are ROOT space** — a frame child's stored position is frame-relative and must be
  resolved (`absolutePosition` / `rootPositionIn`) before it enters `existing`. `emptyNodePos`
  currently passes raw positions and is wrong for grouped nodes; fixed by the rewire.
- **Ephemeral subagent/loop cards are not obstacles** (not persisted, vanish on their own).
- **Snapping is unchanged**: the factories still run `placeNode` → `snapNodeToGrid` on the point
  the engine returns. Snapping can move a box by less than one grid cell, and `PLACEMENT_GAP` (40)
  is larger than the default grid (24), so a snapped box cannot be pushed into an overlap.
- **Frame growth stays with the consumer.** The engine answers WHERE; the live path grows the
  frame with the existing `fitGroupToChildren` (hug), the cold path keeps `groupSizeFor` but
  computed from the placed slot rather than the child count. `extent:'parent'` clamping is why the
  frame must be grown in the same transform as the child is added (documented in CLAUDE.md).

### 3.4 What the engine does NOT do

No settings, no per-agent layout preference, no "smart" placement beyond the rules above (YAGNI).
It never moves an existing node — that is Section 5's job and only on an explicit action.

## 4. Rope `kind`

`BridgeLink` gains `kind?: 'opener' | 'dep'`, meaningful on `project.ropes` only.

- **Written** by: `connect()` in the control dispatch and the browser-popup rope → `opener`;
  `ropeDeps()` and `missingDepRopes()` → `dep`; the cold-open twin (`appendCanvasLinks`) mirrors
  the live writer. `ropeEdge(id, source, target, kind)` carries it into `data` so the edge → rope
  serializer round-trips it.
- **Read** by: the restructure ranker (Section 5). `ropeVisual` is unchanged (a wait is still
  derived from `pendingLaunch.after`).
- **Sanitized on load** in `core/workspace-files.ts` (`fileToProject` AND `loadV3`'s inline
  branch — the same two seams `validKanban` covers): a `kind` that is not one of the two strings is
  dropped, the rope is kept. `project.json` is git-shared, hand-editable input.
- **Legacy**: an untagged rope reads as `opener`. A pre-change dep rope therefore ranks its
  dependent one row down instead of beside its dep — a mild, stated degrade, healed the next time
  that node is armed (`missingDepRopes` writes the tagged rope). Additive: an older build ignores
  the field and preserves it on write (`...(p.ropes ? { ropes: p.ropes } : {})` copies whole
  objects).

## 5. Smart Restructure — `renderer/lib/restructure.ts` (pure) + Canvas wiring

### 5.1 Units

A **unit** is a top-level node or a top-level frame. A frame is rigid: it moves as one box
(`nodeW`/`nodeH` of the frame node), its children are never touched, nested frames ride inside.
Every rope endpoint is mapped to its unit (walk `parentId` to the root); ropes inside one unit are
ignored.

### 5.2 Rank

`rank(u) = max( over opener ropes s→u: rank(s) + 1 ,  over dep ropes s→u: rank(s) )`, roots = 0.
Memoized DFS with an on-stack guard: a back edge (cycle from a hand-edited file) is ignored, never
looped on. The dep term keeps a dependent from sitting ABOVE the row of something it waits on
while still not pushing it a row down.

A unit with no ropes in or out is **loose** and excluded from ranking.

### 5.3 Order within a row

Members of rank *r* are ordered by Kahn's algorithm over the dep ropes among them, with the ready
set popped by the key `(openerIndex, currentX)`, where `openerIndex` is the position, in row
*r−1*'s final order, of the member's opener (the leftmost one if several; `Infinity` for none).
Children therefore cluster under their opener, deps precede dependents, and ties keep today's
left-to-right — which is the "minimal movement" tie-break.

### 5.4 Packing

```
left  = min root-space x over all units          // the cluster does not drift
y     = min root-space y over all units
for each rank row in order:
  nodes = arrangeNodes(nodes, rowIds, { layout: 'row', origin: { x: left, y } })
  y += tallest(row) + ROW_GAP
loose = arrangeNodes(nodes, looseIds sorted by current (y, x), { layout: 'grid', origin: { x: left, y } })
```

`arrangeNodes` is the existing packer (gap 40); nothing new is written for geometry. With no ropes
at all every unit is loose and the result is byte-identical to today's `arrangeAllNodes` — the
test that licenses replacing Tidy. Running restructure twice yields the same array (idempotence
test = the "minimal movement" guarantee in a form that can be asserted).

### 5.5 Wiring

- `arrangeAllNodes` in `Canvas.tsx` calls `restructureNodes(nodes, ropes)` instead of
  `arrangeNodes(grid)`. Keeps its guards (kanban open → refuse; < 2 units → no-op so no phantom
  undo/dirty/write), then `markDirty()` + `fitAll()`. One undo entry, as today.
- **Names**: registry command `canvas.tidy` keeps its ID (user overrides must not break) and its
  ⌘⇧A default; its `title` becomes "Restructure canvas". Palette entry `arrange-all` and the
  pane-menu row are relabelled the same; the palette hint keeps "tidy arrange grid" so the old
  words still find it. `ShortcutsPanel` is derived from the registry and follows.
- **Agent verb `restructure`** (no flags in v1): added to `VERBS` in `core/canvas-control-core.ts`
  with one line of skill text; dispatched in `Canvas.tsx` next to `arrange`; **travels** (it needs
  live measured sizes, so it is not in `STORE_ANSWERED_VERBS`); replies
  `restructured N unit(s) in R row(s)`. Not confirm-gated: it is undoable and `arrange` never was.
- The rank function is exported (`rankUnits(nodes, ropes)`) for the Network Overview node to reuse.

## 6. Consumers rewired (Section 3 callers)

| Consumer | Today | After |
|---|---|---|
| Pane right-click add (`Canvas.tsx` ~4203) | cursor → `placeAt` | `placeByHand` |
| `emptyNodePos` (dock / ⌘K / board) | `freeSpot` with the half-node bug | `placeByHand(viewCenter)` over root-space boxes |
| `besideNode` (Duplicate / Branch / Transfer) | right + 32 | `placeDependent(existing, [source])` |
| `placeBelow(i)` in the control dispatch | fixed fan-out | `placeChild` / `placeDependent` per node, reserving as it goes |
| `addGrouped` / `--group` | `groupSlot(existing + i)` blind | `placeInFrame` over the frame's current children |
| `spawn-team` | grid at `placeBelow(0)` | grid at `placeChild(…, 0)`; the wrap-in-frame step is unchanged |
| `lib/coldOpen.ts` `coldPlaceBelow` / cold `--group` | own copy of the numbers | engine (same functions, serialized sizes) |
| `lib/projectOpen.ts` `nextFreePosition` | own copy | `placeLoose` |
| `server/headless-node-factory.ts` `placeRight` | 3-row column scan, RIGHT of source | `placeChild` / `placeDependent` — the server stops disagreeing with the desktop |
| `staggeredPosition` | count-keyed stagger | deleted; every caller now passes a point |

## 7. Overlaps with the sibling design nodes (from code — the context links were not readable)

- **Network Overview (expanded minimap with roles/recommendations)**: the minimap is
  `StatusAwareMiniMap` in `Canvas.tsx` (~876–935, rendered ~13916). This spec does not touch it.
  Shared seam offered: `rankUnits()` from `lib/restructure.ts`, so "role" or "depth" in the
  overview derives from the same rope semantics rather than a second reading of `ctrl-` ids.
  Shared type: the rope `kind` field (Section 4) is the one `shared/types.ts` change; an overview
  that wants lineage should read `kind`, not the id prefix.
- **Project store**: `state/projects.ts` is untouched. `core/workspace-files.ts` gains the rope
  sanitizer (two load seams). If the overview node adds fields to `Project`, both PRs touch
  `shared/types.ts` and `workspace-files.ts` — trivial merge, but say so in both PRs.
- **Nodeterm Fork Build**: no overlap known. Full file list this spec touches:
  `src/shared/placement/*` (new), `src/shared/types.ts`, `src/core/workspace-files.ts`,
  `src/core/canvas-control-core.ts` (+ its test), `src/shared/keybindings.ts`,
  `src/renderer/lib/placement.ts`, `src/renderer/lib/coldOpen.ts`, `src/renderer/lib/projectOpen.ts`,
  `src/renderer/lib/restructure.ts` (new), `src/renderer/lib/edgeModel.ts`,
  `src/renderer/state/workspace.ts` (delete `staggeredPosition`), `src/renderer/canvas/Canvas.tsx`,
  `src/server/headless-node-factory.ts`, `CLAUDE.md` + `CONTRIBUTING.md` (one paragraph each).
- **Out of scope, being fixed by another node**: programmatically drawn context links are not
  visible to `context.sh list`. Not touched here.

## 8. Surfaces

- **Desktop**: full.
- **Server Edition (browser)**: full — Sections 3, 5, 6 are renderer + shared code. Headless
  canvas-control spawns place through the same engine (Section 6, last rows). Headless
  `restructure` is refused with `restructure needs a live canvas` in v1; the pure function takes
  plain boxes, so a headless leg over persisted sizes is a follow-up, not a redesign.
- **Mobile**: N/A — no canvas; the transport protocol carries no positions.
- **Kanban board**: N/A — the board shows cards, never positions; restructure refuses while it is
  open, exactly as Tidy does.

## 9. Testing

- `src/shared/placement/placement.test.ts`: `placeByHand` returns the centered spot when clear;
  a dense 100-box fill never overlaps; `freeSpotDirected` never returns a point above or left of
  the anchor within the scan budget; `placeInFrame` skips a slot a moved child occupies;
  reserving N siblings yields N distinct boxes; `placeLoose` matches the old `nextFreePosition`
  numbers (converted to top-left).
- `src/renderer/lib/restructure.test.ts`: rank by opener chain; a dep never ranks above its
  dependency's row; frames rigid (children's relative positions identical before/after);
  cycle ignored; loose nodes below the rows; no ropes ⇒ output equals `arrangeNodes(grid)` over
  the same ids (the Tidy-replacement pin); idempotence; nested frames untouched.
- `src/renderer/lib/placement-parity.test.ts`: live (`Canvas` helper), cold (`coldOpen`) and
  headless (`server/headless-node-factory`) resolve the same top-left for the same input — the
  test that stops the three copies from ever returning.
- `core/workspace-files.test.ts`: a bad `kind` is dropped, the rope kept, on both load seams.
- `main/canvas-control-core.test.ts`: the skill body names `restructure` and no longer promises
  the old fan-out wording.
- `keybindings` / `ShortcutsPanel` tests: `canvas.tidy` id unchanged, title "Restructure canvas".
- Existing suites updated for the gap change (28 → 40) and the deleted `staggeredPosition`.

## 10. Follow-ups (not in this spec)

- Headless `restructure` over persisted sizes.
- A `--layout` flag on `restructure` (today: one layout, by design).
- Migrating legacy untagged dep ropes (self-heals on re-arm; a one-time sweep is not worth its
  own risk).
