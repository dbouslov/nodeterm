import { describe, it, expect } from 'vitest'
import { isDock, dockOf, inDock } from './dock'

// Both node shapes: the stored one (flat `fixture`) and the live one (`data.fixture`).
const live = [
  { id: 'D', data: { fixture: 'dock' } },
  { id: 'seat', parentId: 'D', data: {} },
  { id: 'sub', parentId: 'F', data: {} },
  { id: 'F', parentId: 'D', data: {} },
  { id: 'out', data: {} }
]
const stored = [
  { id: 'D', fixture: 'dock' },
  { id: 'seat', parentId: 'D' },
  { id: 'out' }
]

describe('dock helpers', () => {
  it('isDock reads either shape and only the literal', () => {
    expect(isDock(live[0])).toBe(true)
    expect(isDock(stored[0])).toBe(true)
    expect(isDock({ id: 'x', fixture: 'Dock' })).toBe(false)
    expect(isDock({ id: 'x', data: { fixture: true } })).toBe(false)
  })
  it('dockOf finds the Dock frame', () => {
    expect(dockOf(live)?.id).toBe('D')
    expect(dockOf(stored)?.id).toBe('D')
    expect(dockOf([{ id: 'a' }])).toBeUndefined()
  })
  it('inDock is true for anything inside the Dock, at any depth, and false for the Dock itself', () => {
    expect(inDock('seat', live)).toBe(true)
    expect(inDock('sub', live)).toBe(true)
    expect(inDock('D', live)).toBe(false)
    expect(inDock('out', live)).toBe(false)
    expect(inDock('seat', stored)).toBe(true)
  })
})
