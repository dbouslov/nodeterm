import { describe, it, expect } from 'vitest'
import {
  freeSpot, freeSpotDirected, placeByHand, placeChild, placeDependent, placeLoose, placeInFrame, placeOpened,
  groupSlot, centerOf, overlaps, PLACEMENT_GAP, ROW_GAP, GROUP_PAD_X, GROUP_PAD_TOP, GROUP_GAP,
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

describe('placeOpened — the one rule the live, cold and headless open paths all call', () => {
  const opener = box(100, 100, 600, 400)
  it('with no deps is the opener→child rule', () => {
    expect(placeOpened([opener], opener, [], size, 1)).toEqual(placeChild([opener], opener, size, 1))
  })
  it('with deps is the dependent rule — dependency outranks lineage', () => {
    const dep = box(800, 100, 200, 100)
    expect(placeOpened([opener, dep], opener, [dep], size, 1)).toEqual({ x: 800 + 200 + PLACEMENT_GAP, y: 100 })
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
  it('centerOf inverts a top-left', () => {
    expect(centerOf({ x: 0, y: 0 }, size)).toEqual({ x: 50, y: 50 })
  })
})
