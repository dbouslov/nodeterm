// Corners → SVG (spec 3.7). Rounded with CORNER_RADIUS clamped to half the shorter adjoining leg
// so a short jog never overshoots. The arrowhead is a polygon on the last (or first) segment's
// axis, which is one of four directions, so it needs no marker defs and is always the stroke's
// exact colour.
import { CORNER_RADIUS, type Point } from './types'

const f = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

export function svgPathFrom(points: Point[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${f(points[0].x)} ${f(points[0].y)}`
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const inLen = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const outLen = Math.abs(c.x - b.x) + Math.abs(c.y - b.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r <= 0) { d += ` L ${f(b.x)} ${f(b.y)}`; continue }
    const din = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
    const dout = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) }
    const p1 = { x: b.x - din.x * r, y: b.y - din.y * r }
    const p2 = { x: b.x + dout.x * r, y: b.y + dout.y * r }
    // Sweep flag: clockwise when the turn (in screen coordinates) is right-handed.
    const cross = din.x * dout.y - din.y * dout.x
    const sweep = cross > 0 ? 1 : 0
    d += ` L ${f(p1.x)} ${f(p1.y)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(p2.x)} ${f(p2.y)}`
  }
  const last = points[points.length - 1]
  d += ` L ${f(last.x)} ${f(last.y)}`
  return d
}

export function arrowheadPoints(points: Point[], at: 'start' | 'end', shape: 'triangle' | 'diamond', size = 7): string {
  if (points.length < 2) return ''
  const tip = at === 'end' ? points[points.length - 1] : points[0]
  const prev = at === 'end' ? points[points.length - 2] : points[1]
  // Unit direction from prev toward tip (the head points this way).
  const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y)
  const back = { x: tip.x - dx * size, y: tip.y - dy * size }
  const half = size / 2
  const nx = -dy, ny = dx // perpendicular
  const l = { x: back.x + nx * half, y: back.y + ny * half }
  const r = { x: back.x - nx * half, y: back.y - ny * half }
  const pt = (p: Point) => `${f(p.x)},${f(p.y)}`
  if (shape === 'diamond') {
    const tail = { x: tip.x - dx * size * 2, y: tip.y - dy * size * 2 }
    return [tip, l, tail, r].map(pt).join(' ')
  }
  // Emit the two base corners so that the left-hand one (negative perpendicular) comes first.
  const first = ny < 0 || (ny === 0 && nx < 0) ? l : r
  const second = first === l ? r : l
  return [tip, first, second].map(pt).join(' ')
}
