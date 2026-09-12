import { describe, it, expect } from 'vitest'
import { livePlaceOpened, openedFrameId, withOpenedNode } from './livePlacement'
import { absolutePosition, type FocusableNode } from './nodeFocus'
import type { CanvasNode } from '../state/workspace'

const node = (
  id: string,
  x: number,
  y: number,
  w = 600,
  h = 400,
  parentId?: string,
  type: 'terminal' | 'group' = 'terminal'
): CanvasNode =>
  ({
    id,
    type,
    position: { x, y },
    width: w,
    height: h,
    ...(parentId ? { parentId, extent: 'parent' } : {}),
    data: { title: id, color: '#fff', group: null }
  }) as CanvasNode
const frame = (id: string, x: number, y: number, w: number, h: number, parentId?: string): CanvasNode =>
  node(id, x, y, w, h, parentId, 'group')
const SIZE = { w: 600, h: 400 }
const get = (all: CanvasNode[], id: string): CanvasNode => all.find((n) => n.id === id)!
const rootOf = (all: CanvasNode[], id: string) =>
  absolutePosition(get(all, id) as FocusableNode, all as FocusableNode[])

describe('livePlaceOpened — what the control dispatch’s placeNext lands on', () => {
  // A 1400×1200 frame with its source near the top-left corner: the slot below the source
  // (ROW_GAP 80 under its bottom edge) is INSIDE the frame's box.
  const g = frame('g', 1000, 1000, 1400, 1200)
  const src = node('src', 24, 56, 600, 400, 'g') // root (1024, 1056)

  it('the source’s own frame is not an obstacle: the child goes straight below the source', () => {
    expect(livePlaceOpened([g, src], src, [], SIZE, 0)).toEqual({ x: 1024, y: 1056 + 400 + 80 })
  })

  it('the frame’s OTHER children still are', () => {
    const sib = node('sib', 24, 536, 600, 400, 'g') // root (1024, 1536): on the first slot
    expect(livePlaceOpened([g, src, sib], src, [], SIZE, 0)).toEqual({ x: 1024 + 600 + 40, y: 1536 })
  })

  it('every frame up the chain is skipped, not only the innermost', () => {
    const outer = frame('outer', 0, 0, 3000, 3000)
    const inner = frame('inner', 1000, 1000, 1400, 1200, 'outer')
    const s = node('s', 24, 56, 600, 400, 'inner')
    expect(livePlaceOpened([outer, inner, s], s, [], SIZE, 0)).toEqual({ x: 1024, y: 1536 })
  })

  it('terminates on a frame cycle (only a hand-edited file can make one)', () => {
    const a = frame('a', 0, 0, 100, 100, 'b')
    const b = frame('b', 0, 0, 100, 100, 'a')
    const s = node('s', 0, 0, 600, 400, 'a')
    expect(livePlaceOpened([a, b, s], s, [], SIZE, 0)).toEqual({ x: 0, y: 480 })
  })

  it('leaves out what it is told to skip (ephemeral cards) and clears what this call reserved', () => {
    const card = node('card', 1024, 1536)
    expect(livePlaceOpened([g, src, card], src, [], SIZE, 0, { skip: new Set(['card']) })).toEqual({
      x: 1024,
      y: 1536
    })
    expect(livePlaceOpened([g, src], src, [], SIZE, 0, { reserved: [{ x: 1024, y: 1536, ...SIZE }] })).toEqual({
      x: 1664,
      y: 1536
    })
  })

  it('an --after dependent goes right of its dep; waiting on the source itself stays below it', () => {
    const dep = node('dep', 3000, 1000)
    expect(livePlaceOpened([g, src, dep], src, ['dep'], SIZE, 0)).toEqual({ x: 3000 + 600 + 40, y: 1000 })
    expect(livePlaceOpened([g, src, dep], src, ['src'], SIZE, 0)).toEqual({ x: 1024, y: 1536 })
  })

  it('an --after dependent of a framed source stays top-level beside its dep, so the frame IS an obstacle', () => {
    // dep just left of the frame: the slot right of it (940, 1100) runs into the frame, which a
    // top-level node must clear — three cells right, past the frame's edge.
    const left = node('left', 300, 1100)
    expect(livePlaceOpened([g, src, left], src, ['left'], SIZE, 0)).toEqual({ x: 940 + 3 * 640, y: 1100 })
  })
})

describe('openedFrameId — only a lineage child joins its source’s frame', () => {
  const g = frame('g', 1000, 1000, 1400, 1200)
  const src = node('src', 24, 56, 600, 400, 'g')
  const dep = node('dep', 300, 1100)

  it('a lineage child (no --after, or waiting on the source itself) joins the innermost frame', () => {
    expect(openedFrameId([g, src, dep], src, [])).toBe('g')
    expect(openedFrameId([g, src, dep], src, ['src'])).toBe('g')
  })

  it('a node placed beside an --after dep does not: it stays top-level next to its dep', () => {
    expect(openedFrameId([g, src, dep], src, ['dep'])).toBeUndefined()
  })

  it('a top-level source files nothing', () => {
    const top = node('top', 0, 0)
    expect(openedFrameId([top], top, [])).toBeUndefined()
  })
})

describe('withOpenedNode — how an opened node joins the live canvas', () => {
  // A frame hugging its source (GROUP_PAD 28, header 34): the slot below the source is past the
  // frame's bottom edge, where `extent: 'parent'` would clamp the child back onto the source.
  const g = frame('g', 1000, 1000, 656, 490)
  const src = node('src', 28, 62, 600, 400, 'g') // root (1028, 1062)
  const kid = node('kid', 1028, 1062 + 400 + 80) // as placed: ROOT space

  const contains = (outer: CanvasNode, inner: CanvasNode): boolean =>
    inner.position.x >= 0 &&
    inner.position.y >= 0 &&
    inner.position.x + (inner.width as number) <= (outer.width as number) &&
    inner.position.y + (inner.height as number) <= (outer.height as number)

  it('files a framed source’s child into the frame at its placed root position, and grows the frame to hold it', () => {
    const out = withOpenedNode([g, src], kid, 'g')
    expect(get(out, 'kid').parentId).toBe('g')
    expect(rootOf(out, 'kid')).toEqual({ x: 1028, y: 1542 })
    expect(contains(get(out, 'g'), get(out, 'kid'))).toBe(true)
    expect(contains(get(out, 'g'), get(out, 'src'))).toBe(true)
  })

  it('grows every frame up the chain', () => {
    const outer = frame('outer', 900, 900, 800, 620)
    const inner = frame('inner', 100, 100, 656, 490, 'outer')
    const s = node('src', 28, 62, 600, 400, 'inner') // root (1028, 1062)
    const out = withOpenedNode([outer, inner, s], kid, 'inner')
    expect(rootOf(out, 'kid')).toEqual({ x: 1028, y: 1542 })
    expect(contains(get(out, 'inner'), get(out, 'kid'))).toBe(true)
    expect(contains(get(out, 'outer'), get(out, 'inner'))).toBe(true)
  })

  it('keeps a second sibling where it was placed when the first one’s fit moved the frame', () => {
    // Slack above and left of the source: the first fit re-anchors the frame onto its children,
    // so a sibling converted against the frame's OLD origin would land 100px off.
    const slack = frame('g', 900, 900, 900, 700)
    const s = node('src', 128, 162, 600, 400, 'g') // root (1028, 1062)
    const a = node('a', 1028, 1542)
    const b = node('b', 1668, 1542)
    const out = withOpenedNode(withOpenedNode([slack, s], a, 'g'), b, 'g')
    expect(rootOf(out, 'a')).toEqual({ x: 1028, y: 1542 })
    expect(rootOf(out, 'b')).toEqual({ x: 1668, y: 1542 })
    expect(contains(get(out, 'g'), get(out, 'b'))).toBe(true)
  })

  it('appends a top-level source’s child, and a --group child (already frame-relative), untouched', () => {
    const plain = node('p', 5, 5)
    expect(withOpenedNode([g, src], plain, undefined)).toEqual([g, src, plain])
    const grouped = node('q', 28, 500, 600, 400, 'g')
    expect(withOpenedNode([g, src], grouped, 'g')).toEqual([g, src, grouped])
  })
})
