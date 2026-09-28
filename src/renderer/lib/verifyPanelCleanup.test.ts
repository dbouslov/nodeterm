import { describe, it, expect } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { applyMutationToFlow, nodeStatesToFlow, type CanvasNode } from '../state/workspace'
import { emptiedVerifyPanels, isVerifyPanelFrame, pruneEmptyVerifyPanels } from './verifyPanelCleanup'

const state = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  title: id,
  color: '#fff',
  group: null,
  ...extra
})
const frame = (id: string, title: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState =>
  state(id, { kind: 'group', title, ...extra })

const live = (states: CanvasNodeState[]): CanvasNode[] => nodeStatesToFlow(states)

describe('isVerifyPanelFrame', () => {
  it('is a group marked verifyPanel, or a legacy group titled "Verify: …"', () => {
    expect(isVerifyPanelFrame({ type: 'group', data: { verifyPanel: true, title: 'Review round' } })).toBe(true)
    expect(isVerifyPanelFrame({ type: 'group', data: { title: 'Verify: GO' } })).toBe(true)
    expect(isVerifyPanelFrame({ type: 'group', data: { title: 'GO' } })).toBe(false)
    // Only a literal true marks; the title rule is a prefix, not a substring.
    expect(isVerifyPanelFrame({ type: 'group', data: { verifyPanel: 'yes', title: 'x' } })).toBe(false)
    expect(isVerifyPanelFrame({ type: 'group', data: { title: 'Please Verify: x' } })).toBe(false)
    // A session node titled like a panel is not a frame.
    expect(isVerifyPanelFrame({ type: 'terminal', data: { title: 'Verify: verdict' } })).toBe(false)
  })
})

describe('emptiedVerifyPanels — a panel frame dissolves when its last member closes', () => {
  const canvas = live([
    frame('go', 'GO'),
    frame('vp', 'Verify: GO', { parentId: 'go', verifyPanel: true }),
    state('r1', { parentId: 'vp' }),
    state('r2', { parentId: 'vp' }),
    frame('legacy', 'Verify: old', { parentId: 'go' }),
    state('r3', { parentId: 'legacy' }),
    frame('user', 'Mine'),
    state('u1', { parentId: 'user' })
  ])

  it('names the panel frame once every member is closed', () => {
    expect(emptiedVerifyPanels(canvas, new Set(['r1', 'r2']))).toEqual(['vp'])
  })

  it('keeps a panel frame that still holds a member', () => {
    expect(emptiedVerifyPanels(canvas, new Set(['r1']))).toEqual([])
  })

  it('dissolves a legacy "Verify: " frame the close emptied', () => {
    expect(emptiedVerifyPanels(canvas, new Set(['r3']))).toEqual(['legacy'])
  })

  it('never dissolves a user frame the close emptied, nor the frame a panel sat in', () => {
    expect(emptiedVerifyPanels(canvas, new Set(['u1']))).toEqual([])
    expect(emptiedVerifyPanels(canvas, new Set(['r1', 'r2', 'r3']))).toEqual(['vp', 'legacy'])
  })

  it('does not name a frame that is itself being closed', () => {
    expect(emptiedVerifyPanels(canvas, new Set(['vp', 'r1', 'r2']))).toEqual([])
  })

  it('leaves an unrelated empty panel frame to the load prune', () => {
    const c = live([frame('vp', 'Verify: x', { verifyPanel: true }), frame('vq', 'Verify: y'), state('a', { parentId: 'vq' })])
    expect(emptiedVerifyPanels(c, new Set(['a']))).toEqual(['vq'])
  })
})

describe('pruneEmptyVerifyPanels — on load, empty panel frames go', () => {
  it('drops empty marked and legacy panel frames, keeps every frame with a child and every user frame', () => {
    const kept = pruneEmptyVerifyPanels([
      frame('go', 'GO'),
      frame('vp', 'Verify: a', { parentId: 'go', verifyPanel: true }),
      frame('legacy', 'Verify: b', { parentId: 'go' }),
      frame('full', 'Verify: c', { parentId: 'go', verifyPanel: true }),
      state('r', { parentId: 'full' }),
      frame('marked', 'Round 2', { verifyPanel: true }),
      frame('empty-user', 'Scratch')
    ])
    expect(kept.map((n) => n.id)).toEqual(['go', 'full', 'r', 'empty-user'])
  })

  it('drops a panel frame whose only child was an empty panel frame', () => {
    const kept = pruneEmptyVerifyPanels([
      frame('outer', 'Verify: outer', { verifyPanel: true }),
      frame('inner', 'Verify: inner', { parentId: 'outer', verifyPanel: true })
    ])
    expect(kept).toEqual([])
  })

  it('returns the same array when there is nothing to prune', () => {
    const states = [frame('go', 'GO'), state('a', { parentId: 'go' })]
    expect(pruneEmptyVerifyPanels(states)).toBe(states)
  })

  it('is not part of nodeStatesToFlow, which also hydrates ONE node at a time', () => {
    // A single frame state has no children in its own array; pruning there dropped it.
    const nodes = nodeStatesToFlow([frame('vp', 'Verify: a', { verifyPanel: true })])
    expect(nodes.map((n) => n.id)).toEqual(['vp'])
  })
})

describe('a peer upsert of a verify panel frame (applyMutationToFlow hydrates one node)', () => {
  const vp = frame('vp', 'Verify: GO', { verifyPanel: true })
  const canvas = live([vp, state('r1', { parentId: 'vp' })])

  it('updates an existing panel frame', () => {
    const next = applyMutationToFlow(canvas, { op: 'upsert', node: { ...vp, title: 'Verify: GO (round 2)' } })
    expect(next.find((n) => n.id === 'vp')!.data.title).toBe('Verify: GO (round 2)')
  })

  it('appends a new panel frame', () => {
    const next = applyMutationToFlow(canvas, { op: 'upsert', node: frame('vq', 'Verify: other', { verifyPanel: true }) })
    expect(next.some((n) => n.id === 'vq')).toBe(true)
  })
})
