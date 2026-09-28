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

import { dockMarkRefusal } from './dock'
import { alwaysConfirms, decideControlConfirm } from './control-confirm'

describe('dockMarkRefusal: the one-time mark (pin --set dock)', () => {
  const scene = [
    { id: 'F', type: 'group', data: {} },
    { id: 'seat', parentId: 'F', type: 'terminal', data: {} },
    { id: 'G', type: 'group', data: {} },
    { id: 'inner', parentId: 'G', type: 'terminal', data: {} },
    { id: 'deep', parentId: 'inner2', type: 'terminal', data: {} },
    { id: 'inner2', parentId: 'F', type: 'group', data: {} },
    { id: 'loose', type: 'terminal', data: {} }
  ]
  it('allows a direct child marking its own frame', () => {
    expect(dockMarkRefusal(scene, 'seat', 'F')).toBeNull()
  })
  it('refuses a caller outside the frame, or nested deeper than a direct child', () => {
    expect(dockMarkRefusal(scene, 'inner', 'F')).toMatch(/direct child/)
    expect(dockMarkRefusal(scene, 'deep', 'F')).toMatch(/direct child/)
    expect(dockMarkRefusal(scene, 'loose', 'F')).toMatch(/direct child/)
  })
  it('refuses a target that is not a frame', () => {
    expect(dockMarkRefusal(scene, 'seat', 'loose')).toMatch(/frame/)
    expect(dockMarkRefusal(scene, 'seat', 'nope')).toMatch(/frame/)
  })
  it('refuses a second Dock, and re-marking the Dock', () => {
    const withDock = scene.map((n) => (n.id === 'G' ? { ...n, data: { fixture: 'dock' } } : n))
    expect(dockMarkRefusal(withDock, 'seat', 'F')).toMatch(/already has a Dock/)
    expect(dockMarkRefusal(withDock, 'inner', 'G')).toMatch(/already the Dock/)
  })
})

describe('confirm routing is argument-aware: only pin --set dock confirms', () => {
  const waivedEverywhere = {
    sessionWaived: new Set(['pin', 'write', 'close']),
    persisted: { always: ['pin', 'write', 'close'], bypassMode: true },
    permissionMode: 'bypassPermissions' as const,
    permissionModeSource: 'global' as const
  }
  it('pin --set on|off raises no confirm, with or without a waiver', () => {
    expect(alwaysConfirms('pin', { set: 'on' })).toBe(false)
    expect(alwaysConfirms('pin', { set: 'off' })).toBe(false)
  })
  it('pin --set dock always confirms, and no waiver can skip it', () => {
    expect(alwaysConfirms('pin', { set: 'dock' })).toBe(true)
    expect(decideControlConfirm({ verb: 'pin', ...waivedEverywhere })).toEqual({ skip: false, via: null })
  })
  it('nothing else is swept in', () => {
    expect(alwaysConfirms('minimize', { set: 'dock' })).toBe(false)
    expect(alwaysConfirms('close', {})).toBe(false)
  })
})
