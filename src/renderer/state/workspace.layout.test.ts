import { describe, it, expect } from 'vitest'
import { arrangeNodes, alignNodes, fitGroupToChildren, isPinned, type CanvasNode } from './workspace'

// Minimal node stub: only the fields the layout fns read (id, position, width/height, parentId).
const n = (id: string, x: number, y: number, w = 100, h = 50): CanvasNode =>
  ({ id, type: 'terminal', position: { x, y }, width: w, height: h, data: { title: id, color: '#fff', group: null } }) as CanvasNode

describe('arrangeNodes', () => {
  it('lays out a row left-to-right from the bounding-box origin with the gap', () => {
    const out = arrangeNodes([n('a', 50, 90), n('b', 10, 200)], ['a', 'b'], { layout: 'row', gap: 20 })
    const a = out.find((x) => x.id === 'a')!
    const b = out.find((x) => x.id === 'b')!
    // origin = bounding-box top-left of current positions = (10, 90)
    expect(a.position).toEqual({ x: 10, y: 90 })
    expect(b.position).toEqual({ x: 10 + 100 + 20, y: 90 })
  })

  it('lays out a column top-to-bottom', () => {
    const out = arrangeNodes([n('a', 0, 0), n('b', 300, 300)], ['a', 'b'], { layout: 'column', gap: 10 })
    expect(out.find((x) => x.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(out.find((x) => x.id === 'b')!.position).toEqual({ x: 0, y: 50 + 10 })
  })

  it('grid wraps at cols and rows advance by the tallest node in the row', () => {
    const out = arrangeNodes(
      [n('a', 0, 0, 100, 50), n('b', 0, 0, 100, 80), n('c', 0, 0, 100, 50)],
      ['a', 'b', 'c'],
      { layout: 'grid', cols: 2, gap: 10, origin: { x: 0, y: 0 } }
    )
    expect(out.find((x) => x.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(out.find((x) => x.id === 'b')!.position).toEqual({ x: 110, y: 0 })
    // row 2 starts below the tallest of row 1 (80) + gap
    expect(out.find((x) => x.id === 'c')!.position).toEqual({ x: 0, y: 90 })
  })

  it('refuses a set mixing containers, and no-ops an empty/ghost selection', () => {
    // A top-level node + a group child cannot be co-arranged (their coordinate spaces differ),
    // so a MIXED set is a deliberate no-op — NOT "silently arrange the top-level ones" (that
    // silent subset-arrange was the surprise this replaced). Same for unknown ids.
    const child = { ...n('kid', 5, 5), parentId: 'g1' } as CanvasNode
    const nodes = [n('a', 7, 7), child]
    expect(arrangeNodes(nodes, ['a', 'kid', 'ghost'], { layout: 'row', origin: { x: 0, y: 0 } })).toBe(nodes)
    expect(arrangeNodes(nodes, ['ghost'])).toBe(nodes) // nothing resolvable → same array
    // Same-container sets still arrange: two children of one frame lay out in frame space.
    const framed = [
      { ...n('c1', 40, 40), parentId: 'g1' } as CanvasNode,
      { ...n('c2', 300, 5), parentId: 'g1' } as CanvasNode
    ]
    const laid = arrangeNodes(framed, ['c1', 'c2'], { layout: 'row', gap: 20 })
    expect(laid.find((x) => x.id === 'c1')!.position).toEqual({ x: 40, y: 5 })
    expect(laid.find((x) => x.id === 'c2')!.position).toEqual({ x: 40 + 100 + 20, y: 5 })
  })
})

describe('arrangeNodes order', () => {
  // Node ARRAY order is a, b, c; the callers below name them in a different order.
  const three = (): CanvasNode[] => [n('a', 0, 0), n('b', 400, 0), n('c', 800, 0)]
  const at = (out: CanvasNode[], id: string) => out.find((x) => x.id === id)!.position

  it("order: 'given' lays a row out left to right in exactly the order of the ids", () => {
    const out = arrangeNodes(three(), ['c', 'a', 'b'], { layout: 'row', gap: 20, order: 'given' })
    expect(at(out, 'c')).toEqual({ x: 0, y: 0 })
    expect(at(out, 'a')).toEqual({ x: 120, y: 0 })
    expect(at(out, 'b')).toEqual({ x: 240, y: 0 })
  })

  it("order: 'given' lays a column out top to bottom in the order of the ids", () => {
    const out = arrangeNodes(three(), ['b', 'c', 'a'], { layout: 'column', gap: 10, order: 'given' })
    expect(at(out, 'b')).toEqual({ x: 0, y: 0 })
    expect(at(out, 'c')).toEqual({ x: 0, y: 60 })
    expect(at(out, 'a')).toEqual({ x: 0, y: 120 })
  })

  it("order: 'given' fills a grid row by row in the order of the ids", () => {
    const out = arrangeNodes([...three(), n('d', 1200, 0)], ['d', 'c', 'b', 'a'], {
      layout: 'grid',
      cols: 2,
      gap: 10,
      order: 'given'
    })
    expect(at(out, 'd')).toEqual({ x: 0, y: 0 })
    expect(at(out, 'c')).toEqual({ x: 110, y: 0 })
    expect(at(out, 'b')).toEqual({ x: 0, y: 60 })
    expect(at(out, 'a')).toEqual({ x: 110, y: 60 })
  })

  it("David's case: `arrange --nodes <GO chat>,<Needs David> --layout row` puts the GO chat directly left of the note", () => {
    // The note was created first, so it comes first in the node array.
    const note = { ...n('needs-david', 900, 300, 240, 200), type: 'sticky' } as CanvasNode
    const go = n('go-chat', 100, 40, 600, 400)
    const out = arrangeNodes([note, go], ['go-chat', 'needs-david'], { layout: 'row', order: 'given' })
    // origin = the pair's bounding-box top-left (100, 40); default gap 40
    expect(at(out, 'go-chat')).toEqual({ x: 100, y: 40 })
    expect(at(out, 'needs-david')).toEqual({ x: 100 + 600 + 40, y: 40 })
  })

  it("order: 'given' skips pinned and unknown ids, and a repeated id keeps its first place", () => {
    const pinned = { ...n('p', 5000, 5000), data: { title: 'p', color: '#fff', group: null, pinned: true } } as CanvasNode
    const out = arrangeNodes([...three(), pinned], ['b', 'ghost', 'p', 'a', 'b'], {
      layout: 'row',
      gap: 20,
      order: 'given',
      origin: { x: 0, y: 0 }
    })
    expect(at(out, 'b')).toEqual({ x: 0, y: 0 })
    expect(at(out, 'a')).toEqual({ x: 120, y: 0 })
    expect(at(out, 'p')).toEqual({ x: 5000, y: 5000 })
    expect(at(out, 'c')).toEqual({ x: 800, y: 0 }) // not named: untouched
  })

  it('without `order`, members keep NODE-ARRAY order: restructure, spawn-team and verify rely on it', () => {
    const out = arrangeNodes(three(), ['c', 'a', 'b'], { layout: 'row', gap: 20 })
    expect(at(out, 'a')).toEqual({ x: 0, y: 0 })
    expect(at(out, 'b')).toEqual({ x: 120, y: 0 })
    expect(at(out, 'c')).toEqual({ x: 240, y: 0 })
  })
})

describe('alignNodes', () => {
  const pair = () => [n('a', 10, 20, 100, 50), n('b', 200, 300, 60, 80)]
  it('left aligns x to the min x', () => {
    const out = alignNodes(pair(), ['a', 'b'], 'left')
    expect(out.map((x) => x.position.x)).toEqual([10, 10])
  })
  it('right aligns right edges to the max right edge', () => {
    const out = alignNodes(pair(), ['a', 'b'], 'right')
    // max right = 200+60=260 → a.x=260-100=160, b.x=200
    expect(out.find((x) => x.id === 'a')!.position.x).toBe(160)
    expect(out.find((x) => x.id === 'b')!.position.x).toBe(200)
  })
  it('vcenter aligns vertical centers; hcenter aligns horizontal centers', () => {
    const v = alignNodes(pair(), ['a', 'b'], 'vcenter')
    // bbox y: 20..380 → center 200 → a.y=200-25=175, b.y=200-40=160
    expect(v.find((x) => x.id === 'a')!.position.y).toBe(175)
    expect(v.find((x) => x.id === 'b')!.position.y).toBe(160)
    const h = alignNodes(pair(), ['a', 'b'], 'hcenter')
    // bbox x: 10..260 → center 135 → a.x=85, b.x=105
    expect(h.find((x) => x.id === 'a')!.position.x).toBe(85)
    expect(h.find((x) => x.id === 'b')!.position.x).toBe(105)
  })
  it('unknown ids only → same array', () => {
    const nodes = pair()
    expect(alignNodes(nodes, ['ghost'], 'left')).toBe(nodes)
  })
})

describe('pinned nodes stay put under automatic layout', () => {
  const pin = (node: CanvasNode): CanvasNode => ({ ...node, data: { ...node.data, pinned: true } }) as CanvasNode
  const frame = (id: string, x: number, y: number, w: number, h: number): CanvasNode =>
    ({ ...n(id, x, y, w, h), type: 'group' }) as CanvasNode
  const child = (id: string, x: number, y: number, parentId: string, w = 100, h = 50): CanvasNode =>
    ({ ...n(id, x, y, w, h), parentId }) as CanvasNode

  it('isPinned is inherited from an ancestor frame', () => {
    const all = [pin(frame('g', 0, 0, 400, 300)), child('kid', 10, 10, 'g'), n('loose', 500, 0)]
    expect(isPinned(all[0], all)).toBe(true)
    expect(isPinned(all[1], all)).toBe(true)
    expect(isPinned(all[2], all)).toBe(false)
  })

  it('arrangeNodes lays out the rest and leaves a pinned member where it is', () => {
    const nodes = [n('a', 0, 0), pin(n('p', 900, 900)), n('b', 500, 0)]
    const out = arrangeNodes(nodes, ['a', 'p', 'b'], { layout: 'row', gap: 20, origin: { x: 0, y: 0 } })
    expect(out.find((x) => x.id === 'p')!.position).toEqual({ x: 900, y: 900 })
    expect(out.find((x) => x.id === 'a')!.position).toEqual({ x: 0, y: 0 })
    expect(out.find((x) => x.id === 'b')!.position).toEqual({ x: 120, y: 0 })
  })

  it('arrangeNodes over pinned members only is a no-op (same array)', () => {
    const nodes = [pin(n('p', 5, 5)), pin(n('q', 50, 50))]
    expect(arrangeNodes(nodes, ['p', 'q'])).toBe(nodes)
  })

  it('alignNodes aligns the rest TO a pinned member and never moves it', () => {
    const nodes = [pin(n('p', 5, 300)), n('a', 100, 20)]
    const out = alignNodes(nodes, ['p', 'a'], 'left')
    expect(out.find((x) => x.id === 'p')!.position).toEqual({ x: 5, y: 300 })
    expect(out.find((x) => x.id === 'a')!.position).toEqual({ x: 5, y: 20 })
    // 'right': the bbox's right edge is a's (200); an unpinned p would be moved to x 100.
    const right = alignNodes(nodes, ['p', 'a'], 'right')
    expect(right.find((x) => x.id === 'p')!.position).toEqual({ x: 5, y: 300 })
  })

  it('fitGroupToChildren grows a pinned frame in place — never re-anchors or shrinks it', () => {
    const grown = fitGroupToChildren([pin(frame('g', 100, 100, 200, 150)), child('kid', 300, 200, 'g')], 'g')
    const g = grown.find((x) => x.id === 'g')!
    expect(g.position).toEqual({ x: 100, y: 100 })
    expect(grown.find((x) => x.id === 'kid')!.position).toEqual({ x: 300, y: 200 })
    expect(g.width as number).toBeGreaterThanOrEqual(300 + 100)
    expect(g.height as number).toBeGreaterThanOrEqual(200 + 50)
    const kept = fitGroupToChildren([pin(frame('g', 100, 100, 2000, 2000)), child('kid', 30, 60, 'g')], 'g')
    expect(kept.find((x) => x.id === 'g')!.position).toEqual({ x: 100, y: 100 })
    expect(kept.find((x) => x.id === 'g')!.width).toBe(2000)
    expect(kept.find((x) => x.id === 'g')!.height).toBe(2000)
  })
})
