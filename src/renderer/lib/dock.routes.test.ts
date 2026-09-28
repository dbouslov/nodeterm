import { describe, it, expect } from 'vitest'
import { planRetire } from './retire'
import { reparentNode, type CanvasNode } from '../state/workspace'
import { placeInFrame, type Box } from '@shared/placement'
import { containerJoinedBy } from '@shared/placement'

// Only IMPLICIT joining (containerJoinedBy) skips the Dock. The explicit routes still land a node
// in it: retire (the successor takes the old seat's slot and size), open with --group <dock>, and
// move into the Dock (T8 amendment A).

const node = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}, data: Record<string, unknown> = {}): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: { x, y },
    width: 640,
    height: 420,
    data: { title: id, color: '#fff', group: null, ...data },
    ...extra
  }) as CanvasNode

const scene = (): CanvasNode[] => [
  node('D', 40, 40, { type: 'group', width: 1400, height: 1100, draggable: false }, { fixture: 'dock', pinned: true }),
  node('seat', 24, 56, { parentId: 'D', extent: 'parent' }, { agentId: 'claude' }),
  node('page', 24, 536, { parentId: 'D', extent: 'parent', type: 'sticky', width: 640, height: 300 }),
  node('succ', 1700, 900, {}, { agentId: 'claude' })
]

const rootRect = (n: CanvasNode, all: CanvasNode[]) => {
  const p = n.parentId ? all.find((x) => x.id === n.parentId)! : undefined
  return {
    x: n.position.x + (p?.position.x ?? 0),
    y: n.position.y + (p?.position.y ?? 0),
    w: n.width as number,
    h: n.height as number
  }
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('Dock explicit routes', () => {
  it('retire of a Dock seat: the successor sits inside the Dock at the old rect, overlapping nothing', () => {
    const live = scene()
    const plan = planRetire({ callerId: 'seat', successorId: 'succ', live, successorElsewhere: false, kanban: undefined, grid: 0 })
    if ('error' in plan) throw new Error(plan.error)
    const after = plan.nodes.filter((n) => n.id !== 'seat') // Canvas tears the caller down
    const succ = after.find((n) => n.id === 'succ')!
    expect(succ.parentId).toBe('D')
    expect(rootRect(succ, after)).toEqual(rootRect(live[1], live))
    // The Dock kept its slot and size.
    const dock = after.find((n) => n.id === 'D')!
    expect(dock.position).toEqual({ x: 40, y: 40 })
    expect([dock.width, dock.height]).toEqual([1400, 1100])
    for (const other of after.filter((n) => n.parentId === 'D' && n.id !== 'succ')) {
      expect(overlap(rootRect(succ, after), rootRect(other, after))).toBe(false)
    }
  })

  it('open --group <dock>: the explicit slot is inside the Dock and clear of its children', () => {
    const live = scene()
    const kids: Box[] = live.filter((n) => n.parentId === 'D').map((n) => ({ ...n.position, w: n.width as number, h: n.height as number }))
    const slot = placeInFrame(kids, { w: 640, h: 420 })
    for (const k of kids) expect(overlap({ ...slot, w: 640, h: 420 }, k)).toBe(false)
    // …while the implicit join from the seat does not file into the Dock.
    expect(containerJoinedBy(live, 'seat', [])).toBeUndefined()
  })

  it('move into the Dock files the node there', () => {
    const next = reparentNode(scene(), 'succ', 'D')
    expect(next.find((n) => n.id === 'succ')!.parentId).toBe('D')
  })
})
