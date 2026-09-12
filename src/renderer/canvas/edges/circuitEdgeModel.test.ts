import { describe, it, expect } from 'vitest'
import { circuitEdgeModel } from './circuitEdgeModel'
import { SELECTED_COLOR } from '../../lib/edgeKinds'
import type { Route, RouteNode } from '../../lib/edge-routing'

const route: Route = {
  points: [{ x: 200, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 350 }, { x: 600, y: 350 }],
  ports: [{ x: 200, y: 50, side: 'right' }, { x: 600, y: 350, side: 'left' }],
  fallback: false, widened: false, labelAt: { x: 400, y: 200 }, bbox: { x: 200, y: 50, width: 400, height: 300 }
}
const a: RouteNode = { id: 'a', x: 0, y: 0, width: 200, height: 100, isFrame: false }
const b: RouteNode = { id: 'b', x: 600, y: 300, width: 200, height: 100, isFrame: false }
const quiet = { selected: false, lit: false, anyLit: false, hasLabel: true }

describe('circuitEdgeModel', () => {
  it('context: solid accent path, two arrowheads, no outlines, label hidden while quiet', () => {
    const m = circuitEdgeModel(route, { kind: 'context' }, quiet, [a, b])
    expect(m.path.startsWith('M 200 50')).toBe(true)
    expect(m.arrows).toHaveLength(2)
    expect(m.outlines).toEqual([])
    expect(m.showLabel).toBe(false)
    expect(m.style).toMatchObject({ stroke: 'var(--edge-context)', strokeWidth: 2 })
    expect(m.className).toContain('edge-context')
  })
  it('lit: label shown, two endpoint outlines, lit class; dim class when another edge is lit', () => {
    const lit = circuitEdgeModel(route, { kind: 'rope', state: { agentColor: '#10a37f' } }, { ...quiet, lit: true, anyLit: true }, [a, b])
    expect(lit.showLabel).toBe(true)
    expect(lit.outlines).toHaveLength(2)
    expect(lit.className).toContain('edge-lit')
    const dim = circuitEdgeModel(route, { kind: 'rope' }, { ...quiet, anyLit: true }, [a, b])
    expect(dim.className).toContain('edge-dim')
  })
  it('selected: the selected-edge token as stroke, thicker, label shown', () => {
    const m = circuitEdgeModel(route, { kind: 'rope', state: { agentColor: '#10a37f' } }, { ...quiet, selected: true, lit: true, anyLit: true }, [a, b])
    expect(m.style).toMatchObject({ stroke: SELECTED_COLOR, strokeWidth: 3 })
    expect(m.showLabel).toBe(true)
  })
  it('waiting rope: dasharray 6 4 and the animated class', () => {
    const m = circuitEdgeModel(route, { kind: 'rope', state: { waiting: true, agentColor: '#10a37f' } }, quiet, [a, b])
    expect(m.style.strokeDasharray).toBe('6 4')
    expect(m.className).toContain('edge-animated')
  })
  it('fanout has no arrowheads; no label without text', () => {
    const m = circuitEdgeModel(route, { kind: 'fanout', state: { agentColor: '#4285f4' } }, { ...quiet, lit: true, anyLit: true, hasLabel: false }, [a, b])
    expect(m.arrows).toEqual([])
    expect(m.showLabel).toBe(false)
  })
})
