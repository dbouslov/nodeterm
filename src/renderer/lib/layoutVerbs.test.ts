import { describe, it, expect } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { applyCanvasMutation } from '@shared/canvas-mutations'
import { nodeStatesToFlow } from '../state/workspace'
import { planArrange, planGroup, planStoredLayout, OFF_SCREEN_LAYOUT_NOTE } from './layoutVerbs'

const stored = (id: string, x: number, y: number, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x, y },
  size: { width: 600, height: 400 },
  title: id,
  color: '#fff',
  group: null,
  ...extra
})

/** The project as the store holds it once the upserts are applied — what the next load sees. */
const applied = (states: CanvasNodeState[], upserts: CanvasNodeState[]): CanvasNodeState[] =>
  upserts.reduce((acc, node) => applyCanvasMutation(acc, { op: 'upsert', node }), states)

describe('group off screen (planStoredLayout + planGroup)', () => {
  const project = [stored('a', 0, 0), stored('b', 700, 0), stored('c', 3000, 3000)]

  it('wraps the nodes in a new frame sized from their SAVED sizes', () => {
    const plan = planStoredLayout(project, (live) => planGroup(live, { nodes: 'a,b', label: 'Night' }, undefined, 0))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const groupId = plan.result.groupId as string
    expect(plan.message).toContain(`into ${groupId}`)
    expect(plan.message).toContain(OFF_SCREEN_LAYOUT_NOTE)
    expect(plan.result.offCanvas).toBe(true)
    // The frame and the two members come back; the untouched node does not.
    expect(plan.upserts.map((n) => n.id).sort()).toEqual(['a', 'b', groupId].sort())
    const next = nodeStatesToFlow(applied(project, plan.upserts))
    const frame = next.find((n) => n.id === groupId)!
    expect(frame.type).toBe('group')
    expect(frame.data.title).toBe('Night')
    expect(next.find((n) => n.id === 'a')!.parentId).toBe(groupId)
    expect(next.find((n) => n.id === 'b')!.parentId).toBe(groupId)
    // Sized from the saved 600x400 nodes: the frame spans both (0..1300 wide) plus its padding.
    expect(frame.width as number).toBeGreaterThanOrEqual(1300)
    expect(frame.height as number).toBeGreaterThanOrEqual(400)
  })

  it('is the same plan as on screen', () => {
    const live = nodeStatesToFlow(project)
    const onScreen = planGroup(live, { nodes: 'a,b' }, '#34c759', 0)
    const off = planStoredLayout(project, (l) => planGroup(l, { nodes: 'a,b' }, '#34c759', 0))
    expect(onScreen.ok && off.ok).toBe(true)
    if (!onScreen.ok || !off.ok) return
    const frameOn = onScreen.nodes.find((n) => n.type === 'group')!
    const frameOff = nodeStatesToFlow(applied(project, off.upserts)).find((n) => n.type === 'group')!
    expect(frameOff.position).toEqual(frameOn.position)
    expect([frameOff.width, frameOff.height]).toEqual([frameOn.width, frameOn.height])
    expect(frameOff.data.color).toBe('#34c759')
  })

  it('refuses the same way, and writes nothing', () => {
    const plan = planStoredLayout(project, (live) => planGroup(live, { nodes: 'x,y' }, undefined, 0))
    expect(plan).toEqual({ ok: false, error: 'group: none of the given node ids exist' })
  })
})

describe('arrange / align off screen', () => {
  const project = [
    stored('f', 0, 0, { kind: 'group', size: { width: 3000, height: 3000 } }),
    stored('a', 2000, 40, { parentId: 'f' }),
    stored('b', 40, 1800, { parentId: 'f' }),
    stored('far', 5000, 0)
  ]

  it('lays a frame\'s children out from their saved sizes and shrinks the frame to hug them', () => {
    const plan = planStoredLayout(project, (live) => planArrange(live, 'arrange', { nodes: 'a,b', layout: 'row' }, 0))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.message).toMatch(/^arranged 2 node\(s\) as row/)
    expect(plan.message).toContain(OFF_SCREEN_LAYOUT_NOTE)
    const next = nodeStatesToFlow(applied(project, plan.upserts))
    const a = next.find((n) => n.id === 'a')!
    const b = next.find((n) => n.id === 'b')!
    expect(a.position.y).toBe(b.position.y)
    // Row by saved width: b starts one saved width (600) plus the gap after a.
    expect(b.position.x - a.position.x).toBe(640)
    const f = next.find((n) => n.id === 'f')!
    expect(f.width as number).toBeLessThan(3000)
    expect(f.height as number).toBeLessThan(3000)
  })

  it('align refuses without an edge, and refuses a mixed container', () => {
    expect(planStoredLayout(project, (l) => planArrange(l, 'align', { nodes: 'a,b' }, 0))).toEqual({
      ok: false,
      error: 'align requires --edge left|right|top|bottom|hcenter|vcenter'
    })
    const mixed = planStoredLayout(project, (l) => planArrange(l, 'arrange', { nodes: 'a,far' }, 0))
    expect(mixed.ok).toBe(false)
  })

  it('aligns to an edge', () => {
    const plan = planStoredLayout(project, (l) => planArrange(l, 'align', { nodes: 'a,b', edge: 'left' }, 0))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const next = nodeStatesToFlow(applied(project, plan.upserts))
    expect(next.find((n) => n.id === 'a')!.position.x).toBe(next.find((n) => n.id === 'b')!.position.x)
  })
})
