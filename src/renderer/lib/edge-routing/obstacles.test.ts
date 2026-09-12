import { describe, it, expect } from 'vitest'
import { inflate, intersects, obstaclesFor, windowFor } from './obstacles'
import { OBSTACLE_MARGIN, WINDOW_PAD, type RouteNode, type RouteRequest } from './types'

const n = (id: string, x: number, y: number, o: Partial<RouteNode> = {}): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false, ...o })
const req = (nodes: RouteNode[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges: [] })
const edge = { id: 'e', source: 'a', target: 'b', kind: 'rope' as const }

describe('obstaclesFor', () => {
  it('excludes both endpoints, includes a bystander inflated by the margin', () => {
    const r = req([n('a', 0, 0), n('b', 800, 0), n('c', 400, 0)])
    const obs = obstaclesFor(edge, r)
    expect(obs).toHaveLength(1)
    expect(obs[0]).toEqual(inflate({ x: 400, y: 0, width: 200, height: 100 }, OBSTACLE_MARGIN))
  })
  it('a frame containing an endpoint is NOT an obstacle, its other members are', () => {
    const r = req([
      n('frame', -50, -50, { isFrame: true, width: 700, height: 300 }),
      n('a', 0, 0, { parentId: 'frame' }),
      n('sib', 300, 0, { parentId: 'frame' }),
      n('b', 1200, 0)
    ])
    const ids = obstaclesFor(edge, r).map((o) => `${o.x}`)
    expect(ids).toEqual([`${300 - OBSTACLE_MARGIN}`])
  })
  it('a foreign frame IS an obstacle and its members are dropped (the frame covers them)', () => {
    const r = req([
      n('a', 0, 0),
      n('b', 1500, 0),
      n('frame', 500, -100, { isFrame: true, width: 600, height: 400 }),
      n('inner', 600, 0, { parentId: 'frame' })
    ])
    const obs = obstaclesFor(edge, r)
    expect(obs).toHaveLength(1)
    expect(obs[0].width).toBe(600 + 2 * OBSTACLE_MARGIN)
  })
  it('hidden nodes are not obstacles', () => {
    expect(obstaclesFor(edge, req([n('a', 0, 0), n('b', 800, 0), n('c', 400, 0, { hidden: true })]))).toEqual([])
  })
  it('only obstacles intersecting the window are kept', () => {
    const r = req([n('a', 0, 0), n('b', 800, 0), n('far', 0, 5000)])
    const w = windowFor(r.nodes.get('a')!, r.nodes.get('b')!, WINDOW_PAD)
    expect(obstaclesFor(edge, r, w)).toEqual([])
    expect(obstaclesFor(edge, r)).toHaveLength(1)
  })
  it('intersects is inclusive of touching edges being NOT an intersection', () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 10, height: 10 })).toBe(true)
  })
})
