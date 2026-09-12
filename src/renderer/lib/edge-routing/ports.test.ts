import { describe, it, expect } from 'vitest'
import { preferredSides, portsFor } from './ports'
import { PORT_SPACING, type RouteEdge, type RouteNode, type RouteRequest } from './types'

const node = (id: string, x: number, y: number, width = 200, height = 100): RouteNode => ({ id, x, y, width, height, isFrame: false })
const req = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((n) => [n.id, n])), edges })

describe('preferredSides', () => {
  const a = node('a', 0, 0)
  it('context and note leave left/right only, even for a target straight below', () => {
    const below = node('b', 0, 400)
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'context' }, a, below)).toEqual(['right', 'left'])
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'note' }, a, below)).toEqual(['right', 'left'])
  })
  it('an opener rope leaves the bottom and arrives at the top', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'opener' }, a, node('b', 300, 400))).toEqual(['bottom', 'top'])
  })
  it('a dep rope runs right to left', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'dep' }, a, node('b', 400, 20))).toEqual(['right', 'left'])
  })
  it('flip rule: a child dragged ABOVE its opener falls back to the dominant axis', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope', ropeKind: 'opener' }, a, node('b', 20, -400))).toEqual(['top', 'bottom'])
  })
  it('an untagged rope and a trigger use the dominant axis', () => {
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'rope' }, a, node('b', 600, 10))).toEqual(['right', 'left'])
    expect(preferredSides({ id: 'e', source: 'a', target: 'b', kind: 'trigger' }, a, node('b', 10, 600))).toEqual(['bottom', 'top'])
  })
})

describe('portsFor — spread along a side', () => {
  it('three ropes leaving one bottom sit PORT_SPACING apart, centred, ordered by heading', () => {
    const hub = node('hub', 0, 0)
    const kids = [node('l', -300, 300), node('m', 0, 300), node('r', 300, 300)]
    const edges: RouteEdge[] = kids.map((k) => ({ id: `e-${k.id}`, source: 'hub', target: k.id, kind: 'rope', ropeKind: 'opener' }))
    const ports = portsFor(req([hub, ...kids], edges))
    const xs = ['l', 'm', 'r'].map((k) => ports.get(`e-${k}`)![0].x)
    expect(xs).toEqual([100 - PORT_SPACING, 100, 100 + PORT_SPACING])
    for (const k of ['l', 'm', 'r']) expect(ports.get(`e-${k}`)![0]).toMatchObject({ y: 100, side: 'bottom' })
  })
  it('compresses when the side is too short for the spread', () => {
    const hub = node('hub', 0, 0, 60, 100) // 60 wide, 16px inset each end ⇒ 28px usable
    const kids = Array.from({ length: 5 }, (_, i) => node(`k${i}`, -400 + i * 200, 300))
    const edges: RouteEdge[] = kids.map((k) => ({ id: `e-${k.id}`, source: 'hub', target: k.id, kind: 'rope', ropeKind: 'opener' }))
    const ports = portsFor(req([hub, ...kids], edges))
    const xs = edges.map((e) => ports.get(e.id)![0].x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(28)
    expect(new Set(xs).size).toBe(5) // still distinct
  })
  it('is deterministic', () => {
    const r = req([node('a', 0, 0), node('b', 400, 0)], [{ id: 'e', source: 'a', target: 'b', kind: 'context' }])
    expect(portsFor(r)).toEqual(portsFor(r))
  })
})
