# Smart Spawning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new canvas node lands in a sensible, non-overlapping spot through ONE shared placement engine, and an explicit "Restructure canvas" action re-lays out a project by opener lineage (top-down) and dependency (left-to-right) with frames kept rigid.

**Architecture:** A pure placement module in `src/shared/placement/` (importable by renderer AND server) replaces the eight ad-hoc rules (live `placeBelow`, cold `coldPlaceBelow`, headless `placeRight`, `staggeredPosition`, the half-node-off `freeSpot` call, the blind `groupSlot`). Ropes gain a persisted `kind` (`opener` | `dep`) so lineage vs dependency survives launch. A pure `renderer/lib/restructure.ts` ranks top-level units over the rope graph and packs rows CENTERED under the opener with the existing `arrangeNodes` (plus an opt-in radial layout); it replaces the flat "Tidy canvas" behind the same command id and chord, and is exposed as the agent verb `restructure`.

**Tech Stack:** TypeScript, React Flow (renderer), vitest (`npm test` = `vitest run`; single file: `npx vitest run <path>`), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-09-11-smart-spawning-design.md`

## Global Constraints

- `src/shared` may import nothing from `src/renderer`, `src/main` or `src/server`; `src/server` must not import `src/renderer` (that is why the engine lives in shared).
- `src/core` must not import `electron` (`no-electron.test.ts`).
- All constants come from the engine: `PLACEMENT_GAP = 40`, `ROW_GAP = 80`, `SCAN_STEPS = 12`, `GROUP_PAD_X = 24`, `GROUP_PAD_TOP = 56`, `GROUP_GAP = 24`. Never re-type a number at a call site.
- Every box the engine sees is ROOT space (frame children resolved through `absolutePosition` / `rootPositionIn`). Ephemeral subagent/loop cards (`useAgentNodes.getState().byId`) are never obstacles.
- The engine never moves an existing node. Only `restructureNodes` moves nodes, and only from the explicit action / verb.
- `project.json` and `workspace.json` are hostile input: the rope `kind` is validated on BOTH load seams (`fileToProject` in `core/workspace-files.ts` and the inline branch in `core/workspace-store.ts` ~line 314).
- Agent-facing text in `core/canvas-control-core.ts` (`buildCanvasSkillBody`, `buildCanvasControlInstructions`) changes in the SAME task as the behaviour it describes, with the pin in `src/main/canvas-control-core.test.ts`.
- Command id `canvas.tidy` and its default chord `Cmd+Shift+A` are kept; only the `title` changes to `Restructure canvas`.
- Publish files only via `renameAtomic`/`writeFileAtomic` (not touched by this plan, stated for completeness).
- Commit after every task. Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua`

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/placement/index.ts` (new) | The engine: `Box`, constants, `freeSpot`, `freeSpotDirected`, `placeByHand`, `placeChild`, `placeDependent`, `placeLoose`, `placeInFrame`, `groupSlot`, `groupSizeFor`, `centerOf`. Pure. |
| `src/shared/placement/placement.test.ts` (new) | Engine tests. |
| `src/renderer/lib/placement.ts` | Becomes a re-export of `Box`/`freeSpot` (existing test keeps passing). |
| `src/renderer/lib/coldOpen.ts` | `groupSlot`/`groupSizeFor`/`GROUP_*` become re-exports; `coldPlaceBelow` delegates to the engine and takes the sibling boxes placed so far. |
| `src/renderer/lib/projectOpen.ts` | `nextFreePosition` delegates to `placeLoose` (still returns a CENTER). |
| `src/shared/types.ts` | `BridgeLink.kind?: 'opener' \| 'dep'`. |
| `src/core/workspace-files.ts` | `sanitizeRopes` applied in `fileToProject`; exported for the store. |
| `src/core/workspace-store.ts` | Inline branch applies `sanitizeRopes`. |
| `src/renderer/lib/edgeModel.ts` | `missingDepRopes` emits `kind: 'dep'`. |
| `src/renderer/canvas/Canvas.tsx` | `ropeEdge(id, s, t, kind)`; ropes serialized with `kind`; hand paths, control-verb paths, cold paths use the engine; `arrangeAllNodes` → `restructureNodes`; `restructure` verb dispatch; relabels. |
| `src/renderer/state/workspace.ts` | `staggeredPosition` deleted; `placeAt(undefined)` falls back to a fixed origin. |
| `src/server/headless-node-factory.ts` | `placeRight` → engine (`placeChild` / `placeDependent`). |
| `src/renderer/lib/restructure.ts` (new) | `rankUnits`, `restructureNodes`. Pure. |
| `src/renderer/lib/restructure.test.ts` (new) | Restructure tests. |
| `src/core/canvas-control-core.ts` | `restructure` verb + text. |
| `src/shared/keybindings.ts` | title `Restructure canvas`. |
| `CLAUDE.md`, `CONTRIBUTING.md` | One paragraph each. |

---

### Task 1: The shared placement engine

**Files:**
- Create: `src/shared/placement/index.ts`
- Create: `src/shared/placement/placement.test.ts`

**Interfaces:**
- Produces (every later task consumes these exact names):

```ts
export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export type Point = { x: number; y: number }
export const PLACEMENT_GAP = 40
export const ROW_GAP = 80
export const SCAN_STEPS = 12
export const GROUP_PAD_X = 24
export const GROUP_PAD_TOP = 56
export const GROUP_GAP = 24
export function overlaps(a: Box, b: Box, gap: number): boolean
export function freeSpot(existing: readonly Box[], preferred: Point, size: Size, gap?: number): Point
export function freeSpotDirected(existing: readonly Box[], anchor: Point, size: Size, gap?: number): Point
export function placeByHand(existing: readonly Box[], center: Point, size: Size): Point   // top-left
export function placeChild(existing: readonly Box[], opener: Box, size: Size, index: number): Point
export function placeDependent(existing: readonly Box[], deps: readonly Box[], size: Size): Point
export function placeLoose(existing: readonly Box[], size: Size): Point
export function placeInFrame(children: readonly Box[], size: Size): Point                 // frame-relative
export function groupSlot(slot: number, w: number, h: number): Point
export function groupSizeFor(children: number, w: number, h: number): { width: number; height: number }
export function centerOf(topLeft: Point, size: Size): Point
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/placement/placement.test.ts
import { describe, it, expect } from 'vitest'
import {
  freeSpot, freeSpotDirected, placeByHand, placeChild, placeDependent, placeLoose, placeInFrame,
  groupSlot, groupSizeFor, centerOf, overlaps, PLACEMENT_GAP, ROW_GAP, GROUP_PAD_X, GROUP_PAD_TOP, GROUP_GAP,
  type Box
} from './index'

const size = { w: 100, h: 100 }
const box = (x: number, y: number, w = 100, h = 100): Box => ({ x, y, w, h })
const hits = (p: { x: number; y: number }, s: { w: number; h: number }, existing: Box[]) =>
  existing.some((b) => overlaps({ x: p.x, y: p.y, w: s.w, h: s.h }, b, 0))

describe('freeSpot', () => {
  it('returns the preferred spot when it is clear', () => {
    expect(freeSpot([], { x: 10, y: 20 }, size)).toEqual({ x: 10, y: 20 })
  })
  it('steps a full size+gap away from an occupied spot', () => {
    const spot = freeSpot([box(0, 0)], { x: 0, y: 0 }, size)
    expect(Math.max(Math.abs(spot.x), Math.abs(spot.y))).toBe(100 + PLACEMENT_GAP)
  })
})

describe('freeSpotDirected', () => {
  it('takes the anchor when clear', () => {
    expect(freeSpotDirected([], { x: 5, y: 5 }, size)).toEqual({ x: 5, y: 5 })
  })
  it('scans RIGHT first, never up or left of the anchor', () => {
    const existing = [box(0, 0)]
    const spot = freeSpotDirected(existing, { x: 0, y: 0 }, size)
    expect(spot).toEqual({ x: 100 + PLACEMENT_GAP, y: 0 })
  })
  it('wraps to the next row down when the row is full', () => {
    const step = 100 + PLACEMENT_GAP
    const existing = Array.from({ length: 13 }, (_, i) => box(i * step, 0))
    const spot = freeSpotDirected(existing, { x: 0, y: 0 }, size)
    expect(spot).toEqual({ x: 0, y: step })
  })
  it('never overlaps across a dense fill and never goes above/left of the anchor', () => {
    const step = 100 + PLACEMENT_GAP
    const existing: Box[] = []
    for (let i = 0; i < 100; i++) {
      const p = freeSpotDirected(existing, { x: 0, y: 0 }, size)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(hits(p, size, existing)).toBe(false)
      existing.push({ ...p, ...size })
    }
    expect(existing.length).toBe(100)
    expect(existing[12]).toEqual({ x: 0, y: step, w: 100, h: 100 })
  })
})

describe('placeByHand', () => {
  it('centers the node on the cursor when clear', () => {
    expect(placeByHand([], { x: 500, y: 500 }, size)).toEqual({ x: 450, y: 450 })
  })
  it('checks collision at the TOP-LEFT the node will actually occupy', () => {
    // A box exactly where the centered node would land: must move, and must not overlap.
    const existing = [box(450, 450)]
    const p = placeByHand(existing, { x: 500, y: 500 }, size)
    expect(hits(p, size, existing)).toBe(false)
  })
})

describe('placeChild', () => {
  const opener = box(100, 100, 600, 400)
  it('lands ROW_GAP below the opener, left-aligned, for index 0', () => {
    expect(placeChild([opener], opener, size, 0)).toEqual({ x: 100, y: 100 + 400 + ROW_GAP })
  })
  it('fans siblings right by index', () => {
    expect(placeChild([opener], opener, size, 2)).toEqual({ x: 100 + 2 * (100 + PLACEMENT_GAP), y: 580 })
  })
  it('skips an occupied slot to the right, never onto the opener', () => {
    const taken = box(100, 580)
    const p = placeChild([opener, taken], opener, size, 0)
    expect(p).toEqual({ x: 100 + 100 + PLACEMENT_GAP, y: 580 })
  })
})

describe('placeDependent', () => {
  it('lands right of the rightmost dep, top-aligned with the highest', () => {
    const deps = [box(0, 100, 600, 400), box(700, 50, 200, 100)]
    expect(placeDependent(deps, deps, size)).toEqual({ x: 900 + PLACEMENT_GAP, y: 50 })
  })
  it('resolves a collision to the right, not the left', () => {
    const dep = box(0, 0, 600, 400)
    const taken = box(600 + PLACEMENT_GAP, 0)
    const p = placeDependent([dep, taken], [dep], size)
    expect(p.x).toBeGreaterThan(taken.x)
    expect(hits(p, size, [dep, taken])).toBe(false)
  })
})

describe('placeLoose', () => {
  it('starts at (40,40) on an empty canvas', () => {
    expect(placeLoose([], size)).toEqual({ x: 40, y: 40 })
  })
  it('goes below the lowest box, aligned with the leftmost', () => {
    expect(placeLoose([box(300, 0), box(50, 200)], size)).toEqual({ x: 50, y: 300 + ROW_GAP })
  })
})

describe('placeInFrame', () => {
  it('takes slot N for N children sitting in their slots', () => {
    const kids = [groupSlot(0, 100, 100), groupSlot(1, 100, 100)].map((p) => ({ ...p, ...size }))
    expect(placeInFrame(kids, size)).toEqual(groupSlot(2, 100, 100))
  })
  it('skips a slot a hand-moved child now occupies', () => {
    const kids = [{ ...groupSlot(1, 100, 100), ...size }] // one child, parked in slot 1
    expect(placeInFrame(kids, size)).toEqual(groupSlot(0, 100, 100))
    const kids2 = [{ ...groupSlot(0, 100, 100), ...size }, { ...groupSlot(1, 100, 100), ...size }, { ...groupSlot(2, 100, 100), ...size }]
    expect(placeInFrame(kids2.slice(1), size)).toEqual(groupSlot(0, 100, 100))
  })
})

describe('grid geometry', () => {
  it('groupSlot is the 2-column grid from the old lib/coldOpen', () => {
    expect(groupSlot(0, 100, 50)).toEqual({ x: GROUP_PAD_X, y: GROUP_PAD_TOP })
    expect(groupSlot(1, 100, 50)).toEqual({ x: GROUP_PAD_X + 100 + GROUP_GAP, y: GROUP_PAD_TOP })
    expect(groupSlot(2, 100, 50)).toEqual({ x: GROUP_PAD_X, y: GROUP_PAD_TOP + 50 + GROUP_GAP })
  })
  it('groupSizeFor hugs N children of one size', () => {
    expect(groupSizeFor(3, 100, 50)).toEqual({
      width: GROUP_PAD_X * 2 + 2 * 100 + GROUP_GAP,
      height: GROUP_PAD_TOP + 2 * 50 + GROUP_GAP + GROUP_PAD_X
    })
  })
  it('centerOf inverts a top-left', () => {
    expect(centerOf({ x: 0, y: 0 }, size)).toEqual({ x: 50, y: 50 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/placement/placement.test.ts`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Write the engine**

```ts
// src/shared/placement/index.ts
// WHERE A NEW NODE GOES — one pure engine for every path that creates a node: the renderer's hand
// paths (cursor, dock, palette, board), the canvas-control verbs (live and cold), and the Server
// Edition's headless factory. Lives in src/shared because src/server may not import the renderer.
// Every box is ROOT space (callers resolve frame children first). Nothing here ever moves an
// existing node; the engine answers "where" and reserves nothing — callers append what they place.

export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export type Point = { x: number; y: number }

/** Breathing room between boxes — the same gap `arrangeNodes` uses, so spawn and arrange agree. */
export const PLACEMENT_GAP = 40
/** Vertical distance from an opener's bottom edge to its children's row (and between restructure rows). */
export const ROW_GAP = 80
/** How far the directed scan walks (cells right, then rows down) before the ring fallback. */
export const SCAN_STEPS = 12

// Grid geometry for nodes opened INTO a group frame (moved from lib/coldOpen.ts; re-exported there).
export const GROUP_PAD_X = 24
export const GROUP_PAD_TOP = 56
export const GROUP_GAP = 24

export function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

const clearAt = (existing: readonly Box[], x: number, y: number, size: Size, gap: number): boolean =>
  !existing.some((b) => overlaps({ x, y, w: size.w, h: size.h }, b, gap))

/**
 * Nearest position to `preferred` (a TOP-LEFT) where `size` fits, searched outward in square
 * rings stepped by the node size. Returns `preferred` unchanged when it is already clear, and past
 * the ring cap (overlap beats a hang).
 */
export function freeSpot(existing: readonly Box[], preferred: Point, size: Size, gap = PLACEMENT_GAP): Point {
  if (clearAt(existing, preferred.x, preferred.y, size, gap)) return preferred
  const stepX = size.w + gap
  const stepY = size.h + gap
  for (let ring = 1; ring <= 60; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const x = preferred.x + dx * stepX
        const y = preferred.y + dy * stepY
        if (clearAt(existing, x, y, size, gap)) return { x, y }
      }
    }
  }
  return preferred
}

/**
 * Directed search for AGENT-placed nodes: the anchor, then cells to the RIGHT, then the next row
 * DOWN from the anchor's x, so a spawned node never lands above or left of what it hangs off.
 * Falls back to the ring search only when SCAN_STEPS × SCAN_STEPS cells are all taken.
 */
export function freeSpotDirected(existing: readonly Box[], anchor: Point, size: Size, gap = PLACEMENT_GAP): Point {
  const stepX = size.w + gap
  const stepY = size.h + gap
  for (let row = 0; row < SCAN_STEPS; row++) {
    for (let col = 0; col < SCAN_STEPS; col++) {
      const x = anchor.x + col * stepX
      const y = anchor.y + row * stepY
      if (clearAt(existing, x, y, size, gap)) return { x, y }
    }
  }
  return freeSpot(existing, anchor, size, gap)
}

/** By hand: centered on the cursor; if that spot is taken, the nearest clear one. Returns a top-left. */
export function placeByHand(existing: readonly Box[], center: Point, size: Size): Point {
  return freeSpot(existing, { x: center.x - size.w / 2, y: center.y - size.h / 2 }, size)
}

/** Opener → child: ROW_GAP below the opener, siblings fanned right by `index`, then a directed scan. */
export function placeChild(existing: readonly Box[], opener: Box, size: Size, index: number): Point {
  return freeSpotDirected(
    existing,
    { x: opener.x + index * (size.w + PLACEMENT_GAP), y: opener.y + opener.h + ROW_GAP },
    size
  )
}

/** `--after` dependent: right of the rightmost dep, top-aligned with the highest, then a directed scan. */
export function placeDependent(existing: readonly Box[], deps: readonly Box[], size: Size): Point {
  const right = Math.max(...deps.map((d) => d.x + d.w))
  const top = Math.min(...deps.map((d) => d.y))
  return freeSpotDirected(existing, { x: right + PLACEMENT_GAP, y: top }, size)
}

/** No anchor at all (cold open into another project): below the lowest box, aligned with the leftmost. */
export function placeLoose(existing: readonly Box[], size: Size): Point {
  if (!existing.length) return { x: 40, y: 40 }
  const left = Math.min(...existing.map((b) => b.x))
  const bottom = Math.max(...existing.map((b) => b.y + b.h))
  return freeSpotDirected(existing, { x: left, y: bottom + ROW_GAP }, size)
}

export function groupSlot(slot: number, w: number, h: number): Point {
  return {
    x: GROUP_PAD_X + (slot % 2) * (w + GROUP_GAP),
    y: GROUP_PAD_TOP + Math.floor(slot / 2) * (h + GROUP_GAP)
  }
}

export function groupSizeFor(children: number, w: number, h: number): { width: number; height: number } {
  const cols = Math.min(2, Math.max(1, children))
  const rows = Math.max(1, Math.ceil(children / 2))
  return {
    width: GROUP_PAD_X * 2 + cols * w + (cols - 1) * GROUP_GAP,
    height: GROUP_PAD_TOP + rows * h + (rows - 1) * GROUP_GAP + GROUP_PAD_X
  }
}

/**
 * Inside a frame: the first grid slot no CURRENT child occupies (frame-relative boxes). The old
 * rule returned slot `children.length` blind, which collided whenever a child had been moved.
 */
export function placeInFrame(children: readonly Box[], size: Size): Point {
  for (let slot = 0; slot < 200; slot++) {
    const p = groupSlot(slot, size.w, size.h)
    if (clearAt(children, p.x, p.y, size, 0)) return p
  }
  return freeSpot(children, groupSlot(children.length, size.w, size.h), size, GROUP_GAP)
}

/** The factories take a CENTER (`placeAt` subtracts half the size); this converts an engine answer. */
export function centerOf(topLeft: Point, size: Size): Point {
  return { x: topLeft.x + size.w / 2, y: topLeft.y + size.h / 2 }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/placement/placement.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/shared/placement
git commit -m "feat(placement): shared pure placement engine for new nodes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 2: Re-export seams (renderer keeps its import paths)

**Files:**
- Modify: `src/renderer/lib/placement.ts` (whole file)
- Modify: `src/renderer/lib/coldOpen.ts:150-198` (`coldPlaceBelow`, `GROUP_*`, `groupSlot`, `groupSizeFor`)
- Modify: `src/renderer/lib/projectOpen.ts:249-275` (`nextFreePosition`)
- Test: `src/renderer/lib/placement.test.ts` (existing), `src/renderer/lib/coldOpen.test.ts` (existing), `src/renderer/lib/projectOpen.test.ts` (existing)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `coldPlaceBelow(nodes: readonly ColdNode[], source: ColdNode, i: number, reserved?: readonly Box[]): Point` (CENTER, unchanged contract, now collision-resolved); `nextFreePosition` unchanged signature (CENTER).

- [ ] **Step 1: Replace `src/renderer/lib/placement.ts` with a re-export**

```ts
// src/renderer/lib/placement.ts
// The engine moved to src/shared/placement so the Server Edition's headless factory shares it.
// Re-exported here so existing renderer imports (and this file's test) are untouched.
export { freeSpot, type Box } from '@shared/placement'
```

- [ ] **Step 2: Run the existing placement test**

Run: `npx vitest run src/renderer/lib/placement.test.ts`
Expected: PASS. (The test passes `28` explicitly where it measures the gap; the "default gap" overlap assertion only checks non-overlap. If a case asserts the exact ring distance with the DEFAULT gap, change the expected `128` to `140` in that case only.)

- [ ] **Step 3: Delegate `coldPlaceBelow` and move the grid constants in `lib/coldOpen.ts`**

Replace the block from `export function coldPlaceBelow` through the end of `groupSizeFor` with:

```ts
import { centerOf, placeChild, type Box } from '@shared/placement'
export { GROUP_PAD_X, GROUP_PAD_TOP, GROUP_GAP, groupSlot, groupSizeFor } from '@shared/placement'

/** A stored node as a ROOT-space box for the engine. */
export function coldBox(nodes: readonly ColdNode[], n: ColdNode): Box {
  const at = rootPositionIn(nodes.map(asPlaced), asPlaced(n))
  return { x: at.x, y: at.y, w: widthOf(n), h: heightOf(n) }
}

/**
 * Where the i-th opened node lands when the source IS in this project: the engine's opener→child
 * rule over the stored nodes plus `reserved` (the siblings this same call already placed — the
 * store has not been written yet, so they are not in `nodes`). Returns a CENTER point — the
 * factories' `center` parameter.
 */
export function coldPlaceBelow(
  nodes: readonly ColdNode[],
  source: ColdNode,
  i: number,
  reserved: readonly Box[] = [],
  size: { w: number; h: number } = { w: 600, h: 400 }
): { x: number; y: number } {
  const existing = [...nodes.map((n) => coldBox(nodes, n)), ...reserved]
  return centerOf(placeChild(existing, coldBox(nodes, source), size, i), size)
}
```

(Put the `import` at the top of the file with the other imports; `rootPositionIn`, `asPlaced`, `widthOf`, `heightOf` already exist in this file.)

- [ ] **Step 4: Delegate `nextFreePosition` in `lib/projectOpen.ts`**

Replace the body of `nextFreePosition` with:

```ts
import { centerOf, placeLoose } from '@shared/placement'

export function nextFreePosition(
  nodes: readonly PlacedNode[],
  size: { width: number; height: number } = { width: 640, height: 440 }
): { x: number; y: number } {
  const byId = new Map<string, PlacedNode>()
  for (const n of nodes) if (n.id) byId.set(n.id, n)
  const boxes = nodes
    .map((n) => ({ ...rootPosition(n, byId), w: placedW(n), h: placedH(n) }))
    .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y))
  const s = { w: size.width, h: size.height }
  return centerOf(placeLoose(boxes, s), s)
}
```

- [ ] **Step 5: Run the three suites and fix expectations that encoded the OLD numbers**

Run: `npx vitest run src/renderer/lib/placement.test.ts src/renderer/lib/coldOpen.test.ts src/renderer/lib/projectOpen.test.ts`
Expected: `coldOpen.test.ts` cases that assert `coldPlaceBelow`'s old `x + w/2 + i*460`, `y + h + 80 + 210` numbers FAIL. Update those assertions to the engine's: center = `{ x: abs.x + i*(600+40) + 300, y: abs.y + h + 80 + 200 }` for a 600×400 default. `projectOpen.test.ts` `nextFreePosition` cases keep passing (same geometry: left edge, bottom + 80, plus half size) — if one asserts an exact value on an EMPTY input it stays `{40 + w/2, 40 + h/2}`.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/lib/placement.ts src/renderer/lib/coldOpen.ts src/renderer/lib/coldOpen.test.ts src/renderer/lib/projectOpen.ts
git commit -m "refactor(placement): renderer placement helpers delegate to the shared engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 3: Rope `kind` (type, sanitizer, edge round-trip)

**Files:**
- Modify: `src/shared/types.ts:512-516` (`BridgeLink`)
- Modify: `src/core/workspace-files.ts:356` (beside `validKanban`) and `:491` (`fileToProject` ropes)
- Modify: `src/core/workspace-store.ts:314` (inline branch)
- Modify: `src/renderer/lib/edgeModel.ts:92-108` (`missingDepRopes`)
- Modify: `src/renderer/canvas/Canvas.tsx:834` (`ropeEdge`), `:2498-2502` (restore), `:2687` (commit), `:2893`, `:3303`, `:3323`, `:9064`, `:9972`, `:9981`, `:10034`, `:9834` (writers)
- Test: `src/core/workspace-files.test.ts`, `src/renderer/lib/edgeModel.test.ts`

**Interfaces:**
- Produces: `BridgeLink.kind?: 'opener' | 'dep'`; `sanitizeRopes(ropes: unknown): BridgeLink[] | undefined` (exported from `core/workspace-files.ts`); `ropeEdge(id, source, target, kind: RopeKind)` in Canvas with `data: { kind }`; ropes serialized as `{id, source, target, kind}`.

- [ ] **Step 1: Write the failing sanitizer tests**

Append to `src/core/workspace-files.test.ts`:

```ts
import { sanitizeRopes } from './workspace-files'

describe('sanitizeRopes', () => {
  it('keeps a valid kind and drops an unknown one, keeping the rope', () => {
    expect(
      sanitizeRopes([
        { id: 'ctrl-a-b', source: 'a', target: 'b', kind: 'dep' },
        { id: 'ctrl-a-c', source: 'a', target: 'c', kind: 'constructor' },
        { id: 'ctrl-a-d', source: 'a', target: 'd' }
      ])
    ).toEqual([
      { id: 'ctrl-a-b', source: 'a', target: 'b', kind: 'dep' },
      { id: 'ctrl-a-c', source: 'a', target: 'c' },
      { id: 'ctrl-a-d', source: 'a', target: 'd' }
    ])
  })
  it('drops entries that are not {id, source, target} strings, and answers undefined for a non-array', () => {
    expect(sanitizeRopes([{ id: 1, source: 'a', target: 'b' }, null, 'x'])).toEqual([])
    expect(sanitizeRopes('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/workspace-files.test.ts`
Expected: FAIL — `sanitizeRopes` is not exported.

- [ ] **Step 3: Add the type and the sanitizer**

`src/shared/types.ts`:

```ts
/** Lineage vs dependency on a ROPE (`project.ropes`): `opener` = the source opened the target,
 *  `dep` = the target was armed `--after` the source. Absent on pre-2026-09 files and on bridges;
 *  an absent kind reads as `opener`. */
export type RopeKind = 'opener' | 'dep'

export interface BridgeLink {
  id: string
  source: string
  target: string
  kind?: RopeKind
}
```

`src/core/workspace-files.ts`, next to `validKanban`:

```ts
/**
 * Tolerant reader for `ropes` — the file is hostile input and `kind` reaches the restructure
 * ranker. A bad `kind` is DROPPED and the rope KEPT (an untagged rope reads as `opener`); an entry
 * that is not `{id, source, target}` strings is dropped; a non-array answers undefined.
 */
export function sanitizeRopes(ropes: unknown): BridgeLink[] | undefined {
  if (!Array.isArray(ropes)) return undefined
  const out: BridgeLink[] = []
  for (const r of ropes) {
    if (!r || typeof r !== 'object') continue
    const { id, source, target, kind } = r as Record<string, unknown>
    if (typeof id !== 'string' || typeof source !== 'string' || typeof target !== 'string') continue
    out.push(kind === 'opener' || kind === 'dep' ? { id, source, target, kind } : { id, source, target })
  }
  return out
}
```

In `fileToProject` (line ~491) replace `...(f.ropes ? { ropes: f.ropes } : {}),` with:

```ts
    ...(() => { const ropes = sanitizeRopes(f.ropes); return ropes ? { ropes } : {} })(),
```

In `src/core/workspace-store.ts` inline branch (~line 314) change the destructure and base to:

```ts
        const { kanban, closedSessions, ropes, ...rest } = e.project
        const safeRopes = sanitizeRopes(ropes)
        const base = {
          ...(validKanban(kanban) ? { ...rest, kanban } : rest),
          ...(safeRopes ? { ropes: safeRopes } : {})
        }
```

(and add `sanitizeRopes` to the existing import from `./workspace-files`).

- [ ] **Step 4: Run the sanitizer test**

Run: `npx vitest run src/core/workspace-files.test.ts src/core/workspace-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `missingDepRopes` test**

Append to `src/renderer/lib/edgeModel.test.ts`:

```ts
it('missingDepRopes tags the healed rope as a dep', () => {
  const nodes = [
    { id: 'a', data: {} },
    { id: 'b', data: { pendingLaunch: { after: ['a'], command: 'x' } } }
  ]
  expect(missingDepRopes(nodes as never, [])).toEqual([{ id: 'ctrl-a-b', source: 'a', target: 'b', kind: 'dep' }])
})
```

- [ ] **Step 6: Run it, see it fail, then tag the rope**

Run: `npx vitest run src/renderer/lib/edgeModel.test.ts` → FAIL (no `kind`).

In `src/renderer/lib/edgeModel.ts` change the return type and the push:

```ts
): { id: string; source: string; target: string; kind: 'dep' }[] {
  …
      out.push({ id: `ctrl-${dep}-${n.id}`, source: dep, target: n.id, kind: 'dep' })
```

Run again → PASS.

- [ ] **Step 7: Carry `kind` through the live edge in `Canvas.tsx`**

`ropeEdge` (line 834):

```ts
import type { RopeKind } from '@shared/types'
const ropeEdge = (id: string, source: string, target: string, kind: RopeKind = 'opener'): Edge => ({
  id,
  source,
  target,
  type: 'floating',
  data: { kind }
})
/** The persisted shape of a live rope edge — `kind` rides `data` so commit/restore round-trip it. */
const ropeLink = (e: Edge): { id: string; source: string; target: string; kind?: RopeKind } => {
  const kind = (e.data as { kind?: RopeKind } | undefined)?.kind
  return { id: e.id, source: e.source, target: e.target, ...(kind ? { kind } : {}) }
}
```

Then, at each site:
- `:2498` restore: `(project.ropes ?? []).map((r) => ropeEdge(r.id, r.source, r.target, r.kind ?? 'opener'))`
- `:2501` healed: `.map((r) => ropeEdge(r.id, r.source, r.target, r.kind))`
- `:2687` commit: replace `controlEdgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target }))` with `controlEdgesRef.current.map(ropeLink)`; do the same at `:2893` (`liveRopes:`).
- `:2909`, `:3303`, `:3323`: `ropeEdge(r.id, r.source, r.target, r.kind)` (these carry persisted/healed ropes; `r.kind` may be undefined → defaults to `opener`).
- `:9064`, `:9972`, `:10034`: opener ropes — leave the 3-arg call (defaults to `'opener'`).
- `:9981` (`ropeDeps`): `ropeEdge(\`ctrl-${dep}-${nid}\`, dep, nid, 'dep')`.
- `:9834` cold `coldRopes`: wherever the cold path builds `{ id, source, target }` rope objects for the opener add `kind: 'opener'`, and for `--after` deps add `kind: 'dep'` (search the 9780–9834 block for `ctrl-${` literals; there is one per rope family).

- [ ] **Step 8: Typecheck, run the canvas suites, commit**

Run: `npm run typecheck && npx vitest run src/renderer/canvas src/renderer/lib/edgeModel.test.ts src/core`
Expected: clean / PASS.

```bash
git add src/shared/types.ts src/core/workspace-files.ts src/core/workspace-files.test.ts src/core/workspace-store.ts src/renderer/lib/edgeModel.ts src/renderer/lib/edgeModel.test.ts src/renderer/canvas/Canvas.tsx
git commit -m "feat(ropes): persist a rope kind (opener | dep), sanitized on both load seams

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 4: Live hand paths use the engine; delete `staggeredPosition`

**Files:**
- Modify: `src/renderer/state/workspace.ts:219-227` (`staggeredPosition`, `placeAt`)
- Modify: `src/renderer/canvas/Canvas.tsx:3760-3780` (`emptyNodePos`), `:3898-3908` (`besideNode`), `:4203` (pane right-click add)
- Test: `src/renderer/state/workspace.placement.test.ts` (existing, `placeNode` without a cursor)

**Interfaces:**
- Consumes: `placeByHand`, `placeDependent`, `centerOf`, `Box` from `@shared/placement`; `absolutePosition` from `../lib/nodeFocus`.
- Produces: Canvas helper `liveBoxes(): Box[]` (root-space boxes of every persisted live node, ephemeral cards excluded) and `newNodeSize(): {w,h}`; both used by Tasks 5 and 9.

- [ ] **Step 1: Delete the stagger; fixed fallback in `workspace.ts`**

Replace lines 219–227 with:

```ts
/** Top-left so a node of the given size is centered on `center`. With no point at all (the view
 *  is not measured yet — every real caller passes one) fall back to a fixed origin; the old
 *  count-keyed stagger stepped 360×320 for 600×400 nodes and guaranteed the overlap it existed to
 *  avoid. */
const NO_CURSOR_ORIGIN = { x: 80, y: 120 }
function placeAt(center: { x: number; y: number } | undefined, w: number, h: number) {
  return center ? { x: center.x - w / 2, y: center.y - h / 2 } : NO_CURSOR_ORIGIN
}
```

and change the one call in `placeNode` from `placeAt(center, index, w, h)` to `placeAt(center, w, h)`. `index` stays a parameter of `placeNode` (the factories still pass it; it is used for the color rotation).

- [ ] **Step 2: Run the placement suite**

Run: `npx vitest run src/renderer/state/workspace.placement.test.ts`
Expected: PASS. The "without a cursor" case asserts grid alignment, not the stagger; if it pins `{80,120}` derived values, `NO_CURSOR_ORIGIN` reproduces index 0 of the old stagger exactly.

- [ ] **Step 3: Add `liveBoxes` / `newNodeSize` and rewrite `emptyNodePos` in `Canvas.tsx`**

Replace the `emptyNodePos` callback with:

```ts
  /** Default size of a new terminal/agent node, as the factories will make it. */
  const newNodeSize = useCallback((): { w: number; h: number } => {
    const s = useSettings.getState().settings
    return { w: s.defaultNodeWidth || 640, h: s.defaultNodeHeight || 440 }
  }, [])

  /**
   * Every persisted live node as a ROOT-space box — what the placement engine must not land on.
   * Ephemeral subagent/loop cards are skipped (not persisted, vanish on their own). Frame children
   * are resolved through `absolutePosition`: their stored position is frame-relative.
   */
  const liveBoxes = useCallback((): Box[] => {
    const ephemeral = new Set(Object.keys(useAgentNodes.getState().byId))
    const all = nodesRef.current as FocusableNode[]
    const dflt = newNodeSize()
    return nodesRef.current
      .filter((n) => !ephemeral.has(n.id))
      .map((n) => {
        const at = absolutePosition(n as FocusableNode, all)
        return {
          x: at.x,
          y: at.y,
          w: (n.measured?.width as number | undefined) ?? (n.width as number | undefined) ?? dflt.w,
          h: (n.measured?.height as number | undefined) ?? (n.height as number | undefined) ?? dflt.h
        }
      })
  }, [newNodeSize])

  /**
   * A CENTER point for a node created without a cursor (dock / palette / kanban board): the view
   * center, nudged to the nearest clear spot. Returns undefined only if the view isn't measured.
   */
  const emptyNodePos = useCallback((): { x: number; y: number } | undefined => {
    const preferred = viewCenter()
    if (!preferred) return undefined
    const size = newNodeSize()
    return centerOf(placeByHand(liveBoxes(), preferred, size), size)
  }, [viewCenter, newNodeSize, liveBoxes])
```

Add to the imports: `import { centerOf, placeByHand, placeDependent, type Box } from '@shared/placement'` and remove the now-unused `import { freeSpot } from '../lib/placement'` (line 461).

- [ ] **Step 4: Rewrite `besideNode`**

```ts
  /** Where a node spawned FROM another node (Duplicate / Branch / Transfer) goes when the action
   *  carried no cursor: just right of its source, on the first clear spot. CENTER point. */
  const besideNode = useCallback((source: CanvasNode): { x: number; y: number } => {
    const all = nodesRef.current as FocusableNode[]
    const p = absolutePosition(source as FocusableNode, all)
    const size = newNodeSize()
    const src: Box = {
      x: p.x, y: p.y,
      w: (source.measured?.width as number | undefined) ?? (source.width as number | undefined) ?? 600,
      h: (source.measured?.height as number | undefined) ?? (source.height as number | undefined) ?? 400
    }
    return centerOf(placeDependent(liveBoxes(), [src], size), size)
  }, [newNodeSize, liveBoxes])
```

Check every caller of `besideNode` passes its result where a CENTER is expected (they pass it as the factories' `center` / to `placeSpawned` as an absolute point — `placeSpawned` sets `position` directly, so for THAT caller convert back: `const c = besideNode(src); placeSpawned(node, { x: c.x - w/2, y: c.y - h/2 })` where `w`/`h` are the new node's `width`/`height`). Grep `besideNode(` and fix each site accordingly.

- [ ] **Step 5: Pane right-click add (line ~4203)**

Where `const center = screenToFlowPosition({ x: event.clientX, y: event.clientY })` feeds the factories, change it to:

```ts
      const cursor = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const size = newNodeSize()
      const center = centerOf(placeByHand(liveBoxes(), cursor, size), size)
```

and add `newNodeSize, liveBoxes` to that callback's dependency array.

- [ ] **Step 6: Typecheck, run canvas tests, commit**

Run: `npm run typecheck && npx vitest run src/renderer/canvas src/renderer/state`
Expected: clean / PASS.

```bash
git add src/renderer/state/workspace.ts src/renderer/canvas/Canvas.tsx
git commit -m "feat(canvas): hand-placed nodes land where clicked, nudged clear; drop the count stagger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 5: Live control verbs place through the engine

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx:9958-9968` (`srcAbs`/`placeBelow`), `:10140-10175` (`addGrouped`), `:10240-10250` (`open-terminal make`), the matching `make` in `open-claude`/`open-agent` (~10370-10390), `:10825` and `:10966` (verify panel + spawn-team origins)
- Test: `src/renderer/canvas/canvas-wiring.test.tsx` (existing; add one source-level pin)

**Interfaces:**
- Consumes: `placeChild`, `placeDependent`, `placeInFrame`, `centerOf`, `Box`; `liveBoxes()` from Task 4; `fitGroupToChildren` (workspace.ts), `snapGridNow()` (Canvas).
- Produces: inside the dispatch closure, `placeNext(i: number, after: string[] | undefined): Point` (CENTER) and `reserve(node: CanvasNode): void`.

- [ ] **Step 1: Replace `srcAbs` / `placeBelow` with an engine-backed closure**

Replace the block from `const srcW = …` through `const placeBelow = …` with:

```ts
      // Placement for the nodes this call opens. Opener → child goes BELOW the source, fanned
      // right; a node armed `--after` goes RIGHT of its dependency (dependency outranks lineage).
      // Every box is root space; `reserved` holds the siblings this same call has placed, because
      // `setNodes` is async and nodesRef will not show them yet.
      const srcBox: Box = (() => {
        const p = absolutePosition(src as FocusableNode, nodesRef.current as FocusableNode[])
        return {
          x: p.x, y: p.y,
          w: src.measured?.width ?? (src.width as number) ?? 600,
          h: src.measured?.height ?? (src.height as number) ?? 400
        }
      })()
      const reserved: Box[] = []
      const boxOf = (id: string): Box | undefined => {
        const n = nodesRef.current.find((nd) => nd.id === id)
        if (!n) return undefined
        const p = absolutePosition(n as FocusableNode, nodesRef.current as FocusableNode[])
        return { x: p.x, y: p.y, w: n.measured?.width ?? (n.width as number) ?? 600, h: n.measured?.height ?? (n.height as number) ?? 400 }
      }
      const placeNext = (i: number, after?: string[]): { x: number; y: number } => {
        const size = newNodeSize()
        const existing = [...liveBoxes(), ...reserved]
        const deps = (after ?? []).map(boxOf).filter((b): b is Box => !!b)
        const topLeft = deps.length ? placeDependent(existing, deps, size) : placeChild(existing, srcBox, size, i)
        reserved.push({ ...topLeft, ...size })
        return centerOf(topLeft, size)
      }
      // Kept for the verbs that arrange a panel/team below the source in one grid.
      const placeBelow = (i = 0) => placeNext(i)
```

- [ ] **Step 2: Use `placeNext` in the three open verbs**

In `open-terminal`'s `make` replace `placeBelow(i)` with `placeNext(i, after ?? undefined)`. Do the same in `open-claude` and `open-agent`'s `make` closures (search for `placeBelow(i)` inside the `case 'open-claude'` / `case 'open-agent'` blocks — each has exactly one).

- [ ] **Step 3: `addGrouped` places into the frame's CURRENT children and hugs the frame**

Replace the body of `addGrouped` with:

```ts
      const addGrouped = (groupId: string, count: number, make: (i: number) => CanvasNode): string[] => {
        const kids: Box[] = nodesRef.current
          .filter((nd) => nd.parentId === groupId)
          .map((nd) => ({
            x: nd.position.x, y: nd.position.y,
            w: nd.measured?.width ?? (nd.width as number) ?? 600,
            h: nd.measured?.height ?? (nd.height as number) ?? 400
          }))
        const ids: string[] = []
        for (let i = 0; i < count; i++) {
          const node = make(i)
          const size = { w: (node.width as number) ?? 600, h: (node.height as number) ?? 400 }
          const slot = placeInFrame(kids, size)
          kids.push({ ...slot, ...size })
          node.position = slot
          node.parentId = groupId
          node.extent = 'parent'
          ids.push(addAndConnect(node))
        }
        // Grow the frame to hug its children IN THE SAME TICK the children land — `extent:'parent'`
        // clamps a child outside the frame into an inverted range. Hug, never a count-based guess.
        setNodes((ns) => fitGroupToChildren(ns, groupId, snapGridNow()))
        return ids
      }
```

(`groupSizeFor` and `groupSlot` imports in Canvas become unused for the live path — remove them from the `../lib/coldOpen` import ONLY if the cold path in Task 6 no longer needs them either; Task 6 keeps `groupSizeFor`.)

- [ ] **Step 4: Verify panel + spawn-team origins**

At `:10825` and `:10966` the `arrangeNodes(next, ids, { layout: 'grid', origin: placeBelow(0) })` calls pass a CENTER as an origin (top-left). Change both to:

```ts
            const teamSize = newNodeSize()
            const c0 = placeBelow(0)
            next = arrangeNodes(next, memberIds /* or panelIds */, { layout: 'grid', origin: { x: c0.x - teamSize.w / 2, y: c0.y - teamSize.h / 2 } })
```

- [ ] **Step 5: Source-level pin**

Append to `src/renderer/canvas/canvas-wiring.test.tsx`:

```ts
it('control-verb placement goes through the shared engine, not a local fan-out', () => {
  const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  expect(src).not.toMatch(/i \* 460/)
  expect(src).toMatch(/placeDependent\(existing, deps, size\)/)
  expect(src).toMatch(/placeInFrame\(kids, size\)/)
})
```

(`readFileSync` is already imported in that file for the `fitView(` pin; if not, add `import { readFileSync } from 'node:fs'`.)

- [ ] **Step 6: Typecheck, run, commit**

Run: `npm run typecheck && npx vitest run src/renderer/canvas`
Expected: clean / PASS.

```bash
git add src/renderer/canvas/Canvas.tsx src/renderer/canvas/canvas-wiring.test.tsx
git commit -m "feat(canvas-control): open-*/--group/spawn-team place through the engine, never overlapping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 6: Cold paths (own-project cold open, `--group`, `--project`)

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx:9724-9790` (cold open loop), `:9410-9420` (`--project` `tgBase`)
- Test: `src/renderer/lib/coldOpen.test.ts` (already updated in Task 2; add the `reserved` case)

**Interfaces:**
- Consumes: `coldPlaceBelow(nodes, source, i, reserved, size)` and `coldBox` from Task 2; `placeInFrame`, `groupSizeFor`, `centerOf`, `placeLoose`.

- [ ] **Step 1: Failing test for `reserved`**

Append to `src/renderer/lib/coldOpen.test.ts`:

```ts
it('coldPlaceBelow does not stack two siblings when the first is passed back as reserved', () => {
  const src: ColdNode = { id: 's', position: { x: 0, y: 0 }, size: { width: 600, height: 400 } }
  const a = coldPlaceBelow([src], src, 0)
  const b = coldPlaceBelow([src], src, 0, [{ x: a.x - 300, y: a.y - 200, w: 600, h: 400 }])
  expect(b).not.toEqual(a)
  expect(b.x).toBeGreaterThan(a.x)
})
```

Run: `npx vitest run src/renderer/lib/coldOpen.test.ts` → this case PASSES already if Task 2 was done right (the engine reserves); if it FAILS, `coldPlaceBelow` is not spreading `reserved` into `existing` — fix that.

- [ ] **Step 2: Cold open loop reserves and places in-frame by current children**

In the `for (let i = 0; i < coldCount; i++)` loop (~9724) declare before it:

```ts
            const coldReserved: Box[] = []
            const coldKids: Box[] = coldNodes
              .filter((n) => n.parentId === coldGroup.groupId)
              .map((n) => ({ x: n.position.x, y: n.position.y, w: n.size?.width ?? 600, h: n.size?.height ?? 400 }))
```

replace both `coldPlaceBelow(coldNodes, coldSrcNode, i)` with `coldPlaceBelow(coldNodes, coldSrcNode, i, coldReserved)`, and after `const node = …` (the armed node) add:

```ts
              coldReserved.push({
                x: node.position.x, y: node.position.y,
                w: (node.width as number) ?? 600, h: (node.height as number) ?? 400
              })
```

Replace the `if (coldGroup.groupId) { … node.position = groupSlot(coldExistingInGroup + i, w, h) … }` block with:

```ts
              if (coldGroup.groupId) {
                const size = { w: (node.width as number) ?? 600, h: (node.height as number) ?? 400 }
                const slot = placeInFrame(coldKids, size)
                coldKids.push({ ...slot, ...size })
                node.position = slot
                node.parentId = coldGroup.groupId
                node.extent = 'parent'
              }
```

and in the frame-growth block replace `groupSizeFor(coldExistingInGroup + coldCount, w, h)` with a hug over `coldKids`:

```ts
                const need = {
                  width: Math.max(...coldKids.map((k) => k.x + k.w)) + GROUP_PAD_X,
                  height: Math.max(...coldKids.map((k) => k.y + k.h)) + GROUP_PAD_X
                }
```

(`GROUP_PAD_X` is re-exported from `../lib/coldOpen`; `coldExistingInGroup`/`coldGroupChildCount`/`groupSlot`/`groupSizeFor` imports become unused in Canvas — remove them from the import list; keep the exports in `lib/coldOpen.ts` for their tests.)

- [ ] **Step 3: `--project` open uses `placeLoose` per node**

At ~9418, `tgBase` is computed once and then offset per `i`. Replace with a per-node `nextFreePosition` over the growing set:

```ts
          const tgPlaced: PlacedNode[] = [...tgPlacedNodes]
          for (let i = 0; i < tgCount; i++) {
            const at = nextFreePosition(tgPlaced, { width: w, height: h })
            const node = tgIsTerminal ? createTerminalNode(tgIndexBase + i, tgCwd, at, args.cmd) : createAgentNode(tgAgentId, tgIndexBase + i, tgCwd, at, /* …unchanged args… */)
            tgPlaced.push({ id: node.id, position: node.position, width: node.width as number, height: node.height as number })
            tgMade.push(node)
          }
```

(Keep every other argument of the two factory calls exactly as they are today; only the `{ x: 0, y: 0 }` placeholder and the later `tgBase` offset go away. Delete the `tgBase` variable and the code that wrote `node.position` from it.)

- [ ] **Step 4: Typecheck, run, commit**

Run: `npm run typecheck && npx vitest run src/renderer/lib/coldOpen.test.ts src/renderer/lib/projectOpen.test.ts src/renderer/canvas`
Expected: clean / PASS.

```bash
git add src/renderer/canvas/Canvas.tsx src/renderer/lib/coldOpen.test.ts
git commit -m "feat(cold-open): cold and --project opens place through the engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 7: Headless factory places through the engine

**Files:**
- Modify: `src/server/headless-node-factory.ts:126-128` (`H_GAP`/`V_GAP`), `:211-249` (`placeRight`), `:1174`, `:1282` (callers)
- Test: `src/server/headless-node-factory.test.ts:205` (existing assertion) + one new case

**Interfaces:**
- Consumes: `placeChild`, `placeDependent`, `type Box` from `'../shared/placement'`.
- Produces: `placeNode(project, source, size, reserved, deps?: readonly CanvasNodeState[]): {x,y}` replacing `placeRight`.

- [ ] **Step 1: Failing test**

Append to `src/server/headless-node-factory.test.ts` (use the file's existing fixture helpers — `terminal(...)`, the factory construction and the `open-terminal` call pattern from the case at line ~205):

```ts
it('an open-terminal lands BELOW its opener (desktop rule), and a second one beside the first', async () => {
  // Build the same fixture the "created position" case above uses, then open two terminals.
  // (copy that case's setup; call open-terminal with count 2)
  const src = /* the opener CanvasNodeState */
  const [a, b] = /* the two created nodes, in creation order */
  expect(a.position.y).toBeGreaterThanOrEqual(src.position.y + src.size.height + 80)
  expect(a.position.x).toBe(src.position.x)
  expect(b.position.y).toBe(a.position.y)
  expect(b.position.x).toBeGreaterThan(a.position.x)
})
```

Fill the two placeholders by copying the exact setup lines from the neighbouring test; the assertion body above is the deliverable. Run: `npx vitest run src/server/headless-node-factory.test.ts` → the new case FAILS (today the node lands to the RIGHT: `a.position.x > src.position.x`).

- [ ] **Step 2: Replace `placeRight`**

Delete `H_GAP`, `V_GAP` and `placeRight`; add:

```ts
import { placeChild, placeDependent, type Box } from '../shared/placement'

function nodeBox(project: Project, node: CanvasNodeState): Box {
  const p = absolutePosition(project, node)
  return {
    x: p.x, y: p.y,
    w: Math.max(1, node.size?.width || TERMINAL_SIZE.width),
    h: Math.max(1, node.size?.height || TERMINAL_SIZE.height)
  }
}

/**
 * Where a node this verb opens lands — the shared engine's rules, over the project's stored nodes
 * plus the nodes this same call has already made (`reserved`, not in `project.nodes` yet). With
 * `deps` (an `--after` list that resolved to stored nodes) the node goes RIGHT of them; otherwise
 * BELOW the source — the desktop's rule, which this factory used to contradict by placing right.
 */
function placeNode(
  project: Project,
  source: CanvasNodeState,
  size: { width: number; height: number },
  reserved: readonly CanvasNodeState[] = [],
  deps: readonly CanvasNodeState[] = []
): { x: number; y: number } {
  const existing = [...project.nodes, ...reserved].map((n) => nodeBox(project, n))
  const s = { w: size.width, h: size.height }
  if (deps.length) return placeDependent(existing, deps.map((d) => nodeBox(project, d)), s)
  return placeChild(existing, nodeBox(project, source), s, reserved.length)
}
```

At `:1174` change `placeRight(target, source.node, nodeSize, created)` to `placeNode(target, source.node, nodeSize, created, afterNodes)` where `afterNodes` is the array of stored nodes the verb's `after` ids resolved to (the surrounding code already resolves `after` ids against `target.nodes` for the arm; reuse that list — if it only holds ids, map them: `after.map((id) => target.nodes.find((n) => n.id === id)).filter(Boolean)`). At `:1282` change to `placeNode(source.project, source.node, STICKY_SIZE)`.

- [ ] **Step 3: Run the server suite; fix the old right-of assertion**

Run: `npx vitest run src/server/headless-node-factory.test.ts`
Expected: the line-205 assertion `expect(created!.position.x).toBeGreaterThan(terminal('x','x').position.x)` now FAILS (x is equal, y is below). Change it to `expect(created!.position.y).toBeGreaterThan(terminal('x', 'x').position.y)`. Re-run → PASS.

- [ ] **Step 4: Typecheck, `no-electron` guard, commit**

Run: `npm run typecheck && npx vitest run src/server`
Expected: clean / PASS.

```bash
git add src/server/headless-node-factory.ts src/server/headless-node-factory.test.ts
git commit -m "feat(server): headless canvas-control places through the shared engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 8: Smart Restructure (pure)

**Files:**
- Create: `src/renderer/lib/restructure.ts`
- Create: `src/renderer/lib/restructure.test.ts`

**Interfaces:**
- Consumes: `arrangeNodes`, `type CanvasNode` from `../state/workspace`; `ROW_GAP`, `PLACEMENT_GAP` from `@shared/placement`; `absolutePosition` from `./nodeFocus`; `BridgeLink` from `@shared/types`.
- Produces:

```ts
export type RestructureLayout = 'rows' | 'radial'
export interface RankedUnits { rank: Map<string, number>; loose: string[]; rows: string[][] }
export function rankUnits(nodes: readonly CanvasNode[], ropes: readonly BridgeLink[]): RankedUnits
export function restructureNodes(nodes: CanvasNode[], ropes: readonly BridgeLink[], layout?: RestructureLayout): CanvasNode[]  // default 'rows'
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/lib/restructure.test.ts
import { describe, it, expect } from 'vitest'
import { rankUnits, restructureNodes } from './restructure'
import { arrangeNodes, type CanvasNode } from '../state/workspace'
import type { BridgeLink } from '@shared/types'
import { ROW_GAP, PLACEMENT_GAP } from '@shared/placement'

const n = (id: string, x: number, y: number, w = 100, h = 50, parentId?: string, type: 'terminal' | 'group' = 'terminal'): CanvasNode =>
  ({ id, type, position: { x, y }, width: w, height: h, parentId, data: { title: id, color: '#fff', group: null } }) as CanvasNode
const rope = (s: string, t: string, kind?: 'opener' | 'dep'): BridgeLink => ({ id: `ctrl-${s}-${t}`, source: s, target: t, ...(kind ? { kind } : {}) })
const pos = (out: CanvasNode[], id: string) => out.find((x) => x.id === id)!.position

describe('rankUnits', () => {
  it('ranks by the longest opener chain; untagged ropes count as opener', () => {
    const r = rankUnits([n('a', 0, 0), n('b', 0, 0), n('c', 0, 0)], [rope('a', 'b'), rope('b', 'c', 'opener')])
    expect(r.rank.get('a')).toBe(0); expect(r.rank.get('b')).toBe(1); expect(r.rank.get('c')).toBe(2)
    expect(r.rows).toEqual([['a'], ['b'], ['c']])
  })
  it('a dep rope keeps the dependent on its dependency\'s row, never above it', () => {
    // root opens x; x opens y; root ALSO opens z but z waits on y → z must be on y's row (2), not row 1
    const r = rankUnits([n('root', 0, 0), n('x', 0, 0), n('y', 0, 0), n('z', 0, 0)],
      [rope('root', 'x'), rope('x', 'y'), rope('root', 'z'), rope('y', 'z', 'dep')])
    expect(r.rank.get('z')).toBe(2)
    expect(r.rows[2]).toEqual(['y', 'z']) // dep before dependent
  })
  it('a frame is one unit ranked by its earliest member; ropes inside it are ignored', () => {
    const nodes = [n('conductor', 0, 0), n('g', 0, 300, 400, 200, undefined, 'group'), n('m1', 10, 10, 100, 50, 'g'), n('m2', 200, 10, 100, 50, 'g')]
    const r = rankUnits(nodes, [rope('conductor', 'm1'), rope('conductor', 'm2'), rope('m1', 'm2')])
    expect(r.rank.get('g')).toBe(1)
    expect(r.rank.has('m1')).toBe(false)
  })
  it('a cycle is ignored, not looped on', () => {
    const r = rankUnits([n('a', 0, 0), n('b', 0, 0)], [rope('a', 'b'), rope('b', 'a')])
    expect(r.rank.get('a')).toBe(0); expect(r.rank.get('b')).toBe(1)
  })
  it('units with no ropes are loose, ordered by current (y, x)', () => {
    const r = rankUnits([n('p', 500, 0), n('q', 0, 100), n('a', 0, 0), n('b', 0, 0)], [rope('a', 'b')])
    expect(r.loose).toEqual(['p', 'q'])
  })
  it('children cluster under their opener within a row', () => {
    const nodes = [n('l', 0, 0), n('r', 900, 0), n('r1', 0, 0), n('l1', 800, 0)]
    const r = rankUnits(nodes, [rope('l', 'l1'), rope('r', 'r1')])
    expect(r.rows[0]).toEqual(['l', 'r'])
    expect(r.rows[1]).toEqual(['l1', 'r1']) // l1 first although its current x is larger
  })
})

describe('restructureNodes', () => {
  it('packs rows top-down, each row CENTERED under the opener, ROW_GAP apart', () => {
    // opener a is 100 wide at x=100 → its center x is 150; the two children (100 + 40 + 100 = 240 wide)
    // must be centered on 150 → the row starts at 150 - 120 = 30.
    const nodes = [n('a', 100, 500), n('b', 600, 20), n('c', 700, 20)]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(pos(out, 'a')).toEqual({ x: 100, y: 20 })
    expect(pos(out, 'b')).toEqual({ x: 30, y: 20 + 50 + ROW_GAP })
    expect(pos(out, 'c')).toEqual({ x: 30 + 100 + PLACEMENT_GAP, y: 20 + 50 + ROW_GAP })
  })
  it('with no ropes at all is a pure TRANSLATION of arrangeNodes(grid) over the same ids sorted by (y, x)', () => {
    const nodes = [n('c', 5, 300), n('a', 0, 0), n('b', 400, 0)]
    const ids = ['a', 'b', 'c']
    const tidy = arrangeNodes(nodes, ids, { layout: 'grid' })
    const out = restructureNodes(nodes, [])
    const dx = pos(out, 'a').x - pos(tidy, 'a').x
    const dy = pos(out, 'a').y - pos(tidy, 'a').y
    for (const id of ids) expect(pos(out, id)).toEqual({ x: pos(tidy, id).x + dx, y: pos(tidy, id).y + dy })
  })
  it('radial: rank-1 units sit on one ring below the root center, spread across the lower half-plane', () => {
    const nodes = [n('a', 0, 0, 100, 50), n('b', 0, 0, 100, 50), n('c', 0, 0, 100, 50), n('d', 0, 0, 100, 50)]
    const out = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c'), rope('a', 'd')], 'radial')
    const c = { x: pos(out, 'a').x + 50, y: pos(out, 'a').y + 25 }
    const dist = (id: string) => Math.hypot(pos(out, id).x + 50 - c.x, pos(out, id).y + 25 - c.y)
    expect(dist('b')).toBeCloseTo(dist('c'), 5)
    expect(dist('c')).toBeCloseTo(dist('d'), 5)
    for (const id of ['b', 'c', 'd']) expect(pos(out, id).y + 25).toBeGreaterThanOrEqual(c.y) // lower half
    expect(pos(out, 'b').x).toBeLessThan(pos(out, 'c').x) // row order = left → right along the arc
    expect(pos(out, 'c').x).toBeLessThan(pos(out, 'd').x)
    // ring is long enough: no two units overlap
    const ids = ['b', 'c', 'd']
    for (const p of ids) for (const q of ids) if (p < q) {
      const P = pos(out, p), Q = pos(out, q)
      expect(P.x < Q.x + 100 && P.x + 100 > Q.x && P.y < Q.y + 50 && P.y + 50 > Q.y).toBe(false)
    }
  })
  it('frames are rigid: children keep their relative positions', () => {
    const nodes = [n('o', 0, 0), n('g', 300, 900, 400, 200, undefined, 'group'), n('m', 37, 41, 100, 50, 'g')]
    const out = restructureNodes(nodes, [rope('o', 'm')])
    expect(pos(out, 'm')).toEqual({ x: 37, y: 41 })
    expect(pos(out, 'g')).toEqual({ x: 0, y: 50 + ROW_GAP })
  })
  it('loose nodes go below the rows as a grid', () => {
    const nodes = [n('a', 0, 0), n('b', 0, 200), n('z', 900, 900)]
    const out = restructureNodes(nodes, [rope('a', 'b')])
    expect(pos(out, 'z').y).toBeGreaterThanOrEqual(pos(out, 'b').y + 50 + ROW_GAP)
    expect(pos(out, 'z').x).toBe(0)
  })
  it('is idempotent', () => {
    const nodes = [n('a', 100, 500), n('b', 600, 20), n('c', 700, 20), n('z', 900, 900)]
    const once = restructureNodes(nodes, [rope('a', 'b'), rope('a', 'c')])
    expect(restructureNodes(once, [rope('a', 'b'), rope('a', 'c')])).toEqual(once)
  })
  it('returns the input array unchanged for fewer than 2 units', () => {
    const nodes = [n('a', 5, 5)]
    expect(restructureNodes(nodes, [])).toBe(nodes)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/lib/restructure.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/restructure.ts
// SMART RESTRUCTURE — re-lay out a whole project by the rope graph: opener lineage top-down (a
// child sits in the row under its opener), dependency left-to-right (a `--after` dependent sits
// beside, and after, what it waits on), frames rigid, loose nodes packed below. Pure: Canvas wires
// setNodes/markDirty/fitAll. With no ropes it degenerates to the old "Tidy canvas" grid exactly,
// which is why it could replace it behind the same command.
import { arrangeNodes, type CanvasNode } from '../state/workspace'
import type { BridgeLink } from '@shared/types'
import { ROW_GAP, PLACEMENT_GAP } from '@shared/placement'
import { absolutePosition, type FocusableNode } from './nodeFocus'

export interface RankedUnits {
  /** rank per UNIT id (top-level node or top-level frame); loose units are absent */
  rank: Map<string, number>
  /** units with no ropes in or out, in current (y, x) order */
  loose: string[]
  /** unit ids per rank, in final left-to-right order */
  rows: string[][]
}

const nodeW = (n: CanvasNode) => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode) => n.measured?.height ?? (n.height as number) ?? 0

/** The top-level unit a node belongs to: itself, or its outermost ancestor frame. Cycle-guarded. */
function unitOf(id: string, byId: Map<string, CanvasNode>): string {
  let cur = byId.get(id)
  const seen = new Set<string>()
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  return cur?.id ?? id
}

export function rankUnits(nodes: readonly CanvasNode[], ropes: readonly BridgeLink[]): RankedUnits {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const all = nodes as readonly FocusableNode[]
  const units = nodes.filter((n) => !n.parentId || !byId.has(n.parentId)).map((n) => n.id)
  const unitSet = new Set(units)
  const rootPos = (id: string) => absolutePosition(byId.get(id) as FocusableNode, all)

  // Edges between UNITS; an edge whose endpoints resolve to one unit (a rope inside a frame) or to
  // a node that is not on the canvas is dropped.
  type E = { s: string; t: string; dep: boolean }
  const edges: E[] = []
  for (const r of ropes) {
    if (!byId.has(r.source) || !byId.has(r.target)) continue
    const s = unitOf(r.source, byId)
    const t = unitOf(r.target, byId)
    if (s === t || !unitSet.has(s) || !unitSet.has(t)) continue
    edges.push({ s, t, dep: r.kind === 'dep' })
  }
  const incoming = new Map<string, E[]>()
  const connected = new Set<string>()
  for (const e of edges) {
    connected.add(e.s); connected.add(e.t)
    incoming.set(e.t, [...(incoming.get(e.t) ?? []), e])
  }

  // rank(u) = max(opener sources: rank+1, dep sources: rank); roots 0. Back edges (cycles) ignored.
  const rank = new Map<string, number>()
  const onStack = new Set<string>()
  const rankOf = (u: string): number => {
    const known = rank.get(u)
    if (known !== undefined) return known
    if (onStack.has(u)) return 0 // back edge: contributes nothing
    onStack.add(u)
    let r = 0
    for (const e of incoming.get(u) ?? []) {
      if (onStack.has(e.s)) continue
      r = Math.max(r, rankOf(e.s) + (e.dep ? 0 : 1))
    }
    onStack.delete(u)
    rank.set(u, r)
    return r
  }
  for (const u of units) if (connected.has(u)) rankOf(u)

  const byYX = (a: string, b: string) => {
    const pa = rootPos(a), pb = rootPos(b)
    return pa.y - pb.y || pa.x - pb.x
  }
  const loose = units.filter((u) => !connected.has(u)).sort(byYX)

  // Rows: Kahn over the row's dep edges, ready set popped by (opener index in previous row, x).
  const maxRank = Math.max(-1, ...rank.values())
  const rows: string[][] = []
  for (let r = 0; r <= maxRank; r++) {
    const members = units.filter((u) => rank.get(u) === r)
    const prev = new Map((rows[r - 1] ?? []).map((id, i) => [id, i]))
    const openerIndex = (u: string) => {
      const idx = (incoming.get(u) ?? []).filter((e) => !e.dep).map((e) => prev.get(e.s)).filter((i): i is number => i !== undefined)
      return idx.length ? Math.min(...idx) : Infinity
    }
    const key = (u: string): [number, number] => [openerIndex(u), rootPos(u).x]
    const inRow = new Set(members)
    const indeg = new Map(members.map((u) => [u, (incoming.get(u) ?? []).filter((e) => e.dep && inRow.has(e.s)).length]))
    const out: string[] = []
    const ready = members.filter((u) => indeg.get(u) === 0)
    while (ready.length) {
      ready.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] })
      const u = ready.shift()!
      out.push(u)
      for (const e of edges) {
        if (e.dep && e.s === u && inRow.has(e.t)) {
          const d = indeg.get(e.t)! - 1
          indeg.set(e.t, d)
          if (d === 0) ready.push(e.t)
        }
      }
    }
    for (const u of members) if (!out.includes(u)) out.push(u) // a dep cycle inside one row
    rows.push(out)
  }
  return { rank, loose, rows }
}

export type RestructureLayout = 'rows' | 'radial'

const rowWidth = (ids: string[], byId: Map<string, CanvasNode>): number =>
  ids.reduce((w, id) => w + nodeW(byId.get(id)!), 0) + Math.max(0, ids.length - 1) * PLACEMENT_GAP

export function restructureNodes(
  nodes: CanvasNode[],
  ropes: readonly BridgeLink[],
  layout: RestructureLayout = 'rows'
): CanvasNode[] {
  const { loose, rows } = rankUnits(nodes, ropes)
  const unitIds = [...rows.flat(), ...loose]
  if (unitIds.length < 2) return nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const all = nodes as readonly FocusableNode[]
  const rootOf = (id: string) => absolutePosition(byId.get(id) as FocusableNode, all)
  // The horizontal anchor: the CURRENT center of the rank-0 row (one orchestrator ⇒ it does not
  // move sideways). With no ranked rows at all (every unit loose) the cluster's current center.
  const anchorIds = rows[0] ?? unitIds
  const ax0 = Math.min(...anchorIds.map((id) => rootOf(id).x))
  const ax1 = Math.max(...anchorIds.map((id) => rootOf(id).x + nodeW(byId.get(id)!)))
  const cx = (ax0 + ax1) / 2
  const top = Math.min(...unitIds.map((id) => rootOf(id).y))
  let next = nodes
  let y = top
  if (layout === 'rows') {
    for (const row of rows) {
      next = arrangeNodes(next, row, { layout: 'row', origin: { x: cx - rowWidth(row, byId) / 2, y } })
      y += Math.max(...row.map((id) => nodeH(byId.get(id)!))) + ROW_GAP
    }
  } else {
    // RADIAL: rank r on a ring of radius R[r] around the rank-0 center; one root ⇒ the lower
    // half-plane (θ from 0 to π, i.e. right → bottom → left), several ⇒ the full circle. The ring
    // is at least long enough for the row's widths, so neighbours on one ring cannot overlap.
    const root = rows[0] ?? []
    const cyRoot = root.length
      ? root.reduce((s, id) => s + rootOf(id).y + nodeH(byId.get(id)!) / 2, 0) / root.length
      : top
    const c = { x: cx, y: cyRoot }
    const arc = root.length > 1 ? 2 * Math.PI : Math.PI
    let R = 0
    let prevTallest = root.length ? Math.max(...root.map((id) => nodeH(byId.get(id)!))) : 0
    // rank 0 stays on its own centered row (a single root simply stays put vertically)
    if (root.length) next = arrangeNodes(next, root, { layout: 'row', origin: { x: cx - rowWidth(root, byId) / 2, y: cyRoot - prevTallest / 2 } })
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const tallest = Math.max(...row.map((id) => nodeH(byId.get(id)!)))
      R = Math.max(R + prevTallest / 2 + ROW_GAP + tallest / 2, (rowWidth(row, byId) + row.length * PLACEMENT_GAP) / arc)
      const step = arc / row.length
      const placed = new Map<string, { x: number; y: number }>()
      row.forEach((id, i) => {
        const theta = root.length > 1 ? i * step - Math.PI / 2 : step * (i + 0.5) // one root: 0..π, left→right
        const w = nodeW(byId.get(id)!), h = nodeH(byId.get(id)!)
        // one root: sweep from the LEFT end of the arc (θ=π) to the right (θ=0) so row order reads left→right
        const t = root.length > 1 ? theta : Math.PI - theta
        placed.set(id, { x: c.x + R * Math.cos(t) - w / 2, y: c.y + R * Math.sin(t) - h / 2 })
      })
      next = next.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id)! } : n))
      prevTallest = tallest
    }
    y = c.y + R + prevTallest / 2 + ROW_GAP
  }
  if (loose.length) {
    // Loose units pack as today's Tidy grid, centered on the same anchor.
    const cols = Math.max(1, Math.ceil(Math.sqrt(loose.length)))
    const gridW = Math.max(...Array.from({ length: Math.ceil(loose.length / cols) }, (_, r) => rowWidth(loose.slice(r * cols, (r + 1) * cols), byId)))
    next = arrangeNodes(next, loose, { layout: 'grid', origin: { x: cx - gridW / 2, y } })
  }
  return next
}
```

Note for the "no ropes is a translation of Tidy" test: `arrangeAllNodes` used to call `arrangeNodes(grid)` with the DEFAULT origin (bounding-box top-left) over ids sorted by `(y, x)`; `rankUnits` sorts loose units the same way and `restructureNodes` passes a CENTERED origin, so the relative layout is identical and only the origin differs — hence the translation check rather than equality. The radial branch's `Math.PI - theta` is what makes row order read left → right on the half-circle (θ=π is the left end).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderer/lib/restructure.test.ts`
Expected: PASS. If "children cluster under their opener" fails on ordering, check that `key()` reads `openerIndex` from `rows[r-1]` (the FINAL order of the previous row), not from `members`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/restructure.ts src/renderer/lib/restructure.test.ts
git commit -m "feat(restructure): pure layered layout over the rope graph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 9: Wire Restructure — replaces Tidy, plus the `restructure` verb

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx:6798-6810` (`arrangeAllNodes`), `:8517` (pane-menu row), `:13328-13338` (palette entry), `:10620` region (add `case 'restructure'` beside `arrange`)
- Modify: `src/shared/keybindings.ts:147` (title)
- Modify: `src/shared/keybindings.test.ts:107`, `src/renderer/components/ShortcutsPanel.test.tsx:126,233`
- Modify: `src/core/canvas-control-core.ts:111-131` (union), `:140-171` (`VERBS`), `:395-398` (skill body), `:477-479` (instructions)
- Test: `src/main/canvas-control-core.test.ts`, `src/server/control-unsupported.test.ts`

**Interfaces:**
- Consumes: `restructureNodes` (Task 8); `ropeLink` (Task 3).
- Produces: verb `restructure [--layout rows|radial]` in `ControlVerb`/`VERBS`; reply `restructured N unit(s) in R row(s)` / `… R ring(s)`; palette entries `arrange-all` (rows) and `arrange-all-radial`.

- [ ] **Step 1: Failing core test for the verb + text**

Append to `src/main/canvas-control-core.test.ts`:

```ts
it('restructure is a registered verb with no required flags, and both agent-facing texts describe it', () => {
  expect(VERBS).toContain('restructure')
  expect(parseControlRequest('restructure', {})).toEqual({ verb: 'restructure', args: {} })
  expect(parseControlRequest('restructure', { layout: 'spiral' })).toEqual({ error: 'restructure --layout must be rows or radial' })
  for (const body of [buildCanvasSkillBody(), buildCanvasControlInstructions()]) {
    expect(body).toMatch(/`restructure/)
    expect(body).toMatch(/--layout rows\|radial/)
    expect(body).toMatch(/centered/i)
  }
})
```

(Use the file's existing imports of `VERBS`, `parseControlRequest`, `buildCanvasSkillBody`, `buildCanvasControlInstructions`; if `parseControlRequest` returns a richer shape in this file's other tests, match that shape.) Run: `npx vitest run src/main/canvas-control-core.test.ts` → FAIL.

- [ ] **Step 2: Register the verb and write the text**

`src/core/canvas-control-core.ts`: add `| 'restructure'` to `ControlVerb` after `'align'`; add `'restructure',` to `VERBS` after `'align',`; in the validation block add:

```ts
  if (v === 'restructure' && args.layout && args.layout !== 'rows' && args.layout !== 'radial') {
    return { error: 'restructure --layout must be rows or radial' }
  }
```

In `buildCanvasSkillBody` after the `align` bullet add:

```ts
    '- `restructure [--layout rows|radial]` — re-lay out the WHOLE project by lineage, centered on the',
    '  opener: you sit top-center, the nodes you opened in a centered row beneath you, their children',
    '  beneath those; a node armed `--after` sits to the right of what it waits on; frames move as one',
    '  block with their insides untouched; unconnected nodes pack below. `radial` puts each generation',
    '  on a ring around you instead of a row. Same as the user\'s ⌘⇧A "Restructure canvas"; undoable.',
    '  Prefer it over hand-arranging after a fan-out.',
```

In `buildCanvasControlInstructions` change the sentence `align the frames themselves with \`arrange --nodes <groupId,…> --layout row\`` to `run \`restructure [--layout rows|radial]\` once the fan-out is open (you top-center, your stations in a centered row below, dependents to the right), or align the frames yourself with \`arrange --nodes <groupId,…> --layout row\``.

Run: `npx vitest run src/main/canvas-control-core.test.ts` → PASS.

- [ ] **Step 3: Server Edition refusal is already generic — pin it**

Append to `src/server/control-unsupported.test.ts`:

```ts
it('restructure is refused headlessly like arrange (needs a live canvas)', async () => {
  const r = await serverEditionControlHandler({ verb: 'restructure' } as never)
  expect(r).toMatchObject({ ok: false })
})
```

(Match the existing cases' call shape in that file; the assertion is `ok: false` with the unsupported error code the other cases assert.) Run: `npx vitest run src/server/control-unsupported.test.ts` → PASS.

- [ ] **Step 4: Rename the command title and fix the two tests**

`src/shared/keybindings.ts:147`: `title: 'Restructure canvas'`. `src/shared/keybindings.test.ts:107`: `title: 'Restructure canvas'`. `src/renderer/components/ShortcutsPanel.test.tsx:126,233`: replace `'Tidy canvas'` with `'Restructure canvas'`.

Run: `npx vitest run src/shared/keybindings.test.ts src/renderer/components/ShortcutsPanel.test.tsx` → PASS.

- [ ] **Step 5: `arrangeAllNodes` calls the restructure; relabel the two rows**

```ts
  const arrangeAllNodes = useCallback(() => {
    if (isGlobalKanbanOpen() || isKanbanOpen(useProjects.getState().activeProjectId)) return
    // Under 2 units: nothing to lay out — restructureNodes returns the SAME array, and setNodes
    // with it would still add an undo entry + markDirty + a project.json write for no change.
    const next = restructureNodes(nodesRef.current, controlEdgesRef.current.map(ropeLink), layout)
    if (next === nodesRef.current) return
    setNodes(next)
    markDirty()
    fitAll()
  }, [setNodes, markDirty, fitAll])
```

(give it the signature `(layout: RestructureLayout = 'rows') =>`; the keybinding handler `'canvas.tidy': () => { arrangeAllNodes(); return true }` and the pane-menu row keep calling it with no argument). Pane-menu row (~8517): label `'Restructure canvas'`. Palette entry (~13335): `label: 'Restructure canvas'`, `hint: 'tidy arrange grid layout organize clean up lineage'`; add a second entry right after it, gated by the same `hasArrangeableNodes()`:

```ts
            {
              id: 'arrange-all-radial',
              label: 'Restructure canvas (radial)',
              hint: 'tidy arrange ring fan layout',
              icon: <IconGrid />,
              run: () => arrangeAllNodes('radial')
            } as Command
```

Import `restructureNodes`, `rankUnits` and `type RestructureLayout` from `'../lib/restructure'`.

- [ ] **Step 6: Dispatch the verb**

Next to `case 'arrange':`/`'align'` (the shared case at ~10620) add a separate case:

```ts
          case 'restructure': {
            if (isGlobalKanbanOpen() || isKanbanOpen(useProjects.getState().activeProjectId)) {
              reply({ ok: false, error: 'restructure: the kanban board is open — close it first' })
              return
            }
            const layout: RestructureLayout = args.layout === 'radial' ? 'radial' : 'rows'
            const ropesNow = controlEdgesRef.current.map(ropeLink)
            const ranked = rankUnits(nodesRef.current, ropesNow)
            const next = restructureNodes(nodesRef.current, ropesNow, layout)
            if (next === nodesRef.current) {
              reply({ ok: true, message: 'restructure: fewer than 2 top-level nodes — nothing to lay out', result: { units: ranked.rows.flat().length + ranked.loose.length, rows: 0 } })
              return
            }
            setNodes(next)
            markDirty()
            fitAll()
            const units = ranked.rows.flat().length + ranked.loose.length
            const tiers = layout === 'radial' ? `${Math.max(0, ranked.rows.length - 1)} ring(s)` : `${ranked.rows.length} row(s)`
            reply({ ok: true, message: `restructured ${units} unit(s) in ${tiers}` + (ranked.loose.length ? ` + ${ranked.loose.length} loose` : ''), result: { units, layout, rows: ranked.rows.length, loose: ranked.loose.length } })
            return
          }
```

Import `rankUnits` too. `restructure` is NOT in `STORE_ANSWERED_VERBS` / `COLD_OPENABLE_VERBS` / `OFF_CANVAS_VERBS` (`lib/controlRouting.ts`), so it travels like `arrange` — no change there.

- [ ] **Step 7: Typecheck, full renderer + core + server suites, commit**

Run: `npm run typecheck && npx vitest run src/renderer src/core src/main/canvas-control-core.test.ts src/server`
Expected: clean / PASS.

```bash
git add src/renderer/canvas/Canvas.tsx src/shared/keybindings.ts src/shared/keybindings.test.ts src/renderer/components/ShortcutsPanel.test.tsx src/core/canvas-control-core.ts src/main/canvas-control-core.test.ts src/server/control-unsupported.test.ts
git commit -m "feat(canvas): Restructure canvas replaces Tidy; restructure verb for agents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

### Task 10: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (a new bullet under "Canvas interaction & panels", after the "Tidy canvas" mention in the Context menus bullet)
- Modify: `CONTRIBUTING.md` (one paragraph in the house rules)

- [ ] **Step 1: CLAUDE.md**

Replace the Context-menus bullet's "**Tidy canvas** (`arrangeAllNodes` — packs every top-level node … `project.json`)" clause with:

```
**Restructure canvas** (`arrangeAllNodes` → `lib/restructure.ts` `restructureNodes`, ⌘⇧A, ⌘K,
pane menu, and the agent verb `restructure`): re-lays out every top-level UNIT (node or frame —
a frame moves as one block, its inside untouched) by the rope graph: rank = longest OPENER chain
from a root (a `dep` rope keeps a dependent on its dependency's row, never above); within a row,
deps before dependents, then children under their opener, then current x; rows packed with
`arrangeNodes(row)` CENTERED under the rank-0 row's current center (the orchestrator stays put
and its tree hangs symmetrically beneath it), ROW_GAP apart; loose units (no ropes) as a grid
below. `--layout radial` (verb) / "Restructure canvas (radial)" (palette) puts each generation on
a ring around the root instead — opt-in, never the default. With no ropes the rows layout is a
translation of the old flat Tidy grid, which is why it replaced it behind the same command id
(`canvas.tidy`, title changed only). Idempotent by test. Hidden below 2 units.
```

And add a new top-level bullet right after it:

```
- **New-node placement is ONE engine** (`src/shared/placement/`, pure, imported by the renderer,
  the cold-open path AND the Server Edition's headless factory — it lives in shared for that
  reason). By hand: centered on the cursor, nudged to the nearest clear spot (`placeByHand`; the
  old `emptyNodePos` passed a CENTER to a top-left check and cleared the wrong box). By agent:
  BELOW the opener, fanned right (`placeChild`), or RIGHT of its `--after` deps
  (`placeDependent`) — dependency outranks lineage — with a DIRECTED scan (right, then down; never
  above/left of the anchor). Into a frame: the first grid slot no CURRENT child occupies
  (`placeInFrame`; the old `groupSlot(count)` collided whenever a child had been moved). Callers
  RESERVE each box they place before placing the next. Boxes are root space; ephemeral cards are
  not obstacles. `PLACEMENT_GAP` (40) = `arrangeNodes`'s gap on purpose. The engine never moves an
  existing node — only Restructure does, on an explicit action. `staggeredPosition` (360×320 steps
  keyed on node COUNT for 600×400 nodes) is gone. Ropes carry `kind: 'opener' | 'dep'`
  (`BridgeLink`, sanitized on both load seams; untagged = opener) so the restructure ranker can
  tell the two apart after launch, when `pendingLaunch.after` is gone.
```

- [ ] **Step 2: CONTRIBUTING.md**

Add under the house rules:

```
- **Placing a new node? Call `@shared/placement`, never a local `{x, y}` rule.** Every path that
  creates a node (hand, dock, agent verb, cold open, headless server) goes through the one engine
  in `src/shared/placement/` — the eight independent rules it replaced are how nodes came to spawn
  on top of each other. Reserve what you place (append the box to `existing`) when one call opens
  several nodes. Moving EXISTING nodes is `lib/restructure.ts`'s job and happens only on the
  explicit Restructure action.
```

- [ ] **Step 3: Full verification**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; vitest all green (remote e2e suites skip). Paste the summary line of `npm test` into the PR description.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md CONTRIBUTING.md
git commit -m "docs: placement engine + Restructure canvas invariants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv17s3ACpA4JGc7b24orua"
```

---

## Self-review (done while writing)

- **Spec coverage**: §3 engine → Task 1; §3.3 rules (reserve, root space, ephemeral, frame growth) → Tasks 4–7; §4 rope kind → Task 3; §5 restructure (rows centered + §5.4b radial) → Task 8, wiring/renames/verb + `--layout` → Task 9; §6 consumer table → Tasks 4 (hand, besideNode, emptyNodePos, stagger), 5 (placeBelow, addGrouped, spawn-team), 6 (cold, `--project`), 7 (headless); §7/§8 docs → Task 10; §9 tests → each task's Step 1 plus the source pin in Task 5 and the headless "below" case in Task 7 (the three-consumer parity is enforced by construction: all three call the same function, and the Task 5 pin + Task 7 test lock the two that used to differ).
- **Names used consistently**: `placeByHand/placeChild/placeDependent/placeLoose/placeInFrame/centerOf/Box` (Task 1) are the only placement names used later; `ropeLink`/`ropeEdge(…, kind)` (Task 3) are what Task 9 reads; `liveBoxes`/`newNodeSize` (Task 4) are what Task 5 reads; `coldPlaceBelow(nodes, source, i, reserved, size)` (Task 2) is what Task 6 calls; `restructureNodes`/`rankUnits` (Task 8) are what Task 9 calls.
- **Placeholders**: Task 7 Step 1 asks the implementer to copy fixture setup lines from the neighbouring test in the same file (named by line); the assertions are spelled out. Nothing else defers content.
