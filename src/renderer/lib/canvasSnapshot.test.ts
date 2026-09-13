import { describe, it, expect } from 'vitest'
import type { Viewport } from '@xyflow/system'
import {
  snapshotTarget,
  snapshotViewport,
  capturedCanvasRect,
  snapshotViewRefusal,
  snapshotReplyMessage,
  runSnapshot,
  SNAPSHOT_EMPTY_CANVAS,
  SNAPSHOT_IN_PROGRESS,
  SNAPSHOT_NOT_ON_SCREEN,
  type SnapshotNode,
  type SnapshotRunDeps
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

describe('runSnapshot — frame, paint, capture, then hand the view back', () => {
  const USER_VIEW: Viewport = { x: 7, y: 9, zoom: 0.5 }
  const setup = (capture: SnapshotRunDeps['capture']) => {
    const calls: string[] = []
    let current: Viewport = USER_VIEW
    const deps: SnapshotRunDeps = {
      nodes: [frame('outer', 100, 100, 1000, 800), frame('inner', 50, 60, 300, 200, 'outer')],
      frame: 'inner',
      pane: { left: 300, top: 40, width: 1000, height: 800 },
      fit: FIT,
      getViewport: () => current,
      setViewport: async (v) => {
        calls.push(`set ${v.x},${v.y},${v.zoom}`)
        current = v
      },
      paint: async () => {
        calls.push('paint')
      },
      capture: async (rect) => {
        calls.push(`capture ${rect.x},${rect.y},${rect.width},${rect.height}`)
        return capture(rect)
      }
    }
    return { deps, calls, view: () => current }
  }

  it('sets the computed viewport, waits for paint, captures the pane, then restores the exact previous view', async () => {
    const { deps, calls, view } = setup(async () => ({ ok: true, path: '/u/s.png', width: 2000, height: 1600 }))
    const r = await runSnapshot(deps)
    expect(calls).toEqual(['set -100,-120,2', 'paint', 'capture 300,40,1000,800', 'set 7,9,0.5'])
    expect(view()).toEqual(USER_VIEW)
    expect(r).toEqual({
      ok: true,
      message: 'snapshot of frame inner: /u/s.png (2000×1600 px) — canvas area x=50 y=60 w=500 h=400 at zoom 2',
      result: {
        path: '/u/s.png',
        width: 2000,
        height: 1600,
        canvas: { x: 50, y: 60, width: 500, height: 400 },
        zoom: 2,
        frame: 'inner'
      }
    })
  })

  it('restores the previous view when main refuses the capture', async () => {
    const refusal = 'snapshot refused: the nodeterm window is minimized — ask the user to restore it, then retry'
    const { deps, calls, view } = setup(async () => ({ ok: false, error: refusal }))
    expect(await runSnapshot(deps)).toEqual({ ok: false, error: refusal })
    expect(calls.at(-1)).toBe('set 7,9,0.5')
    expect(view()).toEqual(USER_VIEW)
  })

  it('restores the previous view when the capture throws, and a later snapshot still runs', async () => {
    const { deps, view } = setup(async () => {
      throw new Error('ipc gone')
    })
    await expect(runSnapshot(deps)).rejects.toThrow('ipc gone')
    expect(view()).toEqual(USER_VIEW)
    const next = setup(async () => ({ ok: true, path: '/u/s.png', width: 2000, height: 1600 }))
    expect((await runSnapshot(next.deps)).ok).toBe(true)
  })

  it('a second snapshot while one is being taken is refused by name, and the user view ends where it began', async () => {
    const { deps, calls, view } = setup(async () => ({ ok: true, path: '/u/s.png', width: 2000, height: 1600 }))
    // Canvas.tsx runs control events concurrently. Unguarded, the second would save the first's
    // borrowed framing as "previous" and hand THAT back last, leaving the user off their own view.
    const first = runSnapshot(deps)
    const second = runSnapshot({ ...deps, frame: 'outer' })
    expect(await second).toEqual({ ok: false, error: SNAPSHOT_IN_PROGRESS })
    expect((await first).ok).toBe(true)
    expect(calls).toEqual(['set -100,-120,2', 'paint', 'capture 300,40,1000,800', 'set 7,9,0.5'])
    expect(view()).toEqual(USER_VIEW)
    // Unlike the other refusals, this one is worth retrying — and once the first is done, it runs.
    expect(SNAPSHOT_IN_PROGRESS).toContain('retry in a moment')
    expect((await runSnapshot({ ...deps, frame: 'outer' })).ok).toBe(true)
  })

  it('refuses before touching the view: unknown frame, empty canvas, no pane', async () => {
    const overrides: Partial<SnapshotRunDeps>[] = [{ frame: 'nope' }, { nodes: [], frame: undefined }, { pane: null }]
    for (const over of overrides) {
      const { deps, calls, view } = setup(async () => ({ ok: true, path: '/x.png', width: 1, height: 1 }))
      const r = await runSnapshot({ ...deps, ...over })
      expect(r.ok).toBe(false)
      expect(calls).toEqual([])
      expect(view()).toEqual(USER_VIEW)
    }
  })
})
