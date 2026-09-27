import { describe, expect, it } from 'vitest'
import {
  OVERVIEW_CARD,
  OVERVIEW_LOOSE_ID,
  fitOverviewViewport,
  packOverview,
  type PackItem,
  type PackedRect
} from './overviewPack'

const card = (id: string, parentId?: string): PackItem => ({ id, parentId, isFrame: false })
const frame = (id: string, parentId?: string): PackItem => ({ id, parentId, isFrame: true })

const overlaps = (a: PackedRect, b: PackedRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const contains = (outer: PackedRect, inner: PackedRect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height

/** 60 chats in 8 frames (7 or 8 each), one frame nested in another, 4 loose chats. */
function sixtyInEight(): PackItem[] {
  const items: PackItem[] = []
  for (let f = 0; f < 8; f++) items.push(frame(`f${f}`, f === 7 ? 'f0' : undefined))
  let n = 0
  for (let f = 0; f < 8; f++) for (let k = 0; k < (f < 4 ? 8 : 6); k++) items.push(card(`c${n++}`, `f${f}`))
  while (n < 60) items.push(card(`c${n++}`))
  return items
}

/** Siblings (same container) must never overlap: that is what the eye reads as "one block". */
function assertNoSiblingOverlap(items: PackItem[], rects: Map<string, PackedRect>, parentOf: (id: string) => string) {
  const byParent = new Map<string, string[]>()
  for (const id of rects.keys()) {
    const p = parentOf(id)
    byParent.set(p, [...(byParent.get(p) ?? []), id])
  }
  for (const ids of byParent.values())
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        expect(overlaps(rects.get(ids[i])!, rects.get(ids[j])!), `${ids[i]} vs ${ids[j]}`).toBe(false)
  void items
}

describe('packOverview', () => {
  it('draws every chat as a card of one compact size', () => {
    const { rects } = packOverview([frame('g'), card('a', 'g'), card('b')])
    expect(rects.get('a')).toMatchObject({ width: OVERVIEW_CARD.width, height: OVERVIEW_CARD.height })
    expect(rects.get('b')).toMatchObject({ width: OVERVIEW_CARD.width, height: OVERVIEW_CARD.height })
  })

  it('puts loose chats in their own block, and makes none when there are no loose chats', () => {
    const withLoose = packOverview([frame('g'), card('a', 'g'), card('b'), card('c')])
    expect(withLoose.parentOf.get('b')).toBe(OVERVIEW_LOOSE_ID)
    expect(withLoose.parentOf.get('c')).toBe(OVERVIEW_LOOSE_ID)
    expect(contains(withLoose.rects.get(OVERVIEW_LOOSE_ID)!, withLoose.rects.get('b')!)).toBe(true)
    const none = packOverview([frame('g'), card('a', 'g')])
    expect(none.rects.has(OVERVIEW_LOOSE_ID)).toBe(false)
  })

  it('contains every card in its frame, and a nested frame inside its parent frame', () => {
    const items = sixtyInEight()
    const { rects, parentOf } = packOverview(items)
    for (const it of items) {
      const p = parentOf.get(it.id)
      if (p) expect(contains(rects.get(p)!, rects.get(it.id)!), `${it.id} in ${p}`).toBe(true)
    }
    expect(parentOf.get('f7')).toBe('f0')
    expect(contains(rects.get('f0')!, rects.get('f7')!)).toBe(true)
  })

  it('never overlaps two things in the same container', () => {
    const items = sixtyInEight()
    const { rects, parentOf } = packOverview(items)
    assertNoSiblingOverlap(items, rects, (id) => parentOf.get(id) ?? '')
  })

  it('is deterministic: the same input gives the same layout', () => {
    const a = packOverview(sixtyInEight())
    const b = packOverview(sixtyInEight())
    expect([...a.rects.entries()]).toEqual([...b.rects.entries()])
  })

  it('treats a parent that is missing, not a frame, or part of a cycle as no parent', () => {
    const { parentOf, rects } = packOverview([
      card('a', 'ghost'),
      card('b', 'a'),
      frame('x', 'y'),
      frame('y', 'x'),
      card('c', 'x')
    ])
    expect(parentOf.get('a')).toBe(OVERVIEW_LOOSE_ID)
    expect(parentOf.get('b')).toBe(OVERVIEW_LOOSE_ID)
    // The cycle is broken, not dropped: both frames and their card are still drawn.
    expect(rects.has('x') && rects.has('y') && rects.has('c')).toBe(true)
  })

  it('fits 60 chats in 8 frames into a 16:9 view at a readable card size', () => {
    const { width, height } = packOverview(sixtyInEight(), { aspect: 16 / 9 })
    const vp = fitOverviewViewport({ width, height }, { width: 1600, height: 900 })!
    // 0.75 keeps a 13px title at ~10px on screen: readable. The 1:1 canvas copy was not.
    expect(vp.zoom).toBeGreaterThanOrEqual(0.75)
    // Fills the view: the packed box is not a thin strip that leaves most of it blank.
    const used = (width * vp.zoom * height * vp.zoom) / (1600 * 900)
    expect(used).toBeGreaterThan(0.5)
  })
})

describe('fitOverviewViewport', () => {
  it('centres the bounds and never zooms past 1', () => {
    const vp = fitOverviewViewport({ width: 100, height: 100 }, { width: 1000, height: 500 })!
    expect(vp.zoom).toBe(1)
    expect(vp.x).toBe(450)
    expect(vp.y).toBe(200)
  })

  it('answers null for a pane that has not been measured', () => {
    expect(fitOverviewViewport({ width: 100, height: 100 }, { width: 0, height: 0 })).toBeNull()
  })
})
