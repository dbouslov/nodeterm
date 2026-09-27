import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '../state/workspace'
import type { AgentNodeStatus } from '../state/agentStatus'
import { buildLoopCards, loopCardListRows } from './loopCards'
import { computeGeometry, type GeometryReport } from './geometry'
import { listRowText } from './controlRouting'

const agent = (id: string, x: number, y: number, parentId?: string): CanvasNode => ({
  id,
  type: 'terminal',
  position: { x, y },
  width: 600,
  height: 400,
  ...(parentId ? { parentId, extent: 'parent' as const } : {}),
  data: { title: id, color: '#fff', group: null, agentId: 'claude' }
})
const frame = (id: string, x: number, y: number, w: number, h: number): CanvasNode => ({
  id,
  type: 'group',
  position: { x, y },
  width: w,
  height: h,
  data: { title: id, color: '#fff', group: null }
})
const cron = (task: string, extra: Partial<NonNullable<AgentNodeStatus['loop']>> = {}): AgentNodeStatus =>
  ({ loop: { count: 0, kind: 'cron', schedule: '*/5 * * * *', task, items: [], ...extra } }) as AgentNodeStatus

const base = { positions: {}, sizes: {}, expanded: {}, selectedId: null, snap: 0 }
const geo = (nodes: CanvasNode[]): GeometryReport => {
  const r = computeGeometry(nodes)
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('buildLoopCards — the cron/loop cards drawn under an agent', () => {
  it('builds one card per agent with a live loop, owned by that agent, at the laid-out offset', () => {
    const nodes = [agent('a', 100, 200)]
    const { nodes: cards, edges } = buildLoopCards(nodes, { a: cron('check deploy') }, base)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 'loop-a',
      type: 'loop',
      position: { x: -150, y: 660 },
      width: 230,
      height: 92,
      data: { title: 'check deploy', ownerNodeId: 'a', loopKind: 'cron' }
    })
    expect(edges[0]).toMatchObject({ source: 'a', target: 'loop-a' })
  })

  it('skips dismissed cards, hidden fan-outs and owners not on this canvas', () => {
    const hidden = { ...agent('h', 0, 0), data: { ...agent('h', 0, 0).data, hideFanout: true } }
    const { nodes: cards } = buildLoopCards(
      [agent('a', 0, 0), hidden],
      { a: cron('x', { dismissed: true }), h: cron('y'), gone: cron('z') },
      base
    )
    expect(cards).toEqual([])
  })

  it('inherits the owner frame and honours a dragged offset and a resized card', () => {
    const { nodes: cards } = buildLoopCards([frame('f', 0, 0, 800, 600), agent('a', 20, 30, 'f')], { a: cron('t') }, {
      ...base,
      positions: { 'loop-a': { x: 10, y: 20 } },
      sizes: { 'loop-a': { width: 300, height: 120 } }
    })
    expect(cards[0]).toMatchObject({ parentId: 'f', position: { x: 30, y: 50 }, width: 300, height: 120 })
    expect(cards[0].extent).toBeUndefined()
  })
})

describe('the cards reach list and geometry (#7)', () => {
  it('geometry reports the card with its owner and counts its overlaps and sticking out', () => {
    // The laid-out card hangs 60px under a 400px agent: its default rect (-150..80, 660..752)
    // sits on top of `b`, and past the bottom of the 700px frame both sit in.
    const nodes = [frame('f', 0, 0, 900, 700), agent('a', 200, 200, 'f'), agent('b', 0, 650, 'f')]
    const { nodes: cards } = buildLoopCards(nodes, { a: cron('t') }, base)
    const r = geo([...nodes, ...cards])
    expect(r.nodes.find((g) => g.id === 'loop-a')).toMatchObject({
      kind: 'loop',
      title: 't',
      parentId: 'f',
      owner: 'a',
      x: -50,
      y: 660,
      width: 230,
      height: 92
    })
    expect(r.overlaps.some((o) => [o.a, o.b].includes('loop-a') && [o.a, o.b].includes('b'))).toBe(true)
    expect(r.outside).toContainEqual({ id: 'loop-a', frame: 'f' })
  })

  it('list rows carry the card id, kind, title and owner', () => {
    const { nodes: cards } = buildLoopCards([agent('a', 0, 0)], { a: cron('check') }, base)
    expect(loopCardListRows(cards)).toEqual([{ id: 'loop-a', kind: 'loop', title: 'check', owner: 'a' }])
    expect(listRowText(loopCardListRows(cards)[0])).toBe('loop-a [loop] check · card of a')
  })
})
