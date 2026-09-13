import { describe, it, expect } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { reflow, resizesEnded, settle } from './reflow'

// Only the fields the layout reads: id, type, position, width/height (or `measured`), parentId, pinned.
const node = (id: string, x: number, y: number, w: number, h: number, more: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: 'terminal', position: { x, y }, width: w, height: h, data: { title: id, color: '#fff', group: null }, ...more }) as CanvasNode
const frame = (id: string, x: number, y: number, w: number, h: number, more: Partial<CanvasNode> = {}): CanvasNode =>
  node(id, x, y, w, h, { type: 'group', ...more })
const child = (parentId: string): Partial<CanvasNode> => ({ parentId, extent: 'parent' })
const pin = (n: CanvasNode): CanvasNode => ({ ...n, data: { ...n.data, pinned: true } })

const w = (n: CanvasNode): number => n.measured?.width ?? (n.width as number)
const h = (n: CanvasNode): number => n.measured?.height ?? (n.height as number)
const get = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((n) => n.id === id)!
const pos = (nodes: CanvasNode[], id: string) => get(nodes, id).position
const size = (nodes: CanvasNode[], id: string) => ({ width: w(get(nodes, id)), height: h(get(nodes, id)) })

/** Resize `id` to width × height with its top-left fixed, as the resizer's bottom-right handle
 *  leaves it (React Flow writes `measured` too, when the node has one). */
function resize(nodes: CanvasNode[], id: string, width: number, height: number) {
  const was = get(nodes, id)
  const prevRect = { x: was.position.x, y: was.position.y, width: w(was), height: h(was) }
  const next = nodes.map((n) =>
    n.id === id ? { ...n, width, height, ...(n.measured ? { measured: { width, height } } : {}) } : n
  )
  return { nodes: next, prevRect }
}

/** Every pair of siblings (same container) whose boxes overlap. */
function overlaps(nodes: CanvasNode[]): string[] {
  const out: string[] = []
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.id >= b.id || (a.parentId ?? null) !== (b.parentId ?? null)) continue
      const ax = a.position.x
      const ay = a.position.y
      const bx = b.position.x
      const by = b.position.y
      if (ax < bx + w(b) && bx < ax + w(a) && ay < by + h(b) && by < ay + h(a)) out.push(`${a.id}×${b.id}`)
    }
  }
  return out
}

/** Pairs where one sibling passed another it shares a column (or row) with: `q` was wholly below
 *  (right of) `p` and `p` is now wholly below (right of) `q`. The changed node itself is exempt. */
function passed(before: CanvasNode[], after: CanvasNode[], changedId: string): string[] {
  const out: string[] = []
  for (const p of before) {
    for (const q of before) {
      if (p.id === q.id || p.id === changedId || q.id === changedId) continue
      if ((p.parentId ?? null) !== (q.parentId ?? null)) continue
      const p2 = get(after, p.id)
      const q2 = get(after, q.id)
      const sameColumn = p.position.x < q.position.x + w(q) && q.position.x < p.position.x + w(p)
      const sameRow = p.position.y < q.position.y + h(q) && q.position.y < p.position.y + h(p)
      if (sameColumn && q.position.y >= p.position.y + h(p) && p2.position.y >= q2.position.y + h(q2)) out.push(`${p.id}↓${q.id}`)
      if (sameRow && q.position.x >= p.position.x + w(p) && p2.position.x >= q2.position.x + w(q2)) out.push(`${p.id}→${q.id}`)
    }
  }
  return out
}

describe('reflow: growth', () => {
  it('a node that grows taller moves the siblings below it, in its column, by the growth', () => {
    // c and e stack under a with 40 gaps; x sits below too, but outside a's column.
    const start = [
      node('a', 0, 0, 400, 300),
      node('c', 0, 340, 400, 300),
      node('e', 0, 680, 400, 300),
      node('x', 440, 340, 300, 300)
    ]
    const { nodes, prevRect } = resize(start, 'a', 400, 500)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'a')).toEqual({ x: 0, y: 0 })
    expect(pos(out, 'c')).toEqual({ x: 0, y: 540 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 880 })
    expect(pos(out, 'x')).toEqual({ x: 440, y: 340 })
    expect(overlaps(out)).toEqual([])
  })

  it('a node that grows wider moves the siblings to its right, in its row, by the growth', () => {
    // b and d sit right of a; y sits right too, but below a's row.
    const start = [
      node('a', 0, 0, 400, 300),
      node('b', 440, 0, 300, 300),
      node('d', 780, 0, 300, 300),
      node('y', 440, 340, 300, 300)
    ]
    const { nodes, prevRect } = resize(start, 'a', 600, 300)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'b')).toEqual({ x: 640, y: 0 })
    expect(pos(out, 'd')).toEqual({ x: 980, y: 0 })
    expect(pos(out, 'y')).toEqual({ x: 440, y: 340 })
    expect(overlaps(out)).toEqual([])
  })

  it('growth cascades: a pushed sibling pushes what it runs into, until nothing overlaps', () => {
    // c is wider than a, so s (under c's right end) is outside a's column: only c's move reaches it,
    // and only s's move reaches t. Each push keeps the 40 gap the pair had.
    const start = [
      node('a', 0, 0, 400, 300),
      node('c', 0, 340, 700, 300),
      node('s', 500, 680, 200, 100),
      node('t', 500, 820, 200, 100)
    ]
    const { nodes, prevRect } = resize(start, 'a', 400, 500)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'c')).toEqual({ x: 0, y: 540 })
    expect(pos(out, 's')).toEqual({ x: 500, y: 880 })
    expect(pos(out, 't')).toEqual({ x: 500, y: 1020 })
    expect(overlaps(out)).toEqual([])
  })

  it('a neighbour off its corner is pushed the shorter way', () => {
    // d was below AND right of a. Growing 200 wider and 100 taller runs a into it: down needs 100,
    // right needs 200.
    const start = [node('a', 0, 0, 400, 300), node('d', 440, 340, 300, 300)]
    const { nodes, prevRect } = resize(start, 'a', 600, 400)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'd')).toEqual({ x: 440, y: 440 })
    expect(overlaps(out)).toEqual([])
  })

  it('a node that grows upward pushes the sibling above it up, and nothing below it moves', () => {
    // The top handle: a's top rises 100, its bottom stays. c lay above a, overlapping its column by
    // only 20: it goes up (100), the way it lay, though sideways would be shorter (60).
    const start = [node('c', 380, 0, 200, 300), node('a', 0, 340, 400, 300), node('e', 0, 680, 400, 300)]
    const nodes = start.map((n) => (n.id === 'a' ? { ...n, position: { x: 0, y: 240 }, height: 400 } : n))
    const out = reflow(nodes, 'a', { x: 0, y: 340, width: 400, height: 300 })
    expect(pos(out, 'c')).toEqual({ x: 380, y: -100 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 680 })
    expect(overlaps(out)).toEqual([])
  })
})

describe('reflow: shrink', () => {
  it('pulls the column below back by the freed space, keeping its gaps', () => {
    const start = [node('a', 0, 0, 400, 400), node('c', 0, 440, 400, 300), node('e', 0, 780, 400, 300)]
    const { nodes, prevRect } = resize(start, 'a', 400, 300)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'c')).toEqual({ x: 0, y: 340 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 680 })
  })

  it('never pulls a sibling further than the freed space, nor into another node', () => {
    // x sits right of a (outside its column) but over c's right end, 80 above c. e is 400 below c.
    // A 100 shrink: c may rise only until it is 40 under x; e rises the full 100 and no further,
    // though its own gap could have closed by 360.
    const start = [
      node('a', 0, 0, 400, 400),
      node('x', 500, 260, 200, 100),
      node('c', 0, 440, 700, 300),
      node('e', 0, 1140, 400, 300)
    ]
    const { nodes, prevRect } = resize(start, 'a', 400, 300)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'x')).toEqual({ x: 500, y: 260 })
    expect(pos(out, 'c')).toEqual({ x: 0, y: 400 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 1040 })
    expect(overlaps(out)).toEqual([])
  })
})

describe('reflow: pins and order', () => {
  it('never moves a pinned node or a pinned frame; the rest of the band still moves', () => {
    const start = [
      node('a', 0, 0, 400, 300),
      pin(node('p', 0, 540, 400, 100)), // in a's column, 240 below it
      node('e', 0, 680, 400, 100), // below p, still in a's column
      pin(frame('pg', 540, 0, 300, 300)), // in a's row
      node('pk', 28, 62, 200, 100, child('pg')),
      node('q', 880, 0, 200, 200) // in a's row, past the pinned frame
    ]
    const { nodes, prevRect } = resize(start, 'a', 500, 400)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'p')).toEqual({ x: 0, y: 540 })
    expect(pos(out, 'pg')).toEqual({ x: 540, y: 0 })
    expect(pos(out, 'pk')).toEqual({ x: 28, y: 62 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 780 })
    expect(pos(out, 'q')).toEqual({ x: 980, y: 0 })
    expect(overlaps(out)).toEqual([])
  })

  it('a sibling pushed into a pinned node goes past it, never into it', () => {
    // c must drop 200 to clear a, which lands it on p: it goes on past p, 40 clear.
    const start = [node('a', 0, 0, 400, 300), node('c', 0, 340, 400, 300), pin(node('p', 0, 700, 400, 100))]
    const { nodes, prevRect } = resize(start, 'a', 400, 500)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'p')).toEqual({ x: 0, y: 700 })
    expect(pos(out, 'c')).toEqual({ x: 0, y: 840 })
    expect(overlaps(out)).toEqual([])
  })

  it('a sibling never passes another in its column, however far the push carries the one above', () => {
    // s sits between c and e, under c's right end only (outside a's column). A 1000 growth carries c
    // far past s's old spot: s must travel ahead of c, not stay behind above it.
    const start = [
      node('a', 0, 0, 400, 300),
      node('c', 0, 340, 700, 300),
      node('s', 500, 680, 200, 100),
      node('e', 0, 1000, 400, 300)
    ]
    const { nodes, prevRect } = resize(start, 'a', 400, 1300)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'c')).toEqual({ x: 0, y: 1340 })
    expect(pos(out, 's')).toEqual({ x: 500, y: 1680 })
    expect(pos(out, 'e')).toEqual({ x: 0, y: 2000 })
    expect(passed(start, out, 'a')).toEqual([])
    expect(overlaps(out)).toEqual([])
  })
})

describe('reflow: frames', () => {
  // A frame hugs with 28 padding and a 34 header (workspace's GROUP_PAD / GROUP_HEADER): a child at
  // (28, 62), and the frame is (children's extent + 56) wide, (children's extent + 90) tall.
  it('the parent frame hugs its children once they have moved', () => {
    const start = [
      frame('g', 0, 0, 456, 730),
      node('a', 28, 62, 400, 300, child('g')),
      node('c', 28, 402, 400, 300, child('g'))
    ]
    const { nodes, prevRect } = resize(start, 'a', 400, 500)
    const out = reflow(nodes, 'a', prevRect)
    expect(pos(out, 'c')).toEqual({ x: 28, y: 602 })
    expect(pos(out, 'g')).toEqual({ x: 0, y: 0 })
    expect(size(out, 'g')).toEqual({ width: 456, height: 930 })
  })

  // g2 holds g1 (which holds a) and y below it; z is under g2 and w right of it, at the top level.
  const nested = () => [
    frame('g2', 0, 0, 512, 720),
    frame('g1', 28, 62, 456, 390, child('g2')),
    node('a', 28, 62, 400, 300, child('g1')),
    node('y', 28, 492, 456, 200, child('g2')),
    node('z', 0, 760, 512, 200),
    node('w', 552, 0, 300, 300)
  ]
  const expectNestedFollowed = (out: CanvasNode[]) => {
    expect(size(out, 'g1')).toEqual({ width: 456, height: 590 })
    expect(pos(out, 'y')).toEqual({ x: 28, y: 692 })
    expect(size(out, 'g2')).toEqual({ width: 512, height: 920 })
    expect(pos(out, 'z')).toEqual({ x: 0, y: 960 })
    expect(pos(out, 'w')).toEqual({ x: 552, y: 0 })
    expect(overlaps(out)).toEqual([])
  }

  it('each frame that changed moves its own neighbours, then its parent hugs, up to the top level', () => {
    const { nodes, prevRect } = resize(nested(), 'a', 400, 500)
    expectNestedFollowed(reflow(nodes, 'a', prevRect))
  })

  it('nested frames that React Flow measured at their old size are fitted and moved at their new one', () => {
    // React Flow stamps `measured` on every node it has drawn, and the layout reads it first;
    // fitting a frame writes its new width/height but not its `measured`.
    const measured = nested().map((n) => ({ ...n, measured: { width: n.width as number, height: n.height as number } }))
    const { nodes, prevRect } = resize(measured, 'a', 400, 500)
    expectNestedFollowed(reflow(nodes, 'a', prevRect))
  })

  it('a frame whose rectangle did not change moves nothing around it', () => {
    // wd is the frame's widest child, so a growing 200 wider leaves the frame as it was.
    const start = [
      frame('g', 0, 0, 856, 730),
      node('a', 28, 62, 400, 300, child('g')),
      node('wd', 28, 402, 800, 300, child('g')),
      node('r', 896, 0, 200, 200)
    ]
    const { nodes, prevRect } = resize(start, 'a', 600, 300)
    const out = reflow(nodes, 'a', prevRect)
    expect(size(out, 'g')).toEqual({ width: 856, height: 730 })
    expect(pos(out, 'r')).toEqual({ x: 896, y: 0 })
  })
})

describe('settle: a node dropped by hand, or added to a frame', () => {
  it('moves the siblings it now overlaps out of its way, the shortest way, and the frame hugs', () => {
    // a was dropped 50 into b's top. Down needs 90 (362 + 40 − 312), right 340, left 540, up 590.
    // d overlaps nothing and stays, hole and all.
    const start = [
      frame('g', 0, 0, 556, 1000),
      node('a', 28, 62, 400, 300, child('g')),
      node('b', 128, 312, 400, 300, child('g')),
      node('d', 28, 800, 200, 100, child('g'))
    ]
    const out = settle(start, 'a')
    expect(pos(out, 'a')).toEqual({ x: 28, y: 62 })
    expect(pos(out, 'b')).toEqual({ x: 128, y: 402 })
    expect(pos(out, 'd')).toEqual({ x: 28, y: 800 })
    expect(size(out, 'g')).toEqual({ width: 556, height: 928 })
  })
})

describe('resizesEnded', () => {
  const dims = (id: string, resizing: boolean | undefined, width: number, height: number) =>
    ({ type: 'dimensions', id, dimensions: { width, height }, ...(resizing === undefined ? {} : { resizing }) }) as NodeChange<CanvasNode>

  it('hands back the rect a node had when the resizer took it, once the resize ends', () => {
    const started = new Map()
    expect(resizesEnded([dims('a', true, 420, 300)], [node('a', 10, 20, 400, 300)], started)).toEqual([])
    expect(resizesEnded([dims('a', true, 460, 300)], [node('a', 10, 20, 420, 300)], started)).toEqual([])
    expect(resizesEnded([dims('a', false, 460, 300)], [node('a', 10, 20, 460, 300)], started)).toEqual([
      { id: 'a', prevRect: { x: 10, y: 20, width: 400, height: 300 } }
    ])
    // Consumed, so the node's next resize starts from its own first rect.
    expect(started.size).toBe(0)
  })

  it('ignores a measurement (no `resizing`), and an end it never saw start', () => {
    const started = new Map()
    expect(resizesEnded([dims('a', undefined, 500, 300)], [node('a', 0, 0, 400, 300)], started)).toEqual([])
    expect(resizesEnded([dims('a', false, 500, 300)], [node('a', 0, 0, 400, 300)], started)).toEqual([])
  })
})
