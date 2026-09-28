import { describe, it, expect } from 'vitest'
import type { CanvasNode } from '../state/workspace'
import type { AgentNodeStatus } from '../state/agentStatus'
import type { SubagentViz } from '../state/agentNodes'
import { buildLoopCards } from './loopCards'
import { buildSubagentCards } from './subagentCards'
import { cardRowBands, fanoutHidden } from './cardBand'
import { helperChip } from './dockSeat'

// A chat inside the Dock draws no helper cards (the Dock is fixed-size and pinned, so a card row
// there could only overlap its pages). The seat's header says how many there are instead (T8).

const dock: CanvasNode = {
  id: 'D',
  type: 'group',
  position: { x: 40, y: 40 },
  width: 1400,
  height: 1100,
  data: { title: 'GO', color: '#fff', group: null, fixture: 'dock', pinned: true }
}
const agent = (id: string, parentId?: string): CanvasNode => ({
  id,
  type: 'terminal',
  position: { x: 24, y: 56 },
  width: 600,
  height: 400,
  ...(parentId ? { parentId, extent: 'parent' as const } : {}),
  data: { title: id, color: '#fff', group: null, agentId: 'claude' }
})
const sub = (parentNodeId: string): SubagentViz =>
  ({ parentNodeId, label: 'x', subagentType: 'Explore', state: 'working', startedAt: 0 }) as unknown as SubagentViz
const cron = { loop: { count: 0, kind: 'cron', schedule: '*/5 * * * *', task: 't', items: [] } } as unknown as AgentNodeStatus
const base = { positions: {}, sizes: {}, expanded: {}, selectedId: null, snap: 0 }

describe('cards for a chat in the Dock', () => {
  const nodes = [dock, agent('seat', 'D'), agent('out')]
  it('fanoutHidden: in the Dock, or the eye closed', () => {
    expect(fanoutHidden(nodes[1], nodes)).toBe(true)
    expect(fanoutHidden(nodes[2], nodes)).toBe(false)
  })
  it('no subagent cards, no loop card, no band row', () => {
    expect(buildSubagentCards(nodes, { s1: sub('seat'), s2: sub('seat') }, base).nodes).toEqual([])
    expect(buildLoopCards(nodes, { seat: cron }, base).nodes).toEqual([])
    expect(cardRowBands(nodes, new Set(['seat']), { s1: sub('seat') }, {}).has('seat')).toBe(false)
  })
  it('a chat outside the Dock still draws its cards', () => {
    expect(buildSubagentCards(nodes, { s1: sub('out') }, base).nodes).toHaveLength(1)
  })
})

describe('helperChip: the seat header count', () => {
  it('absent when there is nothing', () => {
    expect(helperChip(0, false)).toBeNull()
  })
  it('counts helpers, singular and plural', () => {
    expect(helperChip(1, false)).toEqual({ text: '1 helper', loop: false })
    expect(helperChip(3, false)).toEqual({ text: '3 helpers', loop: false })
  })
  it('adds the loop glyph when a cron or loop is armed', () => {
    expect(helperChip(3, true)).toEqual({ text: '3 helpers', loop: true })
    // A loop alone still shows, so an armed cron never silently vanishes.
    expect(helperChip(0, true)).toEqual({ text: 'loop', loop: true })
  })
})
