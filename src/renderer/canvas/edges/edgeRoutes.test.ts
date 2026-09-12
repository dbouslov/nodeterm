import { describe, it, expect } from 'vitest'
import { litSetFor } from './edgeRoutes'
import type { RouteNode } from '../../lib/edge-routing'

const nodes = new Map<string, RouteNode>([
  ['a', { id: 'a', x: 0, y: 0, width: 1, height: 1, isFrame: false, selected: true }],
  ['b', { id: 'b', x: 0, y: 0, width: 1, height: 1, isFrame: false }],
  ['c', { id: 'c', x: 0, y: 0, width: 1, height: 1, isFrame: false }]
])
const edges = [
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'bc', source: 'b', target: 'c', selected: true },
  { id: 'ca', source: 'c', target: 'a' }
]

describe('litSetFor', () => {
  it('lights the hovered edge, selected edges, and every edge touching a selected node', () => {
    expect([...litSetFor(edges, nodes, null)].sort()).toEqual(['ab', 'bc', 'ca'])
    const quiet = new Map(nodes); quiet.set('a', { ...nodes.get('a')!, selected: false })
    expect([...litSetFor(edges, quiet, 'ab')].sort()).toEqual(['ab', 'bc'])
    expect([...litSetFor(edges.map((e) => ({ ...e, selected: false })), quiet, null)]).toEqual([])
  })
  it('ignores a hovered id that is no longer an edge', () => {
    // The hover survives the edge: delete it, hide it, or switch project while the cursor is on
    // it and `hovered` still names it. Lighting a ghost means `anyLit` is true and every real
    // edge dims to 0.2 with nothing lit — a canvas of faint edges and no way out but a click.
    const quiet = new Map(nodes)
    quiet.set('a', { ...nodes.get('a')!, selected: false })
    const plain = edges.map((e) => ({ ...e, selected: false }))
    expect([...litSetFor(plain, quiet, 'ab-deleted')]).toEqual([])
  })
})
