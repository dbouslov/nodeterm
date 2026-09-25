import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createEdgeClickJump,
  edgeCardInfo,
  edgeCardStatus,
  farEndOf,
  HIDE_DELAY_MS,
  SHOW_DELAY_MS,
  useEdgeHoverCard
} from './edgeHoverCardModel'

const box = (x: number, y: number) => ({ x, y, width: 100, height: 100 })

describe('farEndOf', () => {
  const boxes = new Map([
    ['a', box(0, 0)],
    ['b', box(1000, 0)]
  ])
  const edge = { source: 'a', target: 'b' }

  it('picks the end farther from the pointer', () => {
    expect(farEndOf(edge, { x: 100, y: 50 }, boxes)).toBe('b')
    expect(farEndOf(edge, { x: 950, y: 50 }, boxes)).toBe('a')
  })

  it('falls back to the end that has a box, then to the target', () => {
    expect(farEndOf({ source: 'a', target: 'gone' }, { x: 0, y: 0 }, boxes)).toBe('a')
    expect(farEndOf({ source: 'gone', target: 'b' }, { x: 0, y: 0 }, boxes)).toBe('b')
    expect(farEndOf({ source: 'x', target: 'y' }, { x: 0, y: 0 }, new Map())).toBe('y')
  })
})

describe('edgeCardStatus', () => {
  it('reads the store the way the node badges do', () => {
    expect(edgeCardStatus({ state: 'working', unread: false })).toBe('working')
    expect(edgeCardStatus({ state: 'waiting', unread: false })).toBe('waiting')
    expect(edgeCardStatus({ state: 'blocked', unread: false })).toBe('waiting')
    expect(edgeCardStatus({ state: 'done', unread: true })).toBe('finished')
    expect(edgeCardStatus({ state: 'done', unread: false })).toBe('idle')
  })

  it('is unknown, not idle, when no hook has reported', () => {
    expect(edgeCardStatus(undefined)).toBeUndefined()
    expect(edgeCardStatus({ unread: false })).toBeUndefined()
  })
})

describe('edgeCardInfo', () => {
  const annotation = { role: 'lead: reviews PRs', by: 'n2', at: 1 }

  it('uses the title, the status and the session title as the summary', () => {
    expect(edgeCardInfo('n1', { title: 'Builder' }, { state: 'working', unread: false, session: 'Fixing the\nlogin bug' })).toEqual({
      nodeId: 'n1',
      title: 'Builder',
      status: 'working',
      summary: 'Fixing the login bug'
    })
  })

  it('falls back to the annotated role when there is no session title', () => {
    expect(edgeCardInfo('n1', { title: 'Builder', annotation }, undefined).summary).toBe('lead: reviews PRs')
  })

  it('does not repeat the title as the summary', () => {
    expect(edgeCardInfo('n1', { title: 'Builder', annotation }, { unread: false, session: 'Builder' }).summary).toBe('lead: reviews PRs')
    expect(edgeCardInfo('n1', { title: 'Builder' }, { unread: false, session: 'Builder' }).summary).toBeUndefined()
  })

  it('falls back to the id for a missing or non-string title, and ignores a malformed annotation', () => {
    const info = edgeCardInfo('n1', { title: 42, annotation: { role: 'x' } }, undefined)
    expect(info).toEqual({ nodeId: 'n1', title: 'n1', status: undefined, summary: undefined })
    expect(edgeCardInfo('n1', undefined, undefined).title).toBe('n1')
  })
})

describe('useEdgeHoverCard timing', () => {
  const a = { edgeId: 'e1', nodeId: 'a', x: 1, y: 2 }
  const b = { edgeId: 'e2', nodeId: 'b', x: 3, y: 4 }
  beforeEach(() => {
    vi.useFakeTimers()
    useEdgeHoverCard.getState().dismiss()
  })
  afterEach(() => vi.useRealTimers())
  const card = () => useEdgeHoverCard.getState().card

  it('shows after the delay, not at once', () => {
    useEdgeHoverCard.getState().hover(a)
    expect(card()).toBeNull()
    vi.advanceTimersByTime(SHOW_DELAY_MS)
    expect(card()).toEqual(a)
  })

  it('never shows when the pointer only sweeps across the link', () => {
    useEdgeHoverCard.getState().hover(a)
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1)
    useEdgeHoverCard.getState().leave()
    vi.advanceTimersByTime(1000)
    expect(card()).toBeNull()
  })

  it('swaps at once from one link to the next while a card is up', () => {
    useEdgeHoverCard.getState().hover(a)
    vi.advanceTimersByTime(SHOW_DELAY_MS)
    useEdgeHoverCard.getState().leave()
    useEdgeHoverCard.getState().hover(b)
    expect(card()).toEqual(b)
    vi.advanceTimersByTime(1000)
    expect(card()).toEqual(b)
  })

  it('hides after the grace period, unless the pointer reaches the card', () => {
    useEdgeHoverCard.getState().hover(a)
    vi.advanceTimersByTime(SHOW_DELAY_MS)
    useEdgeHoverCard.getState().leave()
    useEdgeHoverCard.getState().hold()
    vi.advanceTimersByTime(1000)
    expect(card()).toEqual(a)
    useEdgeHoverCard.getState().leave()
    vi.advanceTimersByTime(HIDE_DELAY_MS)
    expect(card()).toBeNull()
  })

  it('dismiss clears the card and any pending show', () => {
    useEdgeHoverCard.getState().hover(a)
    useEdgeHoverCard.getState().dismiss()
    vi.advanceTimersByTime(1000)
    expect(card()).toBeNull()
  })
})

describe('createEdgeClickJump', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('jumps to the node once the double-click window has passed', () => {
    const jump = vi.fn()
    const j = createEdgeClickJump(jump, 300)
    j.click('b')
    expect(jump).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(jump).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('a double click (click, click, dblclick) cancels the jump', () => {
    const jump = vi.fn()
    const j = createEdgeClickJump(jump, 300)
    j.click('b')
    j.click('b')
    j.cancel()
    vi.advanceTimersByTime(1000)
    expect(jump).not.toHaveBeenCalled()
  })
})
