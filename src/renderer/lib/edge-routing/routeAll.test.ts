import { describe, it, expect } from 'vitest'
import { routeAll } from './index'
import { inflate, intersects, segmentEnters } from './obstacles'
import { OBSTACLE_MARGIN, outward, type Point, type Port, type RouteEdge, type RouteNode, type RouteRequest } from './types'

const n = (id: string, x: number, y: number): RouteNode => ({ id, x, y, width: 200, height: 100, isFrame: false })
const box = (id: string, x: number, y: number, width: number, height: number): RouteNode => ({ id, x, y, width, height, isFrame: false })
const mk = (nodes: RouteNode[], edges: RouteEdge[]): RouteRequest => ({ nodes: new Map(nodes.map((v) => [v.id, v])), edges })

describe('routeAll', () => {
  const base = mk([n('a', 0, 0), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], [
    { id: 'ab', source: 'a', target: 'b', kind: 'context' },
    { id: 'cd', source: 'c', target: 'd', kind: 'context' }
  ])
  it('routes every edge whose endpoints exist, skips the rest', () => {
    const g = routeAll(mk([...base.nodes.values()], [...base.edges, { id: 'ax', source: 'a', target: 'ghost', kind: 'rope' }]))
    expect([...g.routes.keys()].sort()).toEqual(['ab', 'cd'])
    expect(g.fallbacks).toBe(0)
  })
  // A search that fails inside its window re-runs over the whole canvas, which costs far more than
  // the windowed search: on the old perf canvas one widened search was 15 ms of a 29 ms drag pass.
  // perf.test.ts holds this count at zero on a spaced canvas, so it has to count. Here a wall
  // taller than the window stands between the two ends: nothing inside the window gets past it,
  // and the whole-canvas search goes round its end.
  it('counts a search that had to widen past its window', () => {
    const wall: RouteNode = { id: 'w', x: 300, y: -1000, width: 100, height: 2100, isFrame: false }
    const req = mk([n('a', 0, 0), n('b', 600, 0), wall], [{ id: 'ab', source: 'a', target: 'b', kind: 'context' }])
    const g = routeAll(req)
    const r = g.routes.get('ab')!
    expect(r.fallback).toBe(false)
    expect(r.widened).toBe(true)
    expect(g.widenings).toBe(1)
    // The drag pass keeps its own count: moving `a` re-routes the edge, and the wall still
    // spans the window, so that search widens too.
    const d = routeAll(mk([n('a', 0, 10), n('b', 600, 0), wall], req.edges), g, new Set(['a']))
    expect(d.routes.get('ab')).not.toBe(r)
    expect(d.widenings).toBe(1)
  })
  // A port inside another node's margin is never searched from, and when no other side of its node
  // is free either the edge goes to the fallback with no search, so it counts as a fallback and not
  // as a widening. Here `a` has a neighbour 8 px off each side, whose 16 px margin covers that
  // side's port, before the drag and after it.
  it('counts a fallback, on the full pass and on a drag pass', () => {
    const walls = [n('left', -208, 0), n('right', 208, 0), n('above', 0, -108), n('below', 0, 108)]
    const req = mk([n('a', 0, 0), n('b', 1000, 0), ...walls], [{ id: 'ab', source: 'a', target: 'b', kind: 'context' }])
    const g = routeAll(req)
    expect(g.routes.get('ab')!.fallback).toBe(true)
    expect(g.routes.get('ab')!.widened).toBe(false)
    expect(g.fallbacks).toBe(1)
    const d = routeAll(mk([n('a', 0, 2), n('b', 1000, 0), ...walls], req.edges), g, new Set(['a']))
    expect(d.routes.get('ab')).not.toBe(g.routes.get('ab'))
    expect(d.routes.get('ab')!.fallback).toBe(true)
    expect(d.fallbacks).toBe(1)
    expect(d.widenings).toBe(0)
  })
  // Sticky notes laid out by hand sit closer than the margin: on a real canvas a row of three was
  // 12 px apart, so a note edge's left/right port lay inside its neighbour's margin, the edge took
  // the no-avoidance fallback, and it was drawn behind the neighbours. Another side of the same
  // node was free the whole time.
  it('a port boxed in by a neighbour nearer than the margin leaves by another side, not the fallback', () => {
    const p = box('p', 0, 0, 200, 300), q = box('q', 212, 0, 200, 300)
    const g = routeAll(mk([p, q, box('r', 424, 0, 200, 300), box('t', -700, -800, 640, 440)], [{ id: 'rt', source: 'r', target: 't', kind: 'note' }]))
    const r = g.routes.get('rt')!
    expect(r.fallback).toBe(false)
    const bad: string[] = []
    for (let i = 0; i + 1 < r.points.length; i++) {
      for (const b of [p, q]) if (segmentEnters(inflate(b, OBSTACLE_MARGIN), r.points[i], r.points[i + 1])) bad.push(`segment ${i} enters ${b.id}'s margin`)
    }
    expect(bad).toEqual([])
  })
  // That move costs a search, which on a crowded canvas mostly fails and doubled the drag pass, so a
  // drag pass leaves a boxed-in port to the fallback and the full pass when the drag ends moves it.
  it('a drag pass leaves a boxed-in port to the fallback; the full pass after the drop moves it', () => {
    const row = (ry: number) => [box('p', 0, 0, 200, 300), box('q', 212, 0, 200, 300), box('r', 424, ry, 200, 300), box('t', -700, -800, 640, 440)]
    const edges: RouteEdge[] = [{ id: 'rt', source: 'r', target: 't', kind: 'note' }]
    const d = routeAll(mk(row(4), edges), routeAll(mk(row(0), edges)), new Set(['r']))
    expect(d.routes.get('rt')!.fallback).toBe(true)
    expect(routeAll(mk(row(4), edges)).routes.get('rt')!.fallback).toBe(false)
  })
  // A drag pass re-routes every edge whose route's bbox meets the dragged node, and one that had
  // moved an end to another side went back to the fallback, behind the notes, until the drop: even
  // for an unrelated node dragged into the empty corner of that bbox, 300 px from the wire.
  it('a drag that only meets a moved-end route\'s bbox keeps it off the fallback, on the same ports', () => {
    const row = [box('p', 0, 0, 200, 300), box('q', 212, 0, 200, 300), box('r', 424, 0, 200, 300), box('t', -700, -800, 640, 440)]
    const edges: RouteEdge[] = [{ id: 'rt', source: 'r', target: 't', kind: 'note' }]
    const g = routeAll(mk([...row, box('u', 100, -1400, 100, 100)], edges))
    const before = g.routes.get('rt')!
    expect(before.fallback).toBe(false)
    const u = box('u', 100, -250, 100, 100)
    expect(intersects(before.bbox, u)).toBe(true)
    const d = routeAll(mk([...row, u], edges), g, new Set(['u']))
    expect(d.routes.get('rt')!.fallback).toBe(false)
    expect(d.routes.get('rt')!.ports).toEqual(before.ports)
  })
  // A routed edge may never pass through a node's body, and that includes the nodes its search
  // never saw: the obstacle list is filtered to the search window, so a route that leaves the
  // window is in territory where nothing is registered as an obstacle. Asked over 120 random
  // canvases because the escapes are rare (3 of 1,063 routes) and none of them look special.
  it('no route crosses a node body, over 120 random canvases', () => {
    const EPS = 0.5
    const crosses = (a: Point, b: Point, box: RouteNode): boolean =>
      Math.min(a.x, b.x) < box.x + box.width - EPS && box.x + EPS < Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) < box.y + box.height - EPS && box.y + EPS < Math.max(a.y, b.y)
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const bad: string[] = []
    for (let t = 0; t < 120; t++) {
      const count = 8 + Math.floor(rnd() * 10)
      const ns: RouteNode[] = []
      for (let i = 0; i < count; i++) ns.push({ id: `n${i}`, x: Math.floor(rnd() * 3000), y: Math.floor(rnd() * 2000), width: 200 + Math.floor(rnd() * 160), height: 100 + Math.floor(rnd() * 120), isFrame: false })
      const es: RouteEdge[] = []
      for (let i = 0; i < count; i++) {
        const s = Math.floor(rnd() * count), d = Math.floor(rnd() * count)
        if (s !== d) es.push({ id: `e${t}-${i}`, source: `n${s}`, target: `n${d}`, kind: i % 2 ? 'context' : 'rope', ropeKind: 'dep' })
      }
      const g = routeAll(mk(ns, es))
      for (const e of es) {
        const r = g.routes.get(e.id)
        // The fallback path is the no-avoidance one by definition, so it is not held to this.
        if (!r || r.fallback) continue
        for (let i = 0; i + 1 < r.points.length; i++) {
          for (const node of ns) if (crosses(r.points[i], r.points[i + 1], node)) bad.push(`t=${t} ${e.id} segment ${i} crosses ${node.id}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
  // The two endpoint boxes are solid for the search, but their borders were not among the grid
  // lines, and a step is only shut when its MIDPOINT lands inside a solid. A step could therefore
  // straddle an endpoint box with its midpoint clear of it (below: the run at y=1100 goes from
  // x=2320 to x=1480, midpoint 1900, while `b` ends at 1800) and the route cut straight through
  // the node it was drawing to. `c` is far away and only puts a grid row — its inflated top — at
  // y=1100, inside `b`, which is the row the run then followed.
  it('a route never cuts through its own source or target body', () => {
    const EPS = 0.5
    const a: RouteNode = { id: 'a', x: 1000, y: 0, width: 1300, height: 100, isFrame: false }
    const b: RouteNode = { id: 'b', x: 1500, y: 1000, width: 300, height: 300, isFrame: false }
    const c: RouteNode = { id: 'c', x: 300, y: 1116, width: 500, height: 100, isFrame: false }
    const g = routeAll(mk([a, b, c], [{ id: 'ab', source: 'a', target: 'b', kind: 'context' }]))
    const r = g.routes.get('ab')!
    expect(r.fallback).toBe(false)
    const bad: string[] = []
    for (let i = 0; i + 1 < r.points.length; i++) {
      const p = r.points[i], q = r.points[i + 1]
      for (const box of [a, b]) {
        if (Math.min(p.x, q.x) < box.x + box.width - EPS && box.x + EPS < Math.max(p.x, q.x) &&
            Math.min(p.y, q.y) < box.y + box.height - EPS && box.y + EPS < Math.max(p.y, q.y)) bad.push(`segment ${i} (${p.x},${p.y})-(${q.x},${q.y}) crosses ${box.id}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('incremental: only edges touching a moved node (or crossing its box) are re-routed', () => {
    const g1 = routeAll(base)
    const moved = mk([n('a', 0, 20), n('b', 600, 0), n('c', 0, 400), n('d', 600, 400)], base.edges)
    const g2 = routeAll(moved, g1, new Set(['a']))
    expect(g2.routes.get('cd')).toBe(g1.routes.get('cd'))     // identity kept
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
    expect(g2.routes.get('ab')!.points[0].y).toBe(70)          // follows the new port
  })
  // The canvas's tidy layouts leave a 40 px gap between neighbours, and OBSTACLE_MARGIN is the
  // gutter each side of that gap claims: two 24 px margins overlap inside 40 px, the corridor
  // between neighbours closes, and A* has nowhere to thread — 12 of these 22 edges gave up and
  // drew the straight three-segment fallback straight through the nodes. The margin has to leave
  // a corridor at the gap the layout actually produces.
  it('a tidy 40 px grid routes every edge with no fallback', () => {
    const gap = 40
    const ns: RouteNode[] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) ns.push(n(`n${r}-${c}`, c * (200 + gap), r * (100 + gap)))
    const es: RouteEdge[] = []
    for (let r = 0; r < 4; r++) for (let c = 0; c + 2 < 5; c++) es.push({ id: `h${r}-${c}`, source: `n${r}-${c}`, target: `n${r}-${c + 2}`, kind: 'context' })
    for (let c = 0; c < 5; c++) for (let r = 0; r + 2 < 4; r++) es.push({ id: `v${r}-${c}`, source: `n${r}-${c}`, target: `n${r + 2}-${c}`, kind: 'rope', ropeKind: 'opener' })
    const g = routeAll(mk(ns, es))
    expect(g.routes.size).toBe(es.length)
    expect(g.fallbacks).toBe(0)
  })
  // Nudging offsets an interior run by CHANNEL_SPACING per member either side of its channel's
  // middle — 24 px on a five-member channel, past the 20 px PORT_STUB — and the obstacle list it
  // consulted left OUT the edge's own two nodes. The corner next to a stub was then carried onto or
  // past its own node's border: the stub collapsed or pointed backwards, and the arrowhead, whose
  // direction is the sign of the last segment, aimed away from the node it marks. Asked over small
  // crowded canvases because both defects are rare and none of them look special: of the 1,100
  // routes below, 72 ran a segment through their own node and 29 had a collapsed or reversed stub.
  it('no nudged segment enters its own endpoint node and both stubs keep their port normal', () => {
    const EPS = 0.5
    const enters = (a: Point, b: Point, box: RouteNode): boolean =>
      Math.min(a.x, b.x) < box.x + box.width - EPS && box.x + EPS < Math.max(a.x, b.x) &&
      Math.min(a.y, b.y) < box.y + box.height - EPS && box.y + EPS < Math.max(a.y, b.y)
    let seed = 3
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const bad: string[] = []
    for (let t = 0; t < 200; t++) {
      const count = 4 + Math.floor(rnd() * 3)
      const ns: RouteNode[] = []
      for (let i = 0; i < count; i++) ns.push({ id: `n${i}`, x: Math.floor(rnd() * 900), y: Math.floor(rnd() * 700), width: 200, height: 100, isFrame: false })
      const es: RouteEdge[] = []
      for (let i = 0; i < count * 2; i++) {
        const s = Math.floor(rnd() * count), d = Math.floor(rnd() * count)
        if (s !== d) es.push({ id: `e${t}-${i}`, source: `n${s}`, target: `n${d}`, kind: i % 2 ? 'context' : 'rope', ropeKind: 'dep' })
      }
      const g = routeAll(mk(ns, es))
      for (const e of es) {
        const r = g.routes.get(e.id)
        // The fallback path is the no-avoidance one by definition, so it is not held to this.
        if (!r || r.fallback) continue
        const own = [ns.find((v) => v.id === e.source)!, ns.find((v) => v.id === e.target)!]
        for (let i = 0; i + 1 < r.points.length; i++) {
          for (const box of own) if (enters(r.points[i], r.points[i + 1], box)) bad.push(`t=${t} ${e.id} segment ${i} enters ${box.id}`)
        }
        // The vector arrowheadPoints takes its direction from: each stub's far corner must still
        // lie outward of its port, or the head has no direction (zero length) or the wrong one.
        const p = r.points
        const stubs: [Point, Point, Port, string][] = [[p[0], p[1], r.ports[0], 'source'], [p[p.length - 1], p[p.length - 2], r.ports[1], 'target']]
        for (const [port, corner, { side }, end] of stubs) {
          const o = outward(side)
          if (Math.sign(corner.x - port.x) !== o.x || Math.sign(corner.y - port.y) !== o.y) bad.push(`t=${t} ${e.id} ${end} stub on ${side} runs ${Math.sign(corner.x - port.x)},${Math.sign(corner.y - port.y)}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
  it('incremental: an untouched edge whose route crosses the moved node re-routes too', () => {
    const r = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, 400), n('d', 400, 800)], [
      { id: 'ab', source: 'a', target: 'b', kind: 'context' },
      { id: 'cd', source: 'c', target: 'd', kind: 'context' }
    ])
    const g1 = routeAll(r)
    const r2 = mk([n('a', 0, 0), n('b', 1000, 0), n('c', 400, -20), n('d', 400, 800)], r.edges) // c now sits on the ab corridor
    const g2 = routeAll(r2, g1, new Set(['c']))
    expect(g2.routes.get('ab')).not.toBe(g1.routes.get('ab'))
  })
})
