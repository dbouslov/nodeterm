import { describe, it, expect } from 'vitest'
import { rootPosition, type CanvasNode } from '../state/workspace'
import { applyCompaction, compactNote, compactRequested, planCompaction, readingRows } from './closeCompact'

// Minimal node stub: only the fields the layout fns read. Frames use the geometry
// `fitGroupToChildren` produces with snapping off (pad 28, header 34), so a fixture frame already
// hugs its children and any change below is the compaction's doing.
const n = (id: string, x: number, y: number, parentId?: string, w = 100, h = 50): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: { x, y },
    width: w,
    height: h,
    ...(parentId ? { parentId, extent: 'parent' } : {}),
    data: { title: id, color: '#fff', group: null }
  }) as CanvasNode
const frame = (id: string, x: number, y: number, w: number, h: number, parentId?: string): CanvasNode =>
  ({ ...n(id, x, y, parentId, w, h), type: 'group' }) as CanvasNode
const pin = (node: CanvasNode): CanvasNode => ({ ...node, data: { ...node.data, pinned: true } }) as CanvasNode
/** As React Flow has them on the live canvas: `measured` set, and preferred by `nodeW`/`nodeH`. */
const measured = (nodes: CanvasNode[]): CanvasNode[] =>
  nodes.map((x) => ({ ...x, measured: { width: x.width as number, height: x.height as number } }))
const at = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((x) => x.id === id)!
const box = (node: CanvasNode) => ({ ...node.position, width: node.width, height: node.height })

/** Canvas `deleteNodes`' setNodes transform: drop the ids, and free a deleted frame's children by
 *  adding the frame's position — the array `applyCompaction` receives on the live canvas. */
function removeLikeDeleteNodes(nodes: CanvasNode[], ids: string[]): CanvasNode[] {
  const set = new Set(ids)
  const groupPos = new Map(nodes.filter((x) => set.has(x.id) && x.type === 'group').map((g) => [g.id, g.position]))
  return nodes
    .filter((x) => !set.has(x.id))
    .map((x) =>
      x.parentId && groupPos.has(x.parentId)
        ? {
            ...x,
            parentId: undefined,
            extent: undefined,
            position: { x: x.position.x + groupPos.get(x.parentId)!.x, y: x.position.y + groupPos.get(x.parentId)!.y }
          }
        : x
    )
}

/** Plan on the canvas as the close found it, delete, apply — the order the Canvas dispatch runs. */
function closeCompact(before: CanvasNode[], ids: string[]) {
  const plan = planCompaction(before, ids)
  const after = removeLikeDeleteNodes(before, ids)
  return { plan, after, out: applyCompaction(after, plan) }
}

/** A 2-column frame of four, arranged with the `arrange` gap (40). `b` may be taller than a row. */
function twoByTwo(bHeight = 50): CanvasNode[] {
  const row2 = 62 + Math.max(50, bHeight) + 40
  return [
    frame('g', 100, 100, 296, row2 + 50 - 62 + 90),
    n('a', 28, 62, 'g'),
    n('b', 168, 62, 'g', 100, bHeight),
    n('c', 28, row2, 'g'),
    n('d', 168, row2, 'g')
  ]
}

describe('compactRequested — the flag gate', () => {
  it('is off without --compact, so a plain close never plans or moves anything', () => {
    expect(compactRequested({ node: 'a' })).toBe(false)
  })

  it('reads a valueless flag (the shim sends arg.compact=) as on, and the explicit offs as off', () => {
    expect(compactRequested({ node: 'a', compact: '' })).toBe(true)
    expect(compactRequested({ node: 'a', compact: 'true' })).toBe(true)
    for (const off of ['false', 'no', '0', 'off', ' OFF ']) expect(compactRequested({ compact: off })).toBe(false)
  })
})

describe('close --compact', () => {
  it('re-packs the other 3 of a 2-column frame of 4 with no hole, and the frame shrinks', () => {
    // b is the tall one, so its row is the frame's tallest: with equal sizes, 3 nodes in 2 columns
    // still need 2 rows and no frame could shrink.
    const before = twoByTwo(120)
    const { plan, out } = closeCompact(before, ['b'])
    expect(plan).toMatchObject({ frames: ['g'], pinned: [], emptied: [] })
    // Reading order a, c, d into the frame's 2 columns: c moves up into b's slot, d under a.
    expect(at(out, 'a').position).toEqual({ x: 28, y: 62 })
    expect(at(out, 'c').position).toEqual({ x: 168, y: 62 })
    expect(at(out, 'd').position).toEqual({ x: 28, y: 62 + 50 + 40 })
    // Hugs the new layout: 300 tall → 230, same width, and the frame's top-left does not move.
    expect(at(before, 'g').height).toBe(300)
    expect(box(at(out, 'g'))).toEqual({ x: 100, y: 100, width: 296, height: 230 })
  })

  it('keeps the column count the frame had before the close', () => {
    // Closing the whole right column leaves a and c stacked. Read AFTER the close that is one
    // column; the frame had two, so they become one row.
    const { out } = closeCompact(twoByTwo(), ['b', 'd'])
    expect(at(out, 'a').position).toEqual({ x: 28, y: 62 })
    expect(at(out, 'c').position).toEqual({ x: 168, y: 62 })
    expect(box(at(out, 'g'))).toEqual({ x: 100, y: 100, width: 296, height: 140 })
  })

  it('closing the top row pulls the rest up; the frame keeps its top edge', () => {
    const { out } = closeCompact(twoByTwo(), ['a', 'b'])
    expect(at(out, 'c').position).toEqual({ x: 28, y: 62 })
    expect(at(out, 'd').position).toEqual({ x: 168, y: 62 })
    expect(box(at(out, 'g'))).toEqual({ x: 100, y: 100, width: 296, height: 140 })
  })

  it('leaves a pinned frame exactly as it is', () => {
    const before = twoByTwo().map((x) => (x.id === 'g' ? pin(x) : x))
    const { plan, after, out } = closeCompact(before, ['b'])
    expect(plan).toMatchObject({ frames: [], pinned: ['g'], emptied: [] })
    expect(out).toBe(after)
    expect(compactNote(plan)).toBe(' — compact: left g as is (pinned, or holds a pinned node)')
  })

  it('leaves a frame that holds a pinned node as is — re-packing would stack the rest on it', () => {
    // `arrangeNodes` keeps a pinned member in place and starts the rest at the first slot: b
    // would land exactly on a pinned a.
    const before = twoByTwo().map((x) => (x.id === 'a' ? pin(x) : x))
    const { plan, after, out } = closeCompact(before, ['d'])
    expect(plan).toMatchObject({ frames: [], pinned: ['g'] })
    expect(out).toBe(after)
  })

  it('leaves a frame with a pinned node deeper inside as is — a child frame would carry it along', () => {
    // F ⊃ { a, G ⊃ { p (pinned), b } }. Re-packing F moved G (168,62) → (28,62), and p with it.
    const before = [
      frame('F', 100, 100, 492, 230),
      n('a', 28, 62, 'F'),
      frame('G', 168, 62, 296, 140, 'F'),
      pin(n('p', 28, 62, 'G')),
      n('b', 168, 62, 'G')
    ]
    const pAbs = (nodes: CanvasNode[]) => rootPosition(at(nodes, 'p'), nodes)
    expect(pAbs(before)).toEqual({ x: 296, y: 224 })
    for (const ids of [['a', 'b'], ['a']]) {
      const { plan, after, out } = closeCompact(before, ids)
      expect(plan.frames).toEqual([])
      expect(plan.pinned).toContain('F')
      expect(out).toBe(after)
      expect(pAbs(out)).toEqual({ x: 296, y: 224 })
      expect(compactNote(plan)).toMatch(/left F(, G)? as is/)
    }
  })

  it('closing the pinned node itself frees its frame to re-pack', () => {
    const before = twoByTwo().map((x) => (x.id === 'b' ? pin(x) : x))
    const { plan, out } = closeCompact(before, ['b'])
    expect(plan).toMatchObject({ frames: ['g'], pinned: [] })
    expect(at(out, 'c').position).toEqual({ x: 168, y: 62 })
    expect(at(out, 'd').position).toEqual({ x: 28, y: 152 })
  })

  // T ⊃ { F ⊃ {a, b, c, d} (2 columns), s under F }, all measured as on the live canvas.
  const nested = (): CanvasNode[] =>
    measured([
      frame('T', 0, 0, 352, 410),
      frame('F', 28, 62, 296, 230, 'T'),
      n('a', 28, 62, 'F'),
      n('b', 168, 62, 'F'),
      n('c', 28, 152, 'F'),
      n('d', 168, 152, 'F'),
      n('s', 28, 332, 'T')
    ])

  it('walks up: an enclosing frame whose child frame shrank is re-laid out and shrinks too', () => {
    const { plan, out } = closeCompact(nested(), ['c', 'd'])
    expect(plan.frames).toEqual(['F'])
    // F loses its bottom row…
    expect(box(at(out, 'F'))).toEqual({ x: 28, y: 62, width: 296, height: 140 })
    // …and its stale measurement, or the next step up would lay T out around F's OLD height.
    expect(at(out, 'F').measured).toBeUndefined()
    // T re-packs its own children (1 column) around F's new size: s moves up under F.
    expect(at(out, 's').position).toEqual({ x: 28, y: 62 + 140 + 40 })
    expect(box(at(out, 'T'))).toEqual({ x: 0, y: 0, width: 352, height: 320 })
  })

  it('the walk stops at the first enclosing frame that stays as is', () => {
    // T holds a pinned node p, so T stays as is: F still re-packs and shrinks, but T is not
    // re-laid out around it — s keeps its spot and T its size.
    const before = measured([...nested(), pin(n('p', 168, 332, 'T'))])
    const { plan, out } = closeCompact(before, ['c', 'd'])
    expect(plan.frames).toEqual(['F'])
    expect(box(at(out, 'F'))).toEqual({ x: 28, y: 62, width: 296, height: 140 })
    expect(at(out, 's').position).toEqual({ x: 28, y: 332 })
    expect(at(out, 'p').position).toEqual({ x: 168, y: 332 })
    expect(box(at(out, 'T'))).toEqual({ x: 0, y: 0, width: 352, height: 410 })
  })

  it('the walk up also stops at a frame with a pinned node deeper inside', () => {
    // T ⊃ { F ⊃ {a, b, c, d}, H ⊃ {q (pinned)} }: F shrinks, but re-packing T would carry H — and
    // q — up under F.
    const before = measured([
      frame('T', 0, 0, 352, 500),
      frame('F', 28, 62, 296, 230, 'T'),
      n('a', 28, 62, 'F'),
      n('b', 168, 62, 'F'),
      n('c', 28, 152, 'F'),
      n('d', 168, 152, 'F'),
      frame('H', 28, 332, 156, 140, 'T'),
      pin(n('q', 28, 62, 'H'))
    ])
    const { plan, out } = closeCompact(before, ['c', 'd'])
    expect(plan.frames).toEqual(['F'])
    expect(box(at(out, 'F'))).toEqual({ x: 28, y: 62, width: 296, height: 140 })
    expect(at(out, 'H').position).toEqual({ x: 28, y: 332 })
    expect(box(at(out, 'T'))).toEqual({ x: 0, y: 0, width: 352, height: 500 })
  })

  it('a frame inside a pinned frame is pinned too: nothing moves at any level', () => {
    // Pinning is inherited (`isPinned`), so F is pinned by T and the walk never starts.
    const before = nested().map((x) => (x.id === 'T' ? pin(x) : x))
    const { plan, after, out } = closeCompact(before, ['c', 'd'])
    expect(plan).toMatchObject({ frames: [], pinned: ['F'] })
    expect(out).toBe(after)
  })

  it('closing a frame node re-packs the frame that held it; its freed children are left where the delete put them', () => {
    // T ⊃ { F ⊃ {k1, k2}, s } in row 1, u in row 2.
    const before = [
      frame('T', 0, 0, 492, 320),
      frame('F', 28, 62, 296, 140, 'T'),
      n('k1', 28, 62, 'F'),
      n('k2', 168, 62, 'F'),
      n('s', 364, 62, 'T'),
      n('u', 28, 242, 'T')
    ]
    const { plan, after, out } = closeCompact(before, ['F'])
    expect(plan).toMatchObject({ frames: ['T'], pinned: [], emptied: [] })
    // s and u fill T's 2 columns from F's old corner.
    expect(at(out, 's').position).toEqual({ x: 28, y: 62 })
    expect(at(out, 'u').position).toEqual({ x: 168, y: 62 })
    expect(box(at(out, 'T'))).toEqual({ x: 0, y: 0, width: 296, height: 140 })
    // The delete freed k1/k2 to the top level; the top level is never re-laid out.
    for (const k of ['k1', 'k2']) expect(at(out, k)).toBe(at(after, k))
  })

  it('closing a top-level node or frame has nothing to compact', () => {
    const before = [frame('G', 0, 0, 296, 140), n('k', 28, 62, 'G'), n('loose', 500, 0)]
    for (const ids of [['G'], ['loose']]) {
      const { plan, after, out } = closeCompact(before, ids)
      expect(plan).toMatchObject({ frames: [], pinned: [], emptied: [] })
      expect(out).toBe(after)
      expect(compactNote(plan)).toBe(' — compact: no frame held these nodes')
    }
  })

  it('a frame the close emptied stays, empty, at its size — the caller ungroups it', () => {
    const { plan, after, out } = closeCompact(twoByTwo(), ['a', 'b', 'c', 'd'])
    expect(plan).toMatchObject({ frames: [], emptied: ['g'] })
    expect(out).toBe(after)
    expect(box(at(out, 'g'))).toEqual({ x: 100, y: 100, width: 296, height: 230 })
    expect(compactNote(plan)).toBe(' — compact: left g empty (ungroup it)')
  })
})

describe('readingRows — the column-count rule', () => {
  it('tolerates hand-placed drift up to half a node, then starts a new row', () => {
    const ids = (nodes: CanvasNode[]) => readingRows(nodes).map((r) => r.map((x) => x.id))
    // b starts above a's middle (25) and joins a's row; d sits above c but in c's row.
    expect(ids([n('a', 0, 0), n('b', 200, 20), n('d', 200, 90), n('c', 0, 100)])).toEqual([['a', 'b'], ['c', 'd']])
    expect(ids([n('a', 0, 0), n('b', 200, 30)])).toEqual([['a'], ['b']])
  })
})
