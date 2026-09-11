// The orthogonal visibility graph (spec 3.3): candidate vertical lines at every obstacle's left
// and right (already inflated by the margin), horizontal lines at every top and bottom, plus the
// two ports and their stubs. Vertices are the intersections not inside an obstacle or an endpoint
// node; two vertices adjacent on one line are joined when the segment between them is clear.
import { containsStrict } from './obstacles'
import { outward, PORT_STUB, type Box, type Point, type Port } from './types'

export interface Graph {
  xs: number[]
  ys: number[]
  free: Uint8Array
  index(ix: number, iy: number): number
  at(v: number): Point
  ix(v: number): number
  iy(v: number): number
  neighbors(v: number): number[]
  vertexAt(p: Point): number
}

function uniqSorted(vals: number[]): number[] {
  return [...new Set(vals)].sort((a, b) => a - b)
}

export function buildGraph(blocked: Box[], ports: [Port, Port], endpoints: [Box, Box], window: Box): Graph {
  const xs: number[] = [window.x, window.x + window.width]
  const ys: number[] = [window.y, window.y + window.height]
  for (const b of blocked) {
    xs.push(b.x, b.x + b.width)
    ys.push(b.y, b.y + b.height)
  }
  for (const p of ports) {
    const o = outward(p.side)
    xs.push(p.x, p.x + o.x * PORT_STUB)
    ys.push(p.y, p.y + o.y * PORT_STUB)
  }
  const X = uniqSorted(xs)
  const Y = uniqSorted(ys)
  const W = X.length
  const free = new Uint8Array(W * Y.length)
  // Endpoint nodes are not obstacles for routing AROUND (their ports sit on them) but no vertex
  // may lie strictly inside them, so the route cannot cut through its own node.
  const solid = [...blocked, ...endpoints]
  for (let iy = 0; iy < Y.length; iy++)
    for (let ix = 0; ix < W; ix++) {
      const p = { x: X[ix], y: Y[iy] }
      free[iy * W + ix] = solid.some((b) => containsStrict(b, p)) ? 0 : 1
    }
  const clear = (a: Point, b: Point): boolean => {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    return !solid.some((s) => containsStrict(s, m))
  }
  const g: Graph = {
    xs: X,
    ys: Y,
    free,
    index: (ix, iy) => iy * W + ix,
    at: (v) => ({ x: X[v % W], y: Y[Math.floor(v / W)] }),
    ix: (v) => v % W,
    iy: (v) => Math.floor(v / W),
    neighbors(v) {
      const ix = v % W, iy = Math.floor(v / W)
      const out: number[] = []
      const here = g.at(v)
      const tryV = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= Y.length) return
        const u = ny * W + nx
        if (free[u] && clear(here, g.at(u))) out.push(u)
      }
      tryV(ix - 1, iy); tryV(ix + 1, iy); tryV(ix, iy - 1); tryV(ix, iy + 1)
      return out
    },
    vertexAt: (p) => {
      const ix = X.indexOf(p.x), iy = Y.indexOf(p.y)
      return ix < 0 || iy < 0 ? -1 : iy * W + ix
    }
  }
  // A port lies ON its node's border: force it free so the search can start and end there.
  for (const p of ports) { const v = g.vertexAt(p); if (v >= 0) free[v] = 1 }
  return g
}
