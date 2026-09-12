import { describe, it, expect } from 'vitest'
import {
  snapshotTarget,
  snapshotViewport,
  capturedCanvasRect,
  snapshotViewRefusal,
  snapshotReplyMessage,
  SNAPSHOT_EMPTY_CANVAS,
  SNAPSHOT_NOT_ON_SCREEN,
  type SnapshotNode
} from './canvasSnapshot'

const FIT = { margin: 20, minZoom: 0.01, maxZoom: 2 }

const node = (id: string, x: number, y: number, w: number, h: number, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({
  id,
  type: 'terminal',
  position: { x, y },
  measured: { width: w, height: h },
  ...extra
})
const frame = (id: string, x: number, y: number, w: number, h: number, parentId?: string): SnapshotNode =>
  node(id, x, y, w, h, { type: 'group', ...(parentId ? { parentId } : {}) })

describe('snapshotTarget — what gets framed', () => {
  it('the whole canvas is the union of every node, in absolute coordinates', () => {
    const nodes = [
      node('a', 0, 0, 400, 300),
      frame('g', 500, 400, 500, 400),
      // Relative to its frame: absolute (600, 500), bottom-right (1000, 800) — inside g.
      node('c', 100, 100, 300, 200, { parentId: 'g' }),
      node('d', -200, 50, 100, 100)
    ]
    expect(snapshotTarget(nodes)).toEqual({ ok: true, bounds: { x: -200, y: 0, width: 1200, height: 800 } })
  })

  it('keep-alive ghosts are not content — they would drag the frame toward the origin', () => {
    const nodes = [node('a', 1000, 1000, 400, 300), node('ghost', 0, 0, 10, 10, { data: { ghost: true } })]
    expect(snapshotTarget(nodes)).toEqual({ ok: true, bounds: { x: 1000, y: 1000, width: 400, height: 300 } })
  })

  it('one frame is that frame\'s own rect', () => {
    const nodes = [node('a', 0, 0, 400, 300), frame('g1', 100, 200, 800, 600)]
    expect(snapshotTarget(nodes, 'g1')).toEqual({
      ok: true,
      bounds: { x: 100, y: 200, width: 800, height: 600 },
      frame: 'g1'
    })
  })

  it('a nested frame is placed by walking its parent chain', () => {
    const nodes = [frame('outer', 100, 100, 1000, 800), frame('inner', 50, 60, 300, 200, 'outer')]
    expect(snapshotTarget(nodes, 'inner')).toEqual({
      ok: true,
      bounds: { x: 150, y: 160, width: 300, height: 200 },
      frame: 'inner'
    })
  })

  it('an empty canvas is refused by name — a PNG of nothing answers nothing', () => {
    expect(snapshotTarget([])).toEqual({ ok: false, error: SNAPSHOT_EMPTY_CANVAS })
    // Ghosts alone are still an empty canvas.
    expect(snapshotTarget([node('ghost', 0, 0, 10, 10, { data: { ghost: true } })])).toEqual({
      ok: false,
      error: SNAPSHOT_EMPTY_CANVAS
    })
  })

  it('an unknown --frame is refused, naming the id', () => {
    const r = snapshotTarget([frame('g1', 0, 0, 100, 100)], 'nope')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('"nope"') })
    expect(r.ok === false && r.error).toContain('no frame')
  })

  it('a --frame that is not a group is refused, naming the id', () => {
    const r = snapshotTarget([node('t1', 0, 0, 100, 100)], 't1')
    expect(r).toEqual({ ok: false, error: expect.stringContaining('"t1" is not a frame') })
  })
})

describe('snapshotViewport — the computed camera (setViewport, never fitView)', () => {
  it('fits the bounds inside the pane with the margin, centred, on the tighter axis', () => {
    // 1000×800 content in a 1000×800 pane: height is the tighter axis, (800-40)/800 = 0.95.
    const v = snapshotViewport({ x: 0, y: 0, width: 1000, height: 800 }, 1000, 800, FIT)!
    expect(v.zoom).toBeCloseTo(0.95, 10)
    expect(v.x).toBeCloseTo(25, 10)
    expect(v.y).toBeCloseTo(20, 10)
  })

  it('every corner of the bounds lands inside the pane, at least the margin in', () => {
    const bounds = { x: -200, y: 0, width: 1200, height: 800 }
    const v = snapshotViewport(bounds, 1280, 720, FIT)!
    const toPane = (fx: number, fy: number) => ({ x: fx * v.zoom + v.x, y: fy * v.zoom + v.y })
    const tl = toPane(bounds.x, bounds.y)
    const br = toPane(bounds.x + bounds.width, bounds.y + bounds.height)
    expect(tl.x).toBeGreaterThanOrEqual(FIT.margin - 1e-9)
    expect(tl.y).toBeGreaterThanOrEqual(FIT.margin - 1e-9)
    expect(br.x).toBeLessThanOrEqual(1280 - FIT.margin + 1e-9)
    expect(br.y).toBeLessThanOrEqual(720 - FIT.margin + 1e-9)
  })

  it('a small frame is not blown past the canvas\'s own max zoom', () => {
    // The nested frame above: 300×200 would fit at 3.2×, clamped to 2.
    const v = snapshotViewport({ x: 150, y: 160, width: 300, height: 200 }, 1000, 800, FIT)!
    expect(v).toEqual({ x: -100, y: -120, zoom: 2 })
  })

  it('a huge canvas is clamped to the canvas\'s own min zoom', () => {
    const v = snapshotViewport({ x: 0, y: 0, width: 1e6, height: 1e6 }, 1000, 800, FIT)!
    expect(v.zoom).toBe(0.01)
  })

  it('answers null when there is no pane to fit into', () => {
    expect(snapshotViewport({ x: 0, y: 0, width: 100, height: 100 }, 0, 800, FIT)).toBeNull()
    // A pane no wider than both margins leaves no room at all.
    expect(snapshotViewport({ x: 0, y: 0, width: 100, height: 100 }, 40, 800, FIT)).toBeNull()
  })

  it('the captured canvas rect is the pane seen through the viewport, and contains the bounds', () => {
    const bounds = { x: 150, y: 160, width: 300, height: 200 }
    const v = snapshotViewport(bounds, 1000, 800, FIT)!
    expect(capturedCanvasRect(v, 1000, 800)).toEqual({ x: 50, y: 60, width: 500, height: 400 })
  })
})

describe('refusals and the reply', () => {
  it('names the view that is covering the canvas, and says nothing when the canvas is up', () => {
    expect(snapshotViewRefusal({ kanbanOpen: true, overviewOpen: false })).toContain('kanban board is open')
    expect(snapshotViewRefusal({ kanbanOpen: false, overviewOpen: true })).toContain('Network overview is open')
    expect(snapshotViewRefusal({ kanbanOpen: false, overviewOpen: false })).toBeNull()
  })

  it('the off-screen refusal says the view is never switched for it', () => {
    expect(SNAPSHOT_NOT_ON_SCREEN).toContain('not the one on screen')
    expect(SNAPSHOT_NOT_ON_SCREEN).toContain('never switches')
  })

  it('the reply carries the path, the pixel size, the canvas area and the zoom', () => {
    const msg = snapshotReplyMessage({
      path: '/u/snapshots/p-1.png',
      width: 2000,
      height: 1600,
      canvas: { x: -26.3, y: -21.05, width: 1052.6, height: 842.1 },
      zoom: 0.95
    })
    expect(msg).toBe(
      'snapshot of the whole canvas: /u/snapshots/p-1.png (2000×1600 px) — canvas area x=-26 y=-21 w=1053 h=842 at zoom 0.95'
    )
    expect(
      snapshotReplyMessage({
        path: '/p/a.png',
        width: 10,
        height: 10,
        canvas: { x: 0, y: 0, width: 10, height: 10 },
        zoom: 1.23456,
        frame: 'g1'
      })
    ).toContain('snapshot of frame g1: /p/a.png (10×10 px) — canvas area x=0 y=0 w=10 h=10 at zoom 1.235')
  })
})
