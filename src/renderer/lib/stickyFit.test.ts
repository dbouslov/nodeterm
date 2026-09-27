import { describe, it, expect, vi } from 'vitest'
import type { CanvasNode } from '../state/workspace'
import { COLLAPSED_HEIGHT } from '../state/workspace'
import { NODE_MIN_SIZES } from './nodeSizing'
import {
  applyStickyFit,
  forgetStickyFit,
  registerStickyFit,
  STICKY_FIT_PENDING_MS,
  requestStickyFit,
  stickyFitHeight,
  STICKY_FIT_MAX
} from './stickyFit'

const node = (id: string, x: number, y: number, w: number, h: number, more: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: 'sticky', position: { x, y }, width: w, height: h, data: { title: id, color: '#fff', group: null }, ...more }) as CanvasNode
const get = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((n) => n.id === id)!
const h = (n: CanvasNode): number => n.measured?.height ?? (n.height as number)

describe('stickyFitHeight — the height a note needs for its rendered content', () => {
  it('is the measured content height, rounded up', () => {
    expect(stickyFitHeight(311.2)).toBe(312)
    expect(stickyFitHeight(180)).toBe(180)
  })
  it('never goes below the sticky minimum height', () => {
    expect(stickyFitHeight(40)).toBe(NODE_MIN_SIZES.sticky.height)
  })
  it('stops growing at 2000 px (the note then scrolls)', () => {
    expect(STICKY_FIT_MAX).toBe(2000)
    expect(stickyFitHeight(5000)).toBe(2000)
  })
  it('refuses a measurement that is not a positive number (nothing to fit to)', () => {
    expect(stickyFitHeight(0)).toBeNull()
    expect(stickyFitHeight(Number.NaN)).toBeNull()
  })
})

describe('applyStickyFit — set the height, keep the width, reflow around it', () => {
  it('grows the note and pushes the node below by exactly the growth', () => {
    const nodes = [node('s', 0, 0, 300, 200), node('b', 0, 240, 300, 100, { type: 'terminal' })]
    const out = applyStickyFit(nodes, 's', 500)
    expect(h(get(out, 's'))).toBe(500)
    expect(get(out, 's').width).toBe(300)
    // The previous rect was 0,0 300x200: bottom moved by 300, so b (in the band) moves by 300.
    expect(get(out, 'b').position).toEqual({ x: 0, y: 540 })
  })

  it('shrinks the note and pulls the node below back up by the freed space', () => {
    const nodes = [node('s', 0, 0, 300, 500), node('b', 0, 540, 300, 100, { type: 'terminal' })]
    const out = applyStickyFit(nodes, 's', 200)
    expect(h(get(out, 's'))).toBe(200)
    expect(get(out, 'b').position).toEqual({ x: 0, y: 240 })
  })

  it('reads the previous rect from `measured` first, and drops the stale measurement', () => {
    const nodes = [
      node('s', 0, 0, 300, 999, { measured: { width: 300, height: 200 } }),
      node('b', 0, 240, 300, 100, { type: 'terminal' })
    ]
    const out = applyStickyFit(nodes, 's', 260)
    expect(get(out, 's').measured).toBeUndefined()
    expect(get(out, 'b').position.y).toBe(300)
  })

  it('makes the frame around the note hug it', () => {
    const nodes = [
      node('f', 0, 0, 340, 300, { type: 'group' }),
      node('s', 20, 60, 300, 200, { parentId: 'f', extent: 'parent' })
    ]
    const out = applyStickyFit(nodes, 's', 600)
    expect(h(get(out, 'f'))).toBeGreaterThanOrEqual(660)
  })

  it('a collapsed note stays collapsed; only its remembered expanded height changes', () => {
    const nodes = [
      node('s', 0, 0, 300, COLLAPSED_HEIGHT, {
        data: { title: 's', color: '#fff', group: null, collapsed: true, expandedHeight: 200 }
      }),
      node('b', 0, 80, 300, 100, { type: 'terminal' })
    ]
    const out = applyStickyFit(nodes, 's', 480)
    const s = get(out, 's')
    expect(s.data.collapsed).toBe(true)
    expect(s.data.expandedHeight).toBe(480)
    expect(h(s)).toBe(COLLAPSED_HEIGHT)
    expect(get(out, 'b').position.y).toBe(80)
  })

  it('with snapping on, rounds the fitted height up to the grid, still capped at 2000', () => {
    const nodes = [node('s', 0, 0, 300, 200)]
    expect(h(get(applyStickyFit(nodes, 's', 301, 24), 's'))).toBe(312)
    expect(h(get(applyStickyFit(nodes, 's', 1999, 24), 's'))).toBe(STICKY_FIT_MAX)
    const folded = [
      node('c', 0, 0, 300, COLLAPSED_HEIGHT, { data: { title: 'c', color: '#fff', group: null, collapsed: true, expandedHeight: 200 } })
    ]
    expect(get(applyStickyFit(folded, 'c', 301, 24), 'c').data.expandedHeight).toBe(312)
  })

  it('returns the same array when the height already fits, or the id is not a note', () => {
    const nodes = [node('s', 0, 0, 300, 200), node('t', 0, 300, 300, 100, { type: 'terminal' })]
    expect(applyStickyFit(nodes, 's', 200)).toBe(nodes)
    expect(applyStickyFit(nodes, 't', 500)).toBe(nodes)
    expect(applyStickyFit(nodes, 'nope', 500)).toBe(nodes)
  })
})

describe('requestStickyFit — the verb asks a mounted note to measure itself', () => {
  it('runs the note’s own measurer, and a request that arrived before the note mounted runs on mount', () => {
    const early = vi.fn()
    expect(requestStickyFit('late')).toBe(false)
    const off = registerStickyFit('late', early)
    expect(early).toHaveBeenCalledTimes(1)
    expect(requestStickyFit('late')).toBe(true)
    expect(early).toHaveBeenCalledTimes(2)
    off()
    expect(requestStickyFit('late')).toBe(false)
  })

  it('a held request expires, so a much later mount does not fit unasked', () => {
    const fn = vi.fn()
    expect(requestStickyFit('stale', 1_000)).toBe(false)
    const off = registerStickyFit('stale', fn, 1_000 + STICKY_FIT_PENDING_MS + 1)
    expect(fn).not.toHaveBeenCalled()
    off()
    const fresh = vi.fn()
    requestStickyFit('fresh', 1_000)
    registerStickyFit('fresh', fresh, 1_000 + STICKY_FIT_PENDING_MS - 1)()
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('forgetStickyFit drops a held request (the note was deleted before it mounted)', () => {
    const fn = vi.fn()
    requestStickyFit('gone')
    forgetStickyFit('gone')
    registerStickyFit('gone', fn)()
    expect(fn).not.toHaveBeenCalled()
  })

  it('a mount with nothing requested measures nothing (an old note is never refitted unasked)', () => {
    const fn = vi.fn()
    const off = registerStickyFit('quiet', fn)
    expect(fn).not.toHaveBeenCalled()
    off()
  })
})
