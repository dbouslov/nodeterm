import { describe, it, expect } from 'vitest'
import { fitGroupToChildren, rootPosition, type CanvasNode } from '../state/workspace'
import { assignNode, assignedTo, defaultKanban } from './kanban'
import { planRetire, type RetirePlan } from './retire'

const term = (id: string, x: number, y: number, w: number, h: number, parentId?: string): CanvasNode =>
  ({
    id,
    type: 'terminal',
    position: { x, y },
    width: w,
    height: h,
    style: { width: w, height: h },
    ...(parentId ? { parentId, extent: 'parent' } : {}),
    data: { title: id, color: '#fff', group: null }
  }) as CanvasNode

const frame = (id: string, x: number, y: number, w: number, h: number, pinned = false): CanvasNode =>
  ({
    id,
    type: 'group',
    position: { x, y },
    width: w,
    height: h,
    style: { width: w, height: h },
    data: { title: id, color: '#fff', group: null, ...(pinned ? { pinned: true } : {}) }
  }) as CanvasNode

const plan = (live: CanvasNode[], over: Partial<Parameters<typeof planRetire>[0]> = {}): RetirePlan =>
  planRetire({
    callerId: 'caller',
    successorId: 'succ',
    live,
    successorElsewhere: false,
    kanban: undefined,
    grid: 0,
    ...over
  })

const applied = (r: RetirePlan) => {
  if ('error' in r) throw new Error(r.error)
  return r
}
const byId = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((n) => n.id === id)!

describe('planRetire — the successor takes the caller\'s place', () => {
  it('takes the caller\'s exact x, y, width, height and parent frame', () => {
    const live = [frame('g1', 0, 0, 1000, 800), term('caller', 40, 60, 640, 420, 'g1'), term('succ', 2000, 100, 300, 200)]
    const { nodes } = applied(plan(live))
    const succ = byId(nodes, 'succ')
    // Exactly where the caller is on screen. g1 is unpinned, so it is refit as `move` refits (the
    // frame re-anchors and both children shift with it) — the caller's ROOT position is the fixed point.
    expect(rootPosition(succ, nodes)).toEqual({ x: 40, y: 60 })
    expect(succ.position).toEqual(byId(nodes, 'caller').position)
    expect(succ.width).toBe(640)
    expect(succ.height).toBe(420)
    expect(succ.style).toMatchObject({ width: 640, height: 420 })
    expect(succ.parentId).toBe('g1')
    // React Flow needs a frame before its children.
    expect(nodes.findIndex((n) => n.id === 'g1')).toBeLessThan(nodes.findIndex((n) => n.id === 'succ'))
    // The caller is left for the canvas's own teardown (deleteNodes).
    expect(byId(nodes, 'caller')).toBeDefined()
  })

  it('a top-level caller pulls a framed successor out to the top level', () => {
    const live = [
      frame('g2', 500, 500, 400, 300),
      term('succ', 20, 20, 300, 200, 'g2'),
      term('other', 20, 240, 100, 50, 'g2'),
      term('caller', 10, 10, 640, 420)
    ]
    const succ = byId(applied(plan(live)).nodes, 'succ')
    expect(succ.parentId).toBeUndefined()
    expect(succ.position).toEqual({ x: 10, y: 10 })
    expect([succ.width, succ.height]).toEqual([640, 420])
  })

  it('refits the frame the successor left, as `move` does', () => {
    const live = [
      frame('g2', 500, 500, 400, 300),
      term('succ', 20, 20, 300, 200, 'g2'),
      term('other', 20, 240, 100, 50, 'g2'),
      term('caller', 10, 10, 640, 420)
    ]
    const g2 = byId(applied(plan(live)).nodes, 'g2')
    // It now hugs `other` alone, so it is smaller than the 400×300 it was sized for two.
    expect(g2.width).toBeLessThan(400)
    expect(g2.height).toBeLessThan(300)
  })

  it('never grows a pinned frame, even where a `move` refit would', () => {
    // `other` overflows its pinned 100×100 frame, so fitGroupToChildren's pinned branch would GROW
    // the frame. Retire only ever shrinks a pinned one.
    const live = [
      frame('g2', 500, 500, 100, 100, true),
      term('succ', 10, 10, 50, 50, 'g2'),
      term('other', 20, 20, 300, 200, 'g2'),
      term('caller', 10, 10, 640, 420)
    ]
    const g2 = byId(applied(plan(live)).nodes, 'g2')
    expect([g2.position, g2.width, g2.height]).toEqual([{ x: 500, y: 500 }, 100, 100])
  })

  it('a pinned frame that grew for the successor ends at its pre-successor size and position', () => {
    // The orchestrator flow: the caller opens its successor INSIDE its own pinned frame
    // (`--group`), the frame grows in place to take it, then the caller retires into it.
    const pinned = frame('p', 300, 200, 1, 1, true)
    const caller = term('caller', 20, 40, 600, 400, 'p')
    const other = term('other', 20, 460, 600, 400, 'p')
    const before = fitGroupToChildren([pinned, caller, other], 'p')
    const beforeFrame = byId(before, 'p')
    const grown = fitGroupToChildren([...before, term('succ', 640, 40, 600, 400, 'p')], 'p')
    expect(byId(grown, 'p').width).toBeGreaterThan(beforeFrame.width as number)

    const { nodes } = applied(plan(grown))
    const after = byId(nodes, 'p')
    expect([after.position, after.width, after.height]).toEqual([
      beforeFrame.position,
      beforeFrame.width,
      beforeFrame.height
    ])
    expect(after.style).toMatchObject({ width: beforeFrame.width, height: beforeFrame.height })
    // Nothing inside moved: the successor sits exactly where the caller did, `other` stayed put.
    expect(byId(nodes, 'succ').position).toEqual({ x: 20, y: 40 })
    expect(byId(nodes, 'other').position).toEqual({ x: 20, y: 460 })
  })
})

describe('planRetire — the successor inherits the caller\'s kanban column', () => {
  const live = [term('caller', 0, 0, 600, 400), term('succ', 700, 0, 600, 400)]

  it('files the successor in the caller\'s column, in the caller\'s slot', () => {
    let k = defaultKanban()
    const [todo, doing] = k.columns
    for (const id of ['a', 'caller', 'b']) k = assignNode(k, id, doing.id, null)
    k = assignNode(k, 'succ', todo.id, null)
    const { kanban } = applied(plan(live, { kanban: k }))
    expect(assignedTo(kanban!, doing.id)).toEqual(['a', 'succ', 'b'])
    expect(assignedTo(kanban!, todo.id)).toEqual([])
  })

  it('an Ungrouped caller sends the successor to Ungrouped', () => {
    let k = defaultKanban()
    k = assignNode(k, 'succ', k.columns[0].id, null)
    const { kanban } = applied(plan(live, { kanban: k }))
    expect(kanban!.assignments.some((a) => a.nodeId === 'succ')).toBe(false)
  })

  it('with no board yet there is nothing to write', () => {
    expect(applied(plan(live)).kanban).toBeUndefined()
  })
})

describe('planRetire — refusals change nothing', () => {
  const live = [term('caller', 0, 0, 600, 400), term('succ', 700, 0, 600, 400)]

  it('refuses a successor that is the caller itself', () => {
    expect(plan(live, { successorId: 'caller' })).toEqual({ error: expect.stringMatching(/names you/) })
  })

  it('refuses a successor that is not on the canvas', () => {
    expect(plan(live, { successorId: 'gone' })).toEqual({
      error: expect.stringMatching(/no node with id gone on this canvas/)
    })
  })

  it('refuses a successor in another project', () => {
    expect(plan(live, { successorId: 'far', successorElsewhere: true })).toEqual({
      error: expect.stringMatching(/far is in another project/)
    })
  })

  it('refuses a successor that is not a session node', () => {
    for (const type of ['sticky', 'browser', 'group', 'web']) {
      const other = { ...term('succ', 700, 0, 600, 400), type } as CanvasNode
      expect(plan([live[0], other]), type).toEqual({ error: expect.stringMatching(/succ is not a session/) })
    }
  })
})
