// SMART RESTRUCTURE — re-lay out a whole project by the rope graph: opener lineage top-down (a
// child sits in the row under its opener), dependency left-to-right (an `--after` dependent sits
// beside, and after, what it waits on), frames rigid, loose nodes packed below. Pure: Canvas wires
// setNodes / markDirty / fitAll. With no ropes it is a translation of the old "Tidy canvas" grid,
// which is why it replaced Tidy behind the same command.
import { arrangeNodes, type CanvasNode } from '../state/workspace'
import type { BridgeLink } from '@shared/types'
import { PLACEMENT_GAP, ROW_GAP, type Point } from '@shared/placement'

export interface RankedUnits {
  /** Rank per UNIT id (a top-level node or top-level frame); loose units are absent. */
  rank: Map<string, number>
  /** Units with no ropes in or out, in current (y, x) order. */
  loose: string[]
  /** Unit ids per rank, in final left-to-right order. */
  rows: string[][]
}

export type RestructureLayout = 'rows' | 'radial'

// The measure `arrangeNodes` packs by, so a row here and a grid there agree.
const nodeW = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? 0

type UnitEdge = { s: string; t: string; dep: boolean }

const push = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

/** The top-level unit a node belongs to: itself, or its outermost ancestor frame. Cycle-guarded. */
function unitOf(id: string, byId: Map<string, CanvasNode>): string {
  let cur = byId.get(id)
  const seen = new Set<string>()
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  return cur?.id ?? id
}

/**
 * Ranks the canvas's top-level UNITS over the rope graph: rank = the longest OPENER chain from a
 * root, where a `dep` rope keeps a dependent on its dependency's row (never above it) without
 * pushing it a row down. Exported so other views read lineage the same way (the rope `kind`, not
 * the `ctrl-` id).
 */
export function rankUnits(nodes: readonly CanvasNode[], ropes: readonly BridgeLink[]): RankedUnits {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // A unit's stored position IS root space: it is top-level (or its parent is gone).
  const units = nodes.filter((n) => !n.parentId || !byId.has(n.parentId)).map((n) => n.id)
  const unitSet = new Set(units)
  const at = (id: string): Point => byId.get(id)!.position

  // Ropes as edges between units. A rope inside one unit (within a frame) or to a node that is not
  // on the canvas says nothing about layout; an untagged rope is lineage (`opener`).
  const all: UnitEdge[] = []
  for (const r of ropes) {
    if (!byId.has(r.source) || !byId.has(r.target)) continue
    const s = unitOf(r.source, byId)
    const t = unitOf(r.target, byId)
    if (s !== t && unitSet.has(s) && unitSet.has(t)) all.push({ s, t, dep: r.kind === 'dep' })
  }
  const connected = new Set(all.flatMap((e) => [e.s, e.t]))

  // A cycle (only a hand-edited file can make one) is broken at its back edges, found by one DFS
  // over outgoing edges in node order, so the first unit of a cycle stays its root. What is left is
  // a DAG: neither the ranking nor the row ordering below can loop.
  const allOut = new Map<string, UnitEdge[]>()
  for (const e of all) push(allOut, e.s, e)
  const state = new Map<string, 'open' | 'done'>()
  const back = new Set<UnitEdge>()
  const visit = (u: string): void => {
    state.set(u, 'open')
    for (const e of allOut.get(u) ?? []) {
      const seen = state.get(e.t)
      if (seen === 'open') back.add(e)
      else if (!seen) visit(e.t)
    }
    state.set(u, 'done')
  }
  for (const u of units) if (!state.has(u)) visit(u)
  const incoming = new Map<string, UnitEdge[]>()
  const outgoing = new Map<string, UnitEdge[]>()
  for (const e of all) {
    if (back.has(e)) continue
    push(incoming, e.t, e)
    push(outgoing, e.s, e)
  }

  // rank(u) = max(opener sources: rank + 1, dep sources: rank); roots are 0.
  const rank = new Map<string, number>()
  const rankOf = (u: string): number => {
    const known = rank.get(u)
    if (known !== undefined) return known
    let r = 0
    for (const e of incoming.get(u) ?? []) r = Math.max(r, rankOf(e.s) + (e.dep ? 0 : 1))
    rank.set(u, r)
    return r
  }
  for (const u of units) if (connected.has(u)) rankOf(u)

  const loose = units
    .filter((u) => !connected.has(u))
    .sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x)

  // Order within a row: Kahn over the row's dep edges (a dependent after what it waits on), the
  // ready set taken by (its opener's index in the row above, current x) — children cluster under
  // their opener, and ties keep today's left-to-right: the "minimal movement" tie-break.
  const rows: string[][] = []
  const maxRank = Math.max(-1, ...rank.values())
  for (let r = 0; r <= maxRank; r++) {
    const members = units.filter((u) => rank.get(u) === r)
    const inRow = new Set(members)
    const above = new Map((rows[r - 1] ?? []).map((id, i) => [id, i]))
    const openerIndex = (u: string): number =>
      Math.min(
        Infinity,
        ...(incoming.get(u) ?? []).flatMap((e) => (!e.dep && above.has(e.s) ? [above.get(e.s)!] : []))
      )
    const waits = new Map(
      members.map((u) => [u, (incoming.get(u) ?? []).filter((e) => e.dep && inRow.has(e.s)).length])
    )
    const ready = members.filter((u) => waits.get(u) === 0)
    const row: string[] = []
    while (ready.length) {
      // Infinity − Infinity is NaN, which `||` treats as a tie — so x decides between openerless units.
      ready.sort((a, b) => openerIndex(a) - openerIndex(b) || at(a).x - at(b).x)
      const u = ready.shift()!
      row.push(u)
      for (const e of outgoing.get(u) ?? []) {
        if (!e.dep || !inRow.has(e.t)) continue
        const left = waits.get(e.t)! - 1
        waits.set(e.t, left)
        if (left === 0) ready.push(e.t)
      }
    }
    rows.push(row)
  }
  return { rank, loose, rows }
}

const rowWidth = (ids: readonly string[], byId: Map<string, CanvasNode>): number =>
  ids.reduce((w, id) => w + nodeW(byId.get(id)!), 0) + Math.max(0, ids.length - 1) * PLACEMENT_GAP

const tallest = (ids: readonly string[], byId: Map<string, CanvasNode>): number =>
  Math.max(...ids.map((id) => nodeH(byId.get(id)!)))

/** A unit as a disc of half its diagonal — what the radial layout spaces by. */
const discOf = (n: CanvasNode): number => Math.hypot(nodeW(n), nodeH(n)) / 2

function moveTo(nodes: CanvasNode[], at: Map<string, Point>): CanvasNode[] {
  return nodes.map((n) => {
    const p = at.get(n.id)
    return p ? { ...n, position: p } : n
  })
}

/** `ids` left to right from `origin`, in THIS order — `arrangeNodes` packs in node-array order,
 *  which would undo the ranking's order within a row. */
function packRow(
  nodes: CanvasNode[],
  ids: readonly string[],
  origin: Point,
  byId: Map<string, CanvasNode>
): CanvasNode[] {
  const at = new Map<string, Point>()
  let x = origin.x
  for (const id of ids) {
    at.set(id, { x, y: origin.y })
    x += nodeW(byId.get(id)!) + PLACEMENT_GAP
  }
  return moveTo(nodes, at)
}

/**
 * Re-lays out every top-level unit by `rankUnits`. `rows` (the default) packs each rank as a row
 * CENTERED under the rank-0 row's current center, ROW_GAP apart; `radial` puts each rank on a ring
 * around the rank-0 center. Loose units pack as the old Tidy grid below either. A frame moves as
 * one block (its children are frame-relative, so they ride along untouched). Returns the input
 * array itself below 2 units — nothing to lay out, and a fresh array would still cost an undo
 * entry and a project write.
 */
export function restructureNodes(
  nodes: CanvasNode[],
  ropes: readonly BridgeLink[],
  layout: RestructureLayout = 'rows'
): CanvasNode[] {
  const { rows, loose } = rankUnits(nodes, ropes)
  const unitIds = [...rows.flat(), ...loose]
  if (unitIds.length < 2) return nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const at = (id: string): Point => byId.get(id)!.position
  // The horizontal anchor: the CURRENT center of the rank-0 row, so one orchestrator does not move
  // sideways. With no ropes at all (every unit loose), the cluster's current center.
  const anchor = rows[0] ?? unitIds
  const cx =
    (Math.min(...anchor.map((id) => at(id).x)) +
      Math.max(...anchor.map((id) => at(id).x + nodeW(byId.get(id)!)))) /
    2
  const top = Math.min(...unitIds.map((id) => at(id).y))
  let next = nodes
  let y = top
  if (layout === 'radial' && rows.length) {
    // RADIAL (opt-in): rank r on a ring around the rank-0 center — one root: the lower half-circle,
    // left → right in row order; several roots: the full circle. Units are spaced as discs of half
    // their diagonal (the rank-0 row counts as one disc): ring r clears ring r−1 by ROW_GAP, and
    // neighbours on a ring sit a disc + PLACEMENT_GAP apart, so no two units can overlap.
    const root = rows[0]
    next = packRow(next, root, { x: cx - rowWidth(root, byId) / 2, y: top }, byId)
    const c = { x: cx, y: top + tallest(root, byId) / 2 }
    const arc = root.length > 1 ? 2 * Math.PI : Math.PI
    let inner = Math.hypot(rowWidth(root, byId), tallest(root, byId)) / 2
    let R = 0
    for (const row of rows.slice(1)) {
      const disc = Math.max(...row.map((id) => discOf(byId.get(id)!)))
      const step = arc / row.length
      R = Math.max(
        R + inner + ROW_GAP + disc,
        (2 * disc + PLACEMENT_GAP) / (2 * Math.sin(Math.min(step, Math.PI) / 2))
      )
      const ring = new Map<string, Point>()
      row.forEach((id, i) => {
        // One root: θ from near π (left) through π/2 (straight below) to near 0 (right).
        const theta = root.length > 1 ? i * step - Math.PI / 2 : Math.PI - step * (i + 0.5)
        const n = byId.get(id)!
        ring.set(id, {
          x: c.x + R * Math.cos(theta) - nodeW(n) / 2,
          y: c.y + R * Math.sin(theta) - nodeH(n) / 2
        })
      })
      next = moveTo(next, ring)
      inner = disc
    }
    y = c.y + R + inner + ROW_GAP
  } else {
    for (const row of rows) {
      next = packRow(next, row, { x: cx - rowWidth(row, byId) / 2, y }, byId)
      y += tallest(row, byId) + ROW_GAP
    }
  }
  if (loose.length) {
    // Loose units pack exactly as the old Tidy grid did (`arrangeNodes`, node-array order), centered
    // on the anchor — with no ropes at all, the result is a pure translation of Tidy's.
    const looseSet = new Set(loose)
    const inOrder = nodes.filter((n) => looseSet.has(n.id)).map((n) => n.id)
    const cols = Math.max(1, Math.ceil(Math.sqrt(inOrder.length)))
    let gridW = 0
    for (let i = 0; i < inOrder.length; i += cols) {
      gridW = Math.max(gridW, rowWidth(inOrder.slice(i, i + cols), byId))
    }
    next = arrangeNodes(next, inOrder, { layout: 'grid', origin: { x: cx - gridW / 2, y } })
  }
  return next
}
