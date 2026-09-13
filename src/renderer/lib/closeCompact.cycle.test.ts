import { describe, it, expect, vi } from 'vitest'
import type { CanvasNode } from '../state/workspace'

// The walk up in `applyCompaction` re-queues a frame's parent whenever the frame changes size. On
// a parentId CYCLE (a hand-edited project.json) each frame's re-fit grows the other, so an
// unguarded walk never ends — and a sync infinite loop is one no vitest timeout can interrupt: it
// would hang the whole run. So this file counts the re-fits the walk makes, and a runaway walk
// throws instead of spinning. Its own file, so the mock touches no other test.
const refits = vi.hoisted(() => ({ n: 0 }))
vi.mock('../state/workspace', async (importOriginal) => {
  const real = await importOriginal<typeof import('../state/workspace')>()
  return {
    ...real,
    fitGroupToChildren: (...args: Parameters<typeof real.fitGroupToChildren>) => {
      if (++refits.n > 100) throw new Error('the walk up did not end (100 re-fits)')
      return real.fitGroupToChildren(...args)
    }
  }
})

import { applyCompaction, planCompaction } from './closeCompact'

const node = (id: string, x: number, y: number, parentId: string, type = 'terminal', w = 100, h = 50): CanvasNode =>
  ({ id, type, position: { x, y }, width: w, height: h, parentId, data: { title: id, color: '#fff', group: null } }) as CanvasNode

describe('close --compact on a parentId cycle', () => {
  it('ends: each frame is re-laid out at most once', () => {
    // F1 and F2 are each other's parent; c (closed) and k sit in F1.
    const before = [
      node('F1', 0, 0, 'F2', 'group', 200, 200),
      node('F2', 28, 62, 'F1', 'group', 200, 200),
      node('c', 268, 62, 'F1'),
      node('k', 28, 302, 'F1')
    ]
    const plan = planCompaction(before, ['c'])
    expect(plan.frames).toEqual(['F1'])
    const out = applyCompaction(before.filter((x) => x.id !== 'c'), plan)
    expect(out.map((x) => x.id).sort()).toEqual(['F1', 'F2', 'k'])
    expect(refits.n).toBe(2)
  })
})
