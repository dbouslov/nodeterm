import { describe, it, expect, beforeEach } from 'vitest'
import { useProjects } from './projects'
import type { CanvasNodeState } from '@shared/types'

const mkNode = (id: string): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 320, height: 240 },
  title: id,
  color: '#888',
  group: null
})

beforeEach(() => {
  useProjects.setState({
    projects: [
      { id: 'p1', name: 'P1', color: '#111', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [mkNode('n1')] }
    ],
    activeProjectId: 'p1'
  })
})

describe('projects store node mutations', () => {
  it('renames a node in a project', () => {
    useProjects.getState().renameNode('p1', 'n1', 'hello')
    expect(useProjects.getState().getProject('p1')!.nodes[0].title).toBe('hello')
  })

  it('recolors a node', () => {
    useProjects.getState().recolorNode('p1', 'n1', '#abc')
    expect(useProjects.getState().getProject('p1')!.nodes[0].color).toBe('#abc')
  })

  it('removes a node', () => {
    useProjects.getState().removeNode('p1', 'n1')
    expect(useProjects.getState().getProject('p1')!.nodes).toHaveLength(0)
  })

  it('duplicates a node with a new id and offset position', () => {
    useProjects.getState().duplicateNode('p1', 'n1')
    const nodes = useProjects.getState().getProject('p1')!.nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[1].id).not.toBe('n1')
    expect(nodes[1].position).not.toEqual(nodes[0].position)
  })
})

describe('removeNodes (the off-screen close frees a frame\'s children like deleteNodes does)', () => {
  const group = (id: string, x: number, y: number, parentId?: string): CanvasNodeState => ({
    id,
    kind: 'group',
    position: { x, y },
    size: { width: 400, height: 300 },
    title: id,
    color: '#fff',
    group: null,
    ...(parentId ? { parentId } : {})
  })
  const at = (id: string, x: number, y: number, parentId?: string): CanvasNodeState => ({
    ...mkNode(id),
    position: { x, y },
    ...(parentId ? { parentId } : {})
  })
  const load = (nodes: CanvasNodeState[]): void =>
    useProjects.setState({
      projects: [{ id: 'p1', name: 'P1', color: '#111', viewport: { x: 0, y: 0, zoom: 1 }, nodes }],
      activeProjectId: 'p1'
    })
  const get = (id: string) => useProjects.getState().getProject('p1')!.nodes.find((n) => n.id === id)

  it('a frame nested two deep: its children join the surviving parent at the same place', () => {
    load([
      group('outer', 100, 80),
      group('mid', 30, 40, 'outer'),
      group('inner', 20, 25, 'mid'),
      at('a', 10, 12, 'inner')
    ])
    useProjects.getState().removeNodes('p1', ['inner'])
    expect(get('inner')).toBeUndefined()
    // Root position before: 100+30+20+10, 80+40+25+12 = (160, 157); `mid` sits at (130, 120).
    expect(get('a')!.parentId).toBe('mid')
    expect(get('a')!.position).toEqual({ x: 30, y: 37 })
  })

  it('an ancestor closed in the same call: children climb to the nearest survivor', () => {
    load([group('outer', 100, 80), group('mid', 30, 40, 'outer'), group('inner', 20, 25, 'mid'), at('a', 10, 12, 'inner')])
    useProjects.getState().removeNodes('p1', ['mid', 'inner'])
    expect(get('a')!.parentId).toBe('outer')
    expect(get('a')!.position).toEqual({ x: 60, y: 77 })
  })

  it('a one-deep frame: children go top-level at their absolute position', () => {
    load([group('g', 50, 60), at('a', 10, 12, 'g')])
    useProjects.getState().removeNodes('p1', ['g'])
    expect(get('a')!.parentId).toBeUndefined()
    expect(get('a')!.position).toEqual({ x: 60, y: 72 })
  })

  it('takes a verify panel frame with it when the removal closes its last member', () => {
    load([
      group('go', 0, 0),
      { ...group('vp', 20, 60, 'go'), title: 'Verify: GO', verifyPanel: true },
      at('r1', 10, 60, 'vp'),
      at('r2', 10, 400, 'vp'),
      { ...group('legacy', 20, 800, 'go'), title: 'Verify: old' },
      at('r3', 10, 60, 'legacy')
    ])
    useProjects.getState().removeNodes('p1', ['r1'])
    expect(get('vp')).toBeDefined() // r2 still in it
    useProjects.getState().removeNodes('p1', ['r2', 'r3'])
    expect(get('vp')).toBeUndefined()
    expect(get('legacy')).toBeUndefined()
    // The frame it sat in is the user's, and survives empty-handed or not.
    expect(get('go')).toBeDefined()
  })

  it('never takes a user frame the removal empties', () => {
    load([group('g', 0, 0), at('a', 10, 60, 'g')])
    useProjects.getState().removeNodes('p1', ['a'])
    expect(get('g')).toBeDefined()
  })

  it('drops the control ropes that touched a removed node, as the on-screen close does', () => {
    // Nothing downstream prunes them: a load restores every persisted rope into the live edge
    // state and the next save writes it back, so a dangling rope stayed in project.json forever.
    load([at('a', 0, 0), at('b', 0, 0), at('c', 0, 0)])
    useProjects.setState((s) => ({
      projects: s.projects.map((p) => ({
        ...p,
        ropes: [
          { id: 'ctrl-a-b', source: 'a', target: 'b', kind: 'opener' as const },
          { id: 'ctrl-b-c', source: 'b', target: 'c', kind: 'dep' as const },
          { id: 'ctrl-a-c', source: 'a', target: 'c' }
        ]
      }))
    }))
    useProjects.getState().removeNodes('p1', ['b'])
    expect(useProjects.getState().getProject('p1')!.ropes).toEqual([{ id: 'ctrl-a-c', source: 'a', target: 'c' }])
  })

  it('drops the context bridges that touched a removed node, as the on-screen close does', () => {
    // On screen, Canvas prunes a link whose endpoint is gone. Off screen, the stored bridge stayed
    // in project.json forever. It never reached a live link (buildBackgroundLinkMaps filters
    // dangling bridges); the gain is project.json hygiene.
    load([at('a', 0, 0), at('b', 0, 0), at('c', 0, 0)])
    useProjects.setState((s) => ({
      projects: s.projects.map((p) => ({
        ...p,
        bridges: [
          { id: 'l-a-b', source: 'a', target: 'b' },
          { id: 'l-b-c', source: 'b', target: 'c' },
          { id: 'l-a-c', source: 'a', target: 'c' }
        ]
      }))
    }))
    useProjects.getState().removeNodes('p1', ['b'])
    expect(useProjects.getState().getProject('p1')!.bridges).toEqual([{ id: 'l-a-c', source: 'a', target: 'c' }])
  })

  it('a parentId cycle does not hang', () => {
    load([group('x', 0, 0, 'y'), group('y', 0, 0, 'x'), at('a', 3, 4, 'x')])
    useProjects.getState().removeNodes('p1', ['x', 'y'])
    expect(useProjects.getState().getProject('p1')!.nodes.map((n) => n.id)).toEqual(['a'])
    expect(get('a')!.parentId).toBeUndefined()
  })
})

describe('moveNodeToGroup', () => {
  const group = (id: string, x: number, y: number): CanvasNodeState => ({
    id,
    kind: 'group',
    position: { x, y },
    size: { width: 400, height: 300 },
    title: id,
    color: '#fff',
    group: null
  })
  const at = (id: string, x: number, y: number, parentId?: string): CanvasNodeState => ({
    ...mkNode(id),
    position: { x, y },
    ...(parentId ? { parentId } : {})
  })

  beforeEach(() => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          name: 'P1',
          color: '#111',
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [group('g1', 50, 50), at('n1', 200, 150)]
        }
      ],
      activeProjectId: 'p1'
    })
  })

  it('adds a node to a group with a group-relative position', () => {
    useProjects.getState().moveNodeToGroup('p1', 'n1', 'g1')
    const n1 = useProjects.getState().getProject('p1')!.nodes.find((n) => n.id === 'n1')!
    expect(n1.parentId).toBe('g1')
    expect(n1.position).toEqual({ x: 150, y: 100 })
  })

  it('removes a node from its group, restoring the absolute position', () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          name: 'P1',
          color: '#111',
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [group('g1', 50, 50), at('n1', 10, 10, 'g1')]
        }
      ],
      activeProjectId: 'p1'
    })
    useProjects.getState().moveNodeToGroup('p1', 'n1', null)
    const n1 = useProjects.getState().getProject('p1')!.nodes.find((n) => n.id === 'n1')!
    expect(n1.parentId).toBeUndefined()
    expect(n1.position).toEqual({ x: 60, y: 60 })
  })

  it('is a no-op when the node is missing', () => {
    const before = useProjects.getState().getProject('p1')!.nodes
    useProjects.getState().moveNodeToGroup('p1', 'nope', 'g1')
    expect(useProjects.getState().getProject('p1')!.nodes).toBe(before)
  })

    it('moves nested group subtrees and rejects a cycle', () => {
    const outer = group('outer', 100, 80)
    const inner = { ...group('inner', 30, 40), parentId: 'outer' }
    const target = group('target', 500, 200)
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          name: 'P1',
          color: '#111',
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: [outer, inner, target]
        }
      ],
      activeProjectId: 'p1'
    })
    useProjects.getState().moveNodeToGroup('p1', 'inner', 'target')
    let nodes = useProjects.getState().getProject('p1')!.nodes
    expect(nodes.find((node) => node.id === 'inner')).toMatchObject({
      parentId: 'target',
      position: { x: -370, y: -80 }
    })
    useProjects.getState().moveNodeToGroup('p1', 'target', 'inner')
    nodes = useProjects.getState().getProject('p1')!.nodes
    expect(nodes.find((node) => node.id === 'target')!.parentId).toBeUndefined()
  })
})

describe('reorderNode', () => {
  const setup = (nodes: CanvasNodeState[]): void => {
    useProjects.setState({
      projects: [
        { id: 'p1', name: 'P1', color: '#111', viewport: { x: 0, y: 0, zoom: 1 }, nodes }
      ],
      activeProjectId: 'p1'
    })
  }
  const order = (): string[] =>
    useProjects.getState().getProject('p1')!.nodes.map((n) => n.id)

  it('moves a node to sit immediately before another in the same container', () => {
    setup([mkNode('a'), mkNode('b'), mkNode('c')])
    useProjects.getState().reorderNode('p1', 'c', 'a')
    expect(order()).toEqual(['c', 'a', 'b'])
  })

  it('joins the target container when reordering across groups', () => {
    const grp: CanvasNodeState = {
      id: 'g1',
      kind: 'group',
      position: { x: 50, y: 50 },
      size: { width: 400, height: 300 },
      title: 'g1',
      color: '#fff',
      group: null
    }
    const t1: CanvasNodeState = { ...mkNode('t1'), position: { x: 10, y: 10 }, parentId: 'g1' }
    const t2: CanvasNodeState = { ...mkNode('t2'), position: { x: 200, y: 150 } }
    setup([grp, t1, t2])
    useProjects.getState().reorderNode('p1', 't2', 't1')
    const out = useProjects.getState().getProject('p1')!.nodes.find((n) => n.id === 't2')!
    expect(out.parentId).toBe('g1')
    expect(out.position).toEqual({ x: 150, y: 100 })
  })

  it('is a no-op for same / missing ids', () => {
    setup([mkNode('a'), mkNode('b')])
    const before = useProjects.getState().getProject('p1')!.nodes
    useProjects.getState().reorderNode('p1', 'a', 'a')
    useProjects.getState().reorderNode('p1', 'nope', 'a')
    expect(useProjects.getState().getProject('p1')!.nodes).toBe(before)
  })
})

describe('control ropes persistence', () => {
  // Visual "spawned by" ropes (agent CLI → new node) persist like bridges: committed with
  // the canvas and carried into the workspace written to disk.
  it('commitCanvas stores ropes and toWorkspace carries them', () => {
    useProjects
      .getState()
      .commitCanvas(
        'p1',
        [mkNode('n1')],
        { x: 0, y: 0, zoom: 1 },
        [{ id: 'b1', source: 'n1', target: 'n2' }],
        [{ id: 'ctrl-n1-n2', source: 'n1', target: 'n2' }]
      )
    const p = useProjects.getState().projects[0]
    expect(p.bridges).toEqual([{ id: 'b1', source: 'n1', target: 'n2' }])
    expect(p.ropes).toEqual([{ id: 'ctrl-n1-n2', source: 'n1', target: 'n2' }])
    expect(useProjects.getState().toWorkspace().projects[0].ropes).toHaveLength(1)
  })
})
