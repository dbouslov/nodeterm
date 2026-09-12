// The orthogonal visibility graph (spec 3.3): candidate vertical lines at every obstacle's left
// and right (already inflated by the margin), horizontal lines at every top and bottom, plus the
// two ports and their stubs. Vertices are the intersections not inside an obstacle or an endpoint
// node; two vertices adjacent on one line are joined when the segment between them is clear.
import { outward, PORT_STUB, type Box, type Point, type Port } from './types'

/** containsStrict's tolerance: a point ON a (inflated) border counts as outside. */
const EPS = 0.5

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
  const wx0 = window.x, wx1 = window.x + window.width
  const wy0 = window.y, wy1 = window.y + window.height
  const xs: number[] = [wx0, wx1]
  const ys: number[] = [wy0, wy1]
  // Endpoint nodes are not obstacles for routing AROUND (their ports sit on them) but no vertex may
  // lie strictly inside them, and no step may cross them, so the route cannot cut through its own
  // node. Their borders are seeded as lines with everything else's: a step is shut by the midpoint
  // sample below, and without a line at each border a step could straddle a box with its midpoint
  // clear of it — the route then ran straight through the node it was drawing to.
  const solid = [...blocked, ...endpoints]
  // Borders only where they fall INSIDE the window. A solid that meets the window can extend far
  // past it (a frame, a wide node), and a line from the far border put vertices out there —
  // outside the window, where the obstacle list, itself filtered to the window, registers nothing.
  // A route could then leave the window and cross a node no one had told it about.
  for (const b of solid) {
    for (const v of [b.x, b.x + b.width]) if (v > wx0 && v < wx1) xs.push(v)
    for (const v of [b.y, b.y + b.height]) if (v > wy0 && v < wy1) ys.push(v)
  }
  for (const p of ports) {
    const o = outward(p.side)
    xs.push(p.x, p.x + o.x * PORT_STUB)
    ys.push(p.y, p.y + o.y * PORT_STUB)
  }
  const X = uniqSorted(xs)
  const Y = uniqSorted(ys)
  const W = X.length
  const H = Y.length
  // Both predicates the search asks — is a vertex strictly inside a solid, is a step's midpoint —
  // are marked once per solid over the rows and columns it spans, not re-asked of every solid at
  // every step: that scan was most of the search time on a crowded canvas.
  const free = new Uint8Array(W * H).fill(1)
  const hShut = new Uint8Array(Math.max(0, W - 1) * H) // step ix → ix+1 on row iy
  const vShut = new Uint8Array(W * Math.max(0, H - 1)) // step iy → iy+1 on column ix
  for (const s of solid) {
    const x0 = s.x + EPS, x1 = s.x + s.width - EPS
    const y0 = s.y + EPS, y1 = s.y + s.height - EPS
    for (let iy = 0; iy < H; iy++) {
      if (!(Y[iy] > y0 && Y[iy] < y1)) continue
      for (let ix = 0; ix < W; ix++) {
        if (X[ix] > x0 && X[ix] < x1) free[iy * W + ix] = 0
        if (ix < W - 1) {
          const mx = (X[ix] + X[ix + 1]) / 2
          if (mx > x0 && mx < x1) hShut[iy * (W - 1) + ix] = 1
        }
      }
    }
    for (let ix = 0; ix < W; ix++) {
      if (!(X[ix] > x0 && X[ix] < x1)) continue
      for (let iy = 0; iy < H - 1; iy++) {
        const my = (Y[iy] + Y[iy + 1]) / 2
        if (my > y0 && my < y1) vShut[ix * (H - 1) + iy] = 1
      }
    }
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
      if (ix > 0 && free[v - 1] && !hShut[iy * (W - 1) + ix - 1]) out.push(v - 1)
      if (ix < W - 1 && free[v + 1] && !hShut[iy * (W - 1) + ix]) out.push(v + 1)
      if (iy > 0 && free[v - W] && !vShut[ix * (H - 1) + iy - 1]) out.push(v - W)
      if (iy < H - 1 && free[v + W] && !vShut[ix * (H - 1) + iy]) out.push(v + W)
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
