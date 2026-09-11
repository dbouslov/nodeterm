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

/**
 * A node an agent OPENS: right of its `--after` deps when any are on this canvas (dependency
 * outranks lineage), else below its opener as sibling `index`. The one rule the live dispatch, the
 * cold open and the headless factory all call, so the three cannot drift into three layouts again.
 */
export function placeOpened(
  existing: readonly Box[],
  opener: Box,
  deps: readonly Box[],
  size: Size,
  index: number
): Point {
  return deps.length ? placeDependent(existing, deps, size) : placeChild(existing, opener, size, index)
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
