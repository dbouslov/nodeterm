import { describe, it, expect } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { applyCanvasMutation } from '@shared/canvas-mutations'
import { nodeStatesToFlow, removeNodesFreeingChildren } from '../state/workspace'
import { applyCompaction, compactNote, planCompaction, planStoredCompaction } from './closeCompact'

const state = (id: string, x: number, y: number, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x, y },
  size: { width: 100, height: 50 },
  title: id,
  color: '#fff',
  group: null,
  ...extra
})

/** A 2x2 frame, arranged with the `arrange` gap (40), plus an unrelated node. */
const project = (): CanvasNodeState[] => [
  state('g', 100, 100, { kind: 'group', size: { width: 296, height: 242 } }),
  state('a', 28, 62, { parentId: 'g' }),
  state('b', 168, 62, { parentId: 'g' }),
  state('c', 28, 152, { parentId: 'g' }),
  state('d', 168, 152, { parentId: 'g' }),
  state('far', 2000, 2000)
]

/** What the off-screen close does to the store: `removeNodes`, then the compaction's upserts. */
function closeOffScreen(states: CanvasNodeState[], ids: string[], grid = 0) {
  const plan = planStoredCompaction(states, ids, grid)
  const removed = removeNodesFreeingChildren(states, new Set(ids))
  const stored = plan.upserts.reduce((acc, node) => applyCanvasMutation(acc, { op: 'upsert', node }), removed)
  return { plan, next: nodeStatesToFlow(stored) }
}

describe('close --compact off screen (planStoredCompaction)', () => {
  it('re-packs the frame from the saved sizes, exactly as on screen', () => {
    const { plan, next } = closeOffScreen(project(), ['b'])
    // On screen: the same plan over the same nodes, measured at the sizes they were saved at.
    const before = nodeStatesToFlow(project())
    const on = applyCompaction(removeNodesFreeingChildren(before, new Set(['b'])), planCompaction(before, ['b']))
    for (const id of ['g', 'a', 'c', 'd']) {
      const off = next.find((n) => n.id === id)!
      const live = on.find((n) => n.id === id)!
      expect([off.position, off.width, off.height], id).toEqual([live.position, live.width, live.height])
    }
    // d moved up into b's slot: the hole is gone.
    expect(next.find((n) => n.id === 'd')!.position).toEqual({ x: 28, y: 152 })
    expect(next.find((n) => n.id === 'c')!.position).toEqual({ x: 168, y: 62 })
    expect(plan.note).toBe(compactNote(plan.plan))
    expect(plan.note).toContain('re-packed g')
  })

  it('writes back only the nodes the compaction changed', () => {
    const { plan } = closeOffScreen(project(), ['b'])
    expect(plan.upserts.map((n) => n.id).sort()).toEqual(['c', 'd', 'g'])
  })

  it('writes back a node that only moved up, and a frame that only shrank', () => {
    // Closing the top row pulls the bottom row straight up: x is unchanged for both.
    const { plan, next } = closeOffScreen(project(), ['a', 'b'])
    expect(plan.upserts.map((n) => n.id).sort()).toEqual(['c', 'd', 'g'])
    expect(next.find((n) => n.id === 'c')!.position).toEqual({ x: 28, y: 62 })
    expect(next.find((n) => n.id === 'd')!.position).toEqual({ x: 168, y: 62 })
  })

  it('writes nothing when no frame held a closed node', () => {
    const { plan } = closeOffScreen(project(), ['far'])
    expect(plan.upserts).toEqual([])
    expect(plan.note).toBe(' — compact: no frame held these nodes')
  })

  it('names a verify panel frame the close dissolved, instead of telling the caller to ungroup it', () => {
    const states = [
      state('vp', 0, 0, { kind: 'group', title: 'Verify: GO', verifyPanel: true }),
      state('r1', 28, 62, { parentId: 'vp' })
    ]
    const { plan } = closeOffScreen(states, ['r1'])
    expect(plan.note).not.toContain('ungroup')
    expect(plan.note).toContain('removed the empty verify panel frame vp')
  })
})
