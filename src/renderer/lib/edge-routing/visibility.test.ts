import { describe, it, expect } from 'vitest'
import { buildGraph } from './visibility'
import { containsStrict, inflate, windowFor } from './obstacles'
import { OBSTACLE_MARGIN, type Box, type Point, type Port } from './types'

describe('buildGraph', () => {
  it('free vertices and open steps are exactly the containsStrict definition (random canvases)', () => {
    // The two predicates, asked the slow way: a vertex is free unless strictly inside a solid (an
    // obstacle or an endpoint) — the ports excepted, they sit on their node's border — and a step
    // between neighbouring vertices is open unless its midpoint is strictly inside a solid.
    let seed = 3
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const box = (w: number, h: number): Box => ({ x: Math.floor(rnd() * 1500), y: Math.floor(rnd() * 1000), width: w, height: h })
    for (let t = 0; t < 60; t++) {
      const blocked = Array.from({ length: 2 + Math.floor(rnd() * 10) }, () => inflate(box(100 + Math.floor(rnd() * 300), 60 + Math.floor(rnd() * 250)), OBSTACLE_MARGIN))
      const a = box(200, 100), b = box(240, 120)
      // Fractional port positions, as a spread side produces.
      const ports: [Port, Port] = [{ x: a.x + a.width, y: a.y + 37.25, side: 'right' }, { x: b.x + 101.5, y: b.y, side: 'top' }]
      const g = buildGraph(blocked, ports, [a, b], windowFor(a, b, 200))
      const solid = [...blocked, a, b]
      const inside = (p: Point) => solid.some((s) => containsStrict(s, p))
      const W = g.xs.length, H = g.ys.length
      for (let v = 0; v < W * H; v++) {
        const p = g.at(v)
        const isPort = ports.some((q) => q.x === p.x && q.y === p.y)
        expect(g.free[v] === 1, `t=${t} v=${v}`).toBe(isPort || !inside(p))
        const ix = v % W, iy = Math.floor(v / W)
        const want = [[ix - 1, iy], [ix + 1, iy], [ix, iy - 1], [ix, iy + 1]]
          .filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H)
          .map(([x, y]) => y * W + x)
          .filter((u) => g.free[u] === 1 && !inside({ x: (p.x + g.at(u).x) / 2, y: (p.y + g.at(u).y) / 2 }))
        expect(g.neighbors(v), `t=${t} v=${v}`).toEqual(want)
      }
    }
  })
})
