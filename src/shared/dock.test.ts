import { describe, it, expect } from 'vitest'
import { isDock, dockOf, inDock } from './dock'

// Both node shapes: the stored one (flat `fixture`) and the live one (`data.fixture`).
const live = [
  { id: 'D', type: 'group', data: { fixture: 'dock' } },
  { id: 'seat', parentId: 'D', data: {} },
  { id: 'sub', parentId: 'F', data: {} },
  { id: 'F', parentId: 'D', type: 'group', data: {} },
  { id: 'out', data: {} }
]
const stored = [
  { id: 'D', kind: 'group', fixture: 'dock' },
  { id: 'seat', parentId: 'D' },
  { id: 'out' }
]

describe('dock helpers', () => {
  it('isDock reads either shape and only the literal', () => {
    expect(isDock(live[0])).toBe(true)
    expect(isDock(stored[0])).toBe(true)
    expect(isDock({ id: 'x', kind: 'group', fixture: 'Dock' })).toBe(false)
    expect(isDock({ id: 'x', type: 'group', data: { fixture: true } })).toBe(false)
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

import { dockRefusal, withoutDock } from './dock'

describe('dockRefusal: what an agent may not do to the Dock', () => {
  const nodes = [
    { id: 'D', type: 'group', data: { fixture: 'dock', pinned: true } },
    { id: 'seat', parentId: 'D', type: 'terminal', data: {} },
    { id: 'page', parentId: 'D', type: 'browser', data: {} },
    { id: 'inner', parentId: 'D', type: 'group', data: {} },
    { id: 'W', type: 'group', data: {} },
    { id: 'w1', parentId: 'W', type: 'terminal', data: {} }
  ]
  it('close: never the Dock frame, never a Dock page; the seat (a session) may close, for retire', () => {
    expect(dockRefusal(nodes, 'close', ['D'])).toMatch(/is the Dock/)
    expect(dockRefusal(nodes, 'close', ['w1', 'page'])).toMatch(/page in the Dock/)
    expect(dockRefusal(nodes, 'close', ['seat'])).toBeNull()
    expect(dockRefusal(nodes, 'close', ['w1'])).toBeNull()
  })
  it('ungroup and unpin: never the Dock', () => {
    expect(dockRefusal(nodes, 'ungroup', ['D'])).toMatch(/is the Dock/)
    expect(dockRefusal(nodes, 'unpin', ['D'])).toMatch(/is the Dock/)
    expect(dockRefusal(nodes, 'ungroup', ['W'])).toBeNull()
    expect(dockRefusal(nodes, 'unpin', ['seat'])).toBeNull()
  })
  it('move: nothing leaves the Dock and the Dock never moves; moving in or within is fine', () => {
    expect(dockRefusal(nodes, 'move', ['seat'], null)).toMatch(/out of the Dock/)
    expect(dockRefusal(nodes, 'move', ['page'], 'W')).toMatch(/out of the Dock/)
    expect(dockRefusal(nodes, 'move', ['D'], 'W')).toMatch(/is the Dock/)
    expect(dockRefusal(nodes, 'move', ['w1'], 'D', 'seat')).toBeNull()
    expect(dockRefusal(nodes, 'move', ['page'], 'inner', 'seat')).toBeNull()
  })
  it('reads the stored shape too (off-canvas and Server Edition closes)', () => {
    const stored = [
      { id: 'D', kind: 'group', fixture: 'dock' },
      { id: 'page', kind: 'sticky', parentId: 'D' }
    ]
    expect(dockRefusal(stored, 'close', ['page'])).toMatch(/page in the Dock/)
    expect(dockRefusal(stored, 'close', ['D'])).toMatch(/is the Dock/)
  })
  it('withoutDock drops the Dock frame from a list, for the human close and unpin paths', () => {
    expect(withoutDock(['seat', 'D', 'w1'], nodes)).toEqual(['seat', 'w1'])
  })
})

describe('isDock is group-only (review fix 1)', () => {
  it('a non-frame carrying the flag is not the Dock', () => {
    expect(isDock({ id: 't', type: 'terminal', data: { fixture: 'dock' } })).toBe(false)
    expect(isDock({ id: 't', kind: 'sticky', fixture: 'dock' })).toBe(false)
    expect(isDock({ id: 'x', fixture: 'dock' })).toBe(false)
  })
})

import { dockOpenRefusal } from './dock'

describe('dockOpenRefusal: a Dock member names where a new node goes (review fix 3)', () => {
  const nodes = [
    { id: 'D', type: 'group', data: { fixture: 'dock', title: 'GO' } },
    { id: 'seat', parentId: 'D', type: 'terminal', data: {} },
    { id: 'page', parentId: 'D', type: 'terminal', data: {} },
    { id: 'W', type: 'group', data: { title: 'Overnight fixes' } },
    { id: 'w1', parentId: 'W', type: 'terminal', data: {} },
    { id: 'loose', type: 'terminal', data: {} }
  ]
  it('allows an implicit open from a Dock member (kickoff open-then-group): it lands top-level', () => {
    expect(dockOpenRefusal(nodes, 'open-claude', 'seat', [], undefined)).toBeNull()
    expect(dockOpenRefusal(nodes, 'open-agent', 'loose', ['page'], undefined)).toBeNull()
    expect(dockOpenRefusal(nodes, 'open-agent', 'seat', ['w1'], undefined)).toBeNull()
  })
  it('--group <dock> only from inside the Dock', () => {
    expect(dockOpenRefusal(nodes, 'open-agent', 'seat', [], 'D')).toBeNull()
    expect(dockOpenRefusal(nodes, 'open-agent', 'w1', [], 'D')).toMatch(/only from inside the Dock/)
    expect(dockOpenRefusal(nodes, 'open-agent', 'seat', [], 'W')).toBeNull()
  })
  it('nothing to say away from the Dock', () => {
    expect(dockOpenRefusal(nodes, 'open-terminal', 'w1', [], undefined)).toBeNull()
    expect(dockOpenRefusal(nodes, 'open-terminal', 'loose', [], undefined)).toBeNull()
  })
  it('move into the Dock only by a caller inside it', () => {
    expect(dockRefusal(nodes, 'move', ['w1'], 'D', 'loose')).toMatch(/only from inside the Dock/)
    expect(dockRefusal(nodes, 'move', ['w1'], 'D', 'seat')).toBeNull()
  })
})

import { leavingDock } from './dock'

describe('leavingDock: which ids a move takes out of the Dock (review fix 4)', () => {
  const nodes = [
    { id: 'D', type: 'group', data: { fixture: 'dock' } },
    { id: 'seat', parentId: 'D', type: 'terminal', data: {} },
    { id: 'inner', parentId: 'D', type: 'group', data: {} },
    { id: 'W', type: 'group', data: {} },
    { id: 'w1', parentId: 'W', type: 'terminal', data: {} }
  ]
  it('names Dock members going outside it, and nothing else', () => {
    expect(leavingDock(nodes, ['seat', 'w1'], null)).toEqual(['seat'])
    expect(leavingDock(nodes, ['seat'], 'W')).toEqual(['seat'])
    expect(leavingDock(nodes, ['seat'], 'inner')).toEqual([])
    expect(leavingDock(nodes, ['w1'], null)).toEqual([])
  })
})
