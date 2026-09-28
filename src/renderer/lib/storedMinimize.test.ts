import { describe, it, expect } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { COLLAPSED_HEIGHT, nodeStatesToFlow } from '../state/workspace'
import { planStoredMinimize } from './storedMinimize'

const stored = (
  id: string,
  kind: CanvasNodeState['kind'],
  h: number,
  extra: Partial<CanvasNodeState> = {}
): CanvasNodeState => ({
  id,
  kind,
  position: { x: 0, y: 0 },
  size: { width: 400, height: h },
  title: id,
  color: '#fff',
  group: null,
  ...extra
})

describe('planStoredMinimize — minimize while the project is off screen', () => {
  it('sets the saved collapsed flag and keeps the expanded height as the saved size', () => {
    const plan = planStoredMinimize([stored('a', 'terminal', 420), stored('b', 'terminal', 300)], ['a'], true)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.change).toEqual(['a'])
    expect(plan.upserts).toHaveLength(1)
    const a = plan.upserts[0]
    expect(a.id).toBe('a')
    expect(a.collapsed).toBe(true)
    // The stored size is ALWAYS the expanded one (flowToNodeStates): a restore needs it back.
    expect(a.size.height).toBe(420)
    // And the next load draws it as a title bar with the height it came from remembered.
    const [live] = nodeStatesToFlow([a])
    expect(live.height).toBe(COLLAPSED_HEIGHT)
    expect(live.data.expandedHeight).toBe(420)
  })

  it('restores a collapsed node to the height it had', () => {
    const plan = planStoredMinimize([stored('a', 'sticky', 500, { collapsed: true })], ['a'], false)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.upserts[0].collapsed).toBeFalsy()
    expect(plan.upserts[0].size.height).toBe(500)
  })

  it('writes back only the nodes it changed; a node already in the asked state is reported, not rewritten', () => {
    const plan = planStoredMinimize(
      [stored('a', 'terminal', 420, { collapsed: true }), stored('b', 'files', 300), stored('c', 'terminal', 200)],
      ['a', 'b'],
      true
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.change).toEqual(['b'])
    expect(plan.already).toEqual(['a'])
    expect(plan.upserts.map((n) => n.id)).toEqual(['b'])
  })

  it('refuses the whole list with the on-screen wording (unknown id, frame)', () => {
    const nodes = [stored('g', 'group', 800), stored('a', 'terminal', 420)]
    const unknown = planStoredMinimize(nodes, ['a', 'zz'], true)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain('zz')
    const frame = planStoredMinimize(nodes, ['a', 'g'], true)
    expect(frame.ok).toBe(false)
    if (!frame.ok) expect(frame.error).toContain('group frames do not minimize')
  })
})
