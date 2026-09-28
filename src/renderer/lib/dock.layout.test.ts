import { describe, it, expect } from 'vitest'
import { planArrange } from './layoutVerbs'
import { restructureNodes } from './restructure'
import type { CanvasNode } from '../state/workspace'

// Arrange, align and restructure (the tidy verb) never move the Dock, and never lay a node over it.

const n = (id: string, x: number, y: number, extra: Partial<CanvasNode> = {}, data: Record<string, unknown> = {}): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: { x, y },
    width: 600,
    height: 400,
    data: { title: id, color: '#fff', group: null, ...data },
    ...extra
  }) as CanvasNode

const DOCK = { x: 40, y: 40, w: 1400, h: 1100 }
const scene = (): CanvasNode[] => [
  n('D', DOCK.x, DOCK.y, { type: 'group', width: DOCK.w, height: DOCK.h, draggable: false }, { fixture: 'dock', pinned: true }),
  n('seat', 24, 56, { parentId: 'D', extent: 'parent' }),
  n('page', 24, 536, { parentId: 'D', extent: 'parent' }),
  n('a', 1600, 40),
  n('b', 0, 1300),
  n('c', 1600, 700)
]
const onDock = (x: CanvasNode) =>
  !x.parentId &&
  x.id !== 'D' &&
  x.position.x < DOCK.x + DOCK.w &&
  DOCK.x < x.position.x + (x.width as number) &&
  x.position.y < DOCK.y + DOCK.h &&
  DOCK.y < x.position.y + (x.height as number)
const dockOf = (ns: CanvasNode[]) => ns.find((x) => x.id === 'D')!
const unmoved = (ns: CanvasNode[]) => {
  const d = dockOf(ns)
  expect(d.position).toEqual({ x: DOCK.x, y: DOCK.y })
  expect([d.width, d.height]).toEqual([DOCK.w, DOCK.h])
  for (const id of ['seat', 'page']) expect(ns.find((x) => x.id === id)!.position).toEqual(scene().find((x) => x.id === id)!.position)
}

describe('layout verbs and the Dock', () => {
  it.each([
    ['arrange grid over the Dock and its neighbours', 'arrange', { nodes: 'D,a,b,c' }],
    ['arrange row', 'arrange', { nodes: 'a,b,c', layout: 'row' }],
    ['align left', 'align', { nodes: 'a,b', edge: 'left' }],
    ['align top', 'align', { nodes: 'b,c', edge: 'top' }],
    ['arrange the Dock children', 'arrange', { nodes: 'seat,page', layout: 'row' }]
  ] as const)('%s: the Dock never moves and nothing lands on it', (_name, verb, args) => {
    const plan = planArrange(scene(), verb, args, 0)
    if (!plan.ok) {
      expect(plan.error).toMatch(/Dock/)
      return
    }
    unmoved(plan.nodes)
    expect(plan.nodes.filter(onDock).map((x) => x.id)).toEqual([])
  })

  it('restructure (tidy): the Dock never moves and nothing lands on it', () => {
    const out = restructureNodes(scene(), [])
    unmoved(out)
    expect(out.filter(onDock).map((x) => x.id)).toEqual([])
  })
})
