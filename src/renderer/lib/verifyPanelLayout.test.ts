import { describe, it, expect } from 'vitest'
import { ROW_GAP } from '@shared/placement'
import { flowToNodeStates, nodeStatesToFlow, rootPosition, type CanvasNode } from '../state/workspace'
import { layoutTeamFrame, layoutVerifyPanel } from './verifyPanelLayout'

const node = (id: string, x: number, y: number, w: number, h: number, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: { x, y },
    width: w,
    height: h,
    style: { width: w, height: h },
    data: { title: id, color: '#fff', group: null },
    ...extra
  }) as CanvasNode

const frame = (id: string, x: number, y: number, w: number, h: number, title = id, parentId?: string): CanvasNode =>
  node(id, x, y, w, h, {
    type: 'group',
    data: { title, color: '#fff', group: null },
    ...(parentId ? { parentId, extent: 'parent' as const } : {})
  })

const child = (id: string, parentId: string, x: number, y: number, w: number, h: number): CanvasNode =>
  node(id, x, y, w, h, { parentId, extent: 'parent' })

const member = (id: string): CanvasNode => node(id, 0, 0, 600, 400)
/** A `verify` reviewer as Canvas makes one: titled `Verify: <lens>`, which is what a reuse checks. */
const reviewer = (id: string): CanvasNode => node(id, 0, 0, 600, 400, { data: { title: `Verify: ${id}`, color: '#fff', group: null } })

type R = { x: number; y: number; w: number; h: number }
const rectOf = (n: CanvasNode, all: CanvasNode[]): R => ({
  ...rootPosition(n, all),
  w: n.width as number,
  h: n.height as number
})
const intersects = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (a: R, b: R) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/** Every pair of siblings (same container) that overlaps, by id. */
function overlaps(all: CanvasNode[]): string[] {
  const out: string[] = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      if ((a.parentId ?? null) !== (b.parentId ?? null)) continue
      if (intersects(rectOf(a, all), rectOf(b, all))) out.push(`${a.id}×${b.id}`)
    }
  }
  return out
}
/** Every node sticking out of its frame. */
function strays(all: CanvasNode[]): string[] {
  return all
    .filter((n) => n.parentId)
    .filter((n) => !inside(rectOf(n, all), rectOf(all.find((p) => p.id === n.parentId)!, all)))
    .map((n) => n.id)
}

describe('layoutVerifyPanel — a review panel never lands on anything', () => {
  // The field shape: the caller sits inside its orchestrator frame, with a neighbour frame to the
  // right and a node below. The panel used to be wrapped as a TOP-LEVEL frame placed below the
  // caller, i.e. on top of the caller's own frame.
  const canvas = (): CanvasNode[] => [
    frame('go', 0, 0, 700, 560, 'General Orchestrator'),
    child('caller', 'go', 28, 62, 600, 400),
    frame('side', 800, 0, 700, 560, 'Side'),
    child('s1', 'side', 28, 62, 600, 400),
    node('below', 0, 700, 600, 400)
  ]

  it('nests the panel in the caller\'s frame, which grows, and moves its neighbours out of the way', () => {
    const start = [...canvas(), member('r1'), member('r2'), member('r3')]
    const { nodes, groupId, reused } = layoutVerifyPanel(start, {
      srcId: 'caller',
      panelIds: ['r1', 'r2', 'r3'],
      label: 'Verify: Build'
    })
    expect(reused).toBe(false)
    const g = nodes.find((n) => n.id === groupId)!
    expect(g.type).toBe('group')
    expect(g.data.title).toBe('Verify: Build')
    expect(g.parentId).toBe('go')
    for (const id of ['r1', 'r2', 'r3']) expect(nodes.find((n) => n.id === id)!.parentId).toBe(groupId)
    expect(overlaps(nodes)).toEqual([])
    expect(strays(nodes)).toEqual([])
  })

  it('sits directly below the caller inside its frame, not below the whole frame', () => {
    // Treating the caller's own frame as an obstacle would push the panel below that frame.
    const start = [frame('go', 0, 0, 700, 560, 'General Orchestrator'), child('caller', 'go', 28, 62, 600, 400), member('r1'), member('r2')]
    const { nodes, groupId } = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1', 'r2'], label: 'Verify: Build' })
    const callerR = rectOf(nodes.find((n) => n.id === 'caller')!, nodes)
    const gR = rectOf(nodes.find((n) => n.id === groupId)!, nodes)
    expect(gR.x).toBe(callerR.x)
    expect(gR.y - (callerR.y + callerR.h)).toBeGreaterThanOrEqual(0)
    expect(gR.y - (callerR.y + callerR.h)).toBeLessThanOrEqual(ROW_GAP)
  })

  it('a re-verify with the same label reuses the earlier panel frame instead of stacking a new one', () => {
    const first = layoutVerifyPanel([...canvas(), reviewer('r1'), reviewer('r2')], {
      srcId: 'caller',
      panelIds: ['r1', 'r2'],
      label: 'Verify: Build'
    })
    const second = layoutVerifyPanel([...first.nodes, reviewer('q1'), reviewer('q2')], {
      srcId: 'caller',
      panelIds: ['q1', 'q2'],
      label: 'Verify: Build'
    })
    expect(second.reused).toBe(true)
    expect(second.groupId).toBe(first.groupId)
    expect(second.nodes.filter((n) => n.type === 'group' && n.data.title === 'Verify: Build')).toHaveLength(1)
    for (const id of ['r1', 'r2', 'q1', 'q2']) expect(second.nodes.find((n) => n.id === id)!.parentId).toBe(first.groupId)
    expect(overlaps(second.nodes)).toEqual([])
    expect(strays(second.nodes)).toEqual([])
  })

  it('never takes over a frame it did not make, even one with the same title', () => {
    // The user's own frame (or a team, or a worktree frame) that happens to carry the label.
    const start = [...canvas(), frame('mine', 28, 500, 600, 300, 'Verify: Build', 'go'), member('r1')]
    const { groupId, reused, nodes } = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1'], label: 'Verify: Build' })
    expect(reused).toBe(false)
    expect(groupId).not.toBe('mine')
    expect(nodes.filter((n) => n.parentId === 'mine')).toEqual([])
  })

  it('never reuses a marked frame with no member: the reviewer check has nothing to judge', () => {
    // An empty marked frame (e.g. a team frame restored empty) proves nothing about who made it.
    const empty = frame('empty', 28, 500, 600, 300, 'Verify: Build', 'go')
    const start = [...canvas(), { ...empty, data: { ...empty.data, verifyPanel: true } }, reviewer('r1')]
    const { groupId, reused } = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1'], label: 'Verify: Build' })
    expect(reused).toBe(false)
    expect(groupId).not.toBe('empty')
  })

  it('marks the panel frame, and the mark survives a save and reload, so the next round still reuses it', () => {
    const first = layoutVerifyPanel([...canvas(), reviewer('r1')], { srcId: 'caller', panelIds: ['r1'], label: 'Verify: Build' })
    expect(first.nodes.find((n) => n.id === first.groupId)!.data.verifyPanel).toBe(true)
    const reloaded = nodeStatesToFlow(flowToNodeStates(first.nodes)) as CanvasNode[]
    const second = layoutVerifyPanel([...reloaded, reviewer('q1')], { srcId: 'caller', panelIds: ['q1'], label: 'Verify: Build' })
    expect(second.reused).toBe(true)
    expect(second.groupId).toBe(first.groupId)
  })

  it('does not reuse a panel frame whose growth would run over a pinned node; it opens a new one', () => {
    const start = [node('caller', 0, 0, 600, 400), member('r1')]
    const first = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1'], label: 'Verify: Build' })
    const g = rectOf(first.nodes.find((n) => n.id === first.groupId)!, first.nodes)
    // Pinned, right under the earlier panel frame: a new round below the old one would cover it,
    // and settle cannot move a pinned node out of the way.
    const pinned = node('pin', g.x, g.y + g.h + 40, 600, 400, { data: { title: 'pin', color: '#fff', group: null, pinned: true } })
    const second = layoutVerifyPanel([...first.nodes, pinned, member('q1')], {
      srcId: 'caller',
      panelIds: ['q1'],
      label: 'Verify: Build'
    })
    expect(second.reused).toBe(false)
    expect(second.nodes.find((n) => n.id === 'pin')!.position).toEqual(pinned.position)
    expect(overlaps(second.nodes)).toEqual([])
  })

  it('a different label opens a second panel frame beside the first, overlapping nothing', () => {
    const first = layoutVerifyPanel([...canvas(), member('r1')], { srcId: 'caller', panelIds: ['r1'], label: 'Verify: A' })
    const second = layoutVerifyPanel([...first.nodes, member('q1')], { srcId: 'caller', panelIds: ['q1'], label: 'Verify: B' })
    expect(second.reused).toBe(false)
    expect(second.groupId).not.toBe(first.groupId)
    expect(overlaps(second.nodes)).toEqual([])
    expect(strays(second.nodes)).toEqual([])
  })

  it('a top-level caller gets a top-level panel that clears every other node', () => {
    const start = [
      node('caller', 0, 0, 600, 400),
      node('below', 0, 500, 600, 400),
      frame('f', 700, 480, 700, 560),
      member('r1'),
      member('r2'),
      member('r3')
    ]
    const { nodes, groupId } = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1', 'r2', 'r3'], label: 'Verify: X' })
    expect(nodes.find((n) => n.id === groupId)!.parentId).toBeUndefined()
    expect(overlaps(nodes)).toEqual([])
  })

  it('places the WHOLE panel box, not just its first member, clear of a node beside the first slot', () => {
    // The first member-sized slot below the caller is clear; the two-column grid and its frame are
    // not, because `right` sits beside that slot.
    const start = [node('caller', 0, 0, 600, 400), node('right', 700, 480, 600, 400), member('r1'), member('r2'), member('r3')]
    const { nodes } = layoutVerifyPanel(start, { srcId: 'caller', panelIds: ['r1', 'r2', 'r3'], label: 'Verify: X' })
    expect(overlaps(nodes)).toEqual([])
  })
})

describe('layoutTeamFrame — spawn-team uses the same placement, never reuse', () => {
  const canvas = (): CanvasNode[] => [
    frame('go', 0, 0, 700, 560, 'General Orchestrator'),
    child('caller', 'go', 28, 62, 600, 400),
    node('below', 0, 700, 600, 400)
  ]

  it('nests the team frame in the caller\'s frame, overlapping nothing', () => {
    const { nodes, groupId } = layoutTeamFrame([...canvas(), member('m1'), member('m2')], {
      srcId: 'caller',
      panelIds: ['m1', 'm2'],
      label: 'Team'
    })
    const g = nodes.find((n) => n.id === groupId)!
    expect(g.parentId).toBe('go')
    expect(g.data.title).toBe('Team')
    // Marked, so the frame dissolves with its last member (verifyPanelCleanup); never reused.
    expect(g.data.verifyPanel).toBe(true)
    expect(overlaps(nodes)).toEqual([])
    expect(strays(nodes)).toEqual([])
  })

  it('a second team with the same label gets its own frame', () => {
    const first = layoutTeamFrame([...canvas(), member('m1')], { srcId: 'caller', panelIds: ['m1'], label: 'Team' })
    const second = layoutTeamFrame([...first.nodes, member('m2')], { srcId: 'caller', panelIds: ['m2'], label: 'Team' })
    expect(second.groupId).not.toBe(first.groupId)
    expect(overlaps(second.nodes)).toEqual([])
    expect(strays(second.nodes)).toEqual([])
  })
})
