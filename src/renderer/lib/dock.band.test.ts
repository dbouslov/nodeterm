import { describe, it, expect } from 'vitest'
import type { CanvasNode } from '../state/workspace'
import { BAND_GROW_MS, CardBands, bandOf } from './cardBand'
import { computeGeometry } from './geometry'

// A T4 card band on a chat ABOVE the Dock is clamped so the chat's applied rect never enters the
// Dock (the Dock is pinned: reflow cannot push it away). Cards that still reach it are reported by
// geometry as an overlap with the Dock (review fix 4).

const dock: CanvasNode = {
  id: 'D',
  type: 'group',
  position: { x: 0, y: 600 },
  width: 1400,
  height: 800,
  draggable: false,
  data: { title: 'GO', color: '#fff', group: null, fixture: 'dock', pinned: true }
}
const chat: CanvasNode = {
  id: 'c',
  type: 'terminal',
  position: { x: 100, y: 0 },
  width: 640,
  height: 440,
  data: { title: 'c', color: '#fff', group: null, agentId: 'claude' }
}
const env = (now: number) => ({ now, busy: false, lastKeydown: new Map<string, number>(), pointerOver: null })

describe('band clamp above the Dock', () => {
  it('a band that would enter the Dock stops at its top edge', () => {
    const bands = new CardBands()
    const rows = new Map([['c', 330]])
    bands.step([dock, chat], rows, env(0))
    const out = bands.step([dock, chat], rows, env(BAND_GROW_MS + 1))
    const c = out.nodes.find((n) => n.id === 'c')!
    // Room between the chat's bottom (440) and the Dock's top (600).
    expect(bandOf(c)).toBe(160)
    expect(out.nodes.find((n) => n.id === 'D')!.position).toEqual({ x: 0, y: 600 })
  })

  it('a chat not above the Dock grows as before', () => {
    const beside = { ...chat, position: { x: 1600, y: 0 } }
    const bands = new CardBands()
    const rows = new Map([['c', 330]])
    bands.step([dock, beside], rows, env(0))
    const out = bands.step([dock, beside], rows, env(BAND_GROW_MS + 1))
    expect(bandOf(out.nodes.find((n) => n.id === 'c')!)).toBe(330)
  })

  it('geometry reports a card that still reaches the Dock', () => {
    const c = { ...chat, data: { ...chat.data, cardBand: 160 } }
    const card: CanvasNode = {
      id: 'card',
      type: 'subagent',
      position: { x: 100, y: 570 },
      width: 230,
      height: 96,
      data: { title: 'card', color: '#fff', group: null, ownerNodeId: 'c' }
    }
    const r = computeGeometry([dock, c, card])
    if ('error' in r) throw new Error(r.error)
    expect(r.overlaps.some((o) => [o.a, o.b].includes('card') && [o.a, o.b].includes('D'))).toBe(true)
  })
})
