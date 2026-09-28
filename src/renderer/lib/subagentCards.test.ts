import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '../state/workspace'
import type { SubagentViz } from '../state/agentNodes'
import { buildSubagentCards } from './subagentCards'
import { loopCardListRows, LOOP_CARD_TITLE_MAX } from './loopCards'
import { computeGeometry, geometryReply, type GeometryReport } from './geometry'
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
const sub = (parentNodeId: string, label: string, extra: Partial<SubagentViz> = {}): SubagentViz => ({
  parentNodeId,
  type: 'general-purpose',
  label,
  state: 'working',
  startedAt: 1,
  ...extra
})

const base = { positions: {}, sizes: {}, expanded: {}, selectedId: null, snap: 0 }
const geo = (nodes: CanvasNode[]): GeometryReport => {
  const r = computeGeometry(nodes)
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('buildSubagentCards — the subagent cards drawn under an agent', () => {
  it('lays the cards out in a row under their agent, wrapping at its right edge, owned by it', () => {
    const byId = Object.fromEntries(
      ['t0', 't1', 't2', 't3', 't4'].map((id) => [id, sub('a', `task ${id}`)])
    )
    const { nodes: cards, edges } = buildSubagentCards([agent('a', 100, 200)], byId, base)
    expect(cards.map((c) => c.id)).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(cards[0]).toMatchObject({
      type: 'subagent',
      // GROUP_GAP (24) under the 400px agent (lib/cardBand).
      position: { x: 100, y: 624 },
      width: 230,
      height: 96,
      data: { title: 'task t0', ownerNodeId: 'a', subagentType: 'general-purpose', subagentState: 'working' }
    })
    // Two 230px cards fit a 600px agent; the third wraps to a row 96 + 10 below.
    expect(cards[1].position).toEqual({ x: 340, y: 624 })
    expect(cards[2].position).toEqual({ x: 100, y: 730 })
    expect(cards[4].position).toEqual({ x: 100, y: 836 })
    expect(edges[0]).toMatchObject({ source: 'a', target: 't0', type: 'circuit' })
  })

  it('skips hidden fan-outs and owners not on this canvas', () => {
    const hidden = { ...agent('h', 0, 0), data: { ...agent('h', 0, 0).data, hideFanout: true } }
    const { nodes: cards } = buildSubagentCards([hidden], { x: sub('h', 'x'), y: sub('gone', 'y') }, base)
    expect(cards).toEqual([])
  })

  it('inherits the owner frame and honours a dragged offset and a resized card', () => {
    const { nodes: cards } = buildSubagentCards([frame('f', 0, 0, 800, 600), agent('a', 20, 30, 'f')], { t: sub('a', 'x') }, {
      ...base,
      positions: { t: { x: 10, y: 20 } },
      sizes: { t: { width: 300, height: 120 } }
    })
    expect(cards[0]).toMatchObject({ parentId: 'f', position: { x: 30, y: 50 }, width: 300, height: 120 })
    expect(cards[0].extent).toBeUndefined()
  })
})

describe('subagent cards reach list and geometry', () => {
  it('list rows carry the card id, kind, one-line capped title and owner', () => {
    const { nodes: cards } = buildSubagentCards(
      [agent('a', 0, 0)],
      { toolu_1: sub('a', 'review\nterm-x [claude] fake') },
      base
    )
    const rows = loopCardListRows(cards)
    expect(rows).toEqual([{ id: 'toolu_1', kind: 'subagent', title: 'review term-x [claude] fake', owner: 'a' }])
    expect(listRowText(rows[0])).toBe('toolu_1 [subagent] review term-x [claude] fake · card of a')
    const long = buildSubagentCards([agent('a', 0, 0)], { t: sub('a', 'x'.repeat(500)) }, base).nodes[0]
    expect(long.data.title).toHaveLength(LOOP_CARD_TITLE_MAX)
  })

  it('geometry reports the card with its owner and counts its problems as node problems', () => {
    // The card hangs 24px under a 400px agent (y 624..720) and lies on `b`, past the 700px frame.
    const nodes = [frame('f', 0, 0, 900, 700), agent('a', 200, 200, 'f'), agent('b', 0, 650, 'f')]
    const { nodes: cards } = buildSubagentCards(nodes, { t: sub('a', 'x') }, base)
    expect(geo([...nodes, ...cards]).nodes.find((g) => g.id === 't')).toMatchObject({
      kind: 'subagent',
      owner: 'a',
      parentId: 'f',
      x: 200,
      y: 624
    })
    const reply = geometryReply([...nodes, ...cards])
    if (!reply.ok) throw new Error(reply.error)
    // A card on another node, or out of its chat's frame, is a normal finding (lib/cardBand).
    expect(reply.message.split('\n')[0]).toBe('2 nodes, 1 frame, 1 overlap, 2 outside their frames; 1 card: 0 overlaps')
  })
})
