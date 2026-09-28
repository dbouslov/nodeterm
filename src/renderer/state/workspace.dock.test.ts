import { describe, it, expect } from 'vitest'
import { flowToNodeStates, nodeStatesToFlow } from './workspace'
import type { CanvasNodeState } from '@shared/types'

// The Dock is a frame marked `fixture: 'dock'`. The mark must survive a save and a restart, and the
// file is hand-editable, so only the literal 'dock' counts.

const frame = (fixture: unknown): CanvasNodeState =>
  ({
    id: 'dock',
    kind: 'group',
    position: { x: 40, y: 40 },
    size: { width: 1200, height: 900 },
    title: 'GO',
    color: '#fff',
    group: null,
    pinned: true,
    fixture
  }) as unknown as CanvasNodeState

describe('Dock fixture persistence', () => {
  it('survives save and load, pinned and not draggable', () => {
    const [flow] = nodeStatesToFlow([frame('dock')])
    expect(flow.data.fixture).toBe('dock')
    expect(flow.data.pinned).toBe(true)
    expect(flow.draggable).toBe(false)
    const [back] = flowToNodeStates([flow])
    expect(back.fixture).toBe('dock')
    expect(back.pinned).toBe(true)
    const [again] = nodeStatesToFlow([back])
    expect(again.data.fixture).toBe('dock')
  })

  it.each([['Dock'], [true], [1], ['yes'], [null]])('drops %p on load', (v) => {
    const [flow] = nodeStatesToFlow([frame(v)])
    expect(flow.data.fixture).toBeUndefined()
    expect(flow.draggable).toBeUndefined()
  })

  it('drops a stray value on save too', () => {
    const [flow] = nodeStatesToFlow([frame(undefined)])
    const [back] = flowToNodeStates([{ ...flow, data: { ...flow.data, fixture: 'junk' as unknown as 'dock' } }])
    expect(back.fixture).toBeUndefined()
  })
})

describe('Dock is always pinned', () => {
  it('a hand-edited Dock without pinned loads pinned', () => {
    const [flow] = nodeStatesToFlow([{ ...frame('dock'), pinned: undefined }])
    expect(flow.data.pinned).toBe(true)
  })
})

describe('Dock persistence is group-only and single (review fix 1)', () => {
  const term = { ...frame('dock'), id: 't', kind: 'terminal' } as unknown as CanvasNodeState
  it('a terminal carrying fixture dock loses it, both ways', () => {
    const [flow] = nodeStatesToFlow([term])
    expect(flow.data.fixture).toBeUndefined()
    expect(flow.draggable).toBeUndefined()
    const [back] = flowToNodeStates([{ ...flow, data: { ...flow.data, fixture: 'dock' as const } }])
    expect(back.fixture).toBeUndefined()
  })
  it('only the first Dock keeps the flag on load', () => {
    const second = { ...frame('dock'), id: 'dock2', pinned: undefined } as CanvasNodeState
    const flow = nodeStatesToFlow([frame('dock'), second])
    expect(flow.find((n) => n.id === 'dock')!.data.fixture).toBe('dock')
    const later = flow.find((n) => n.id === 'dock2')!
    expect(later.data.fixture).toBeUndefined()
    expect(later.draggable).toBeUndefined()
    expect(later.data.pinned).toBeUndefined()
  })
})
