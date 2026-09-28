import { describe, it, expect } from 'vitest'
import { flowToNodeStates, nodeStatesToFlow, normalizeCardBand } from './workspace'
import type { CanvasNodeState } from '@shared/types'

// `cardBand` is the room a chat keeps under itself for its docked subagent/loop card row. It must
// survive a save and load (so a restart does not drop the band and let cards cover the chat below),
// and a hand-edited project file must never smuggle in a value that shoves a column off the canvas.

const chat = (cardBand: unknown): CanvasNodeState =>
  ({
    id: 'a',
    kind: 'terminal',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 400 },
    title: 'a',
    color: '#fff',
    group: null,
    cardBand
  }) as unknown as CanvasNodeState

describe('cardBand persistence', () => {
  it('survives save and load', () => {
    const [flow] = nodeStatesToFlow([chat(120)])
    expect(flow.data.cardBand).toBe(120)
    const [back] = flowToNodeStates([flow])
    expect(back.cardBand).toBe(120)
    // Layout-only: the chat's saved size is untouched by the band.
    expect(back.size).toEqual({ width: 640, height: 400 })
  })

  it.each([[-1], [2001], [Number.NaN], [Number.POSITIVE_INFINITY], ['120'], [null]])(
    'drops %p on load',
    (v) => {
      const [flow] = nodeStatesToFlow([chat(v)])
      expect(flow.data.cardBand).toBeUndefined()
    }
  )

  it('accepts only finite numbers from 0 to 2000', () => {
    expect(normalizeCardBand(0)).toBe(0)
    expect(normalizeCardBand(2000)).toBe(2000)
    expect(normalizeCardBand(2000.5)).toBeUndefined()
  })
})
