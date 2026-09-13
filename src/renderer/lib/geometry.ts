import { COLLAPSED_HEIGHT, isPinned, type CanvasNode } from '../state/workspace'
import { absolutePosition, type FocusableNode } from './nodeFocus'

/**
 * Where everything on the canvas is, and what overlaps: the read-only `geometry` canvas-control
 * verb. Orchestrating agents lay nodes out with `arrange`/`align`/`move` and could not see the
 * result.
 *
 * Positions are the STORED layout in root space (a grouped node's `position` plus every ancestor
 * frame's origin), which is what the layout verbs read and write. React Flow draws an
 * `extent: 'parent'` child clamped inside its frame, so a child reported as sticking out is drawn
 * pulled in: the finding names a frame that does not fit its children, which is the thing to fix.
 * Sizes are the RENDERED ones: React Flow's measurement when it has one, and a collapsed node is
 * its header bar whatever its last measurement says (that lags a collapse until the next measure).
 */

export interface GeometryNode {
  id: string
  kind: string
  title: string
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
  /** It, or a frame it sits in, is pinned: layout verbs will not move it. */
  pinned: boolean
}

/** Two siblings (same container) whose rectangles intersect with positive area. `width`/`height`
 *  are the intersection's. Shared edges are not overlaps. */
export interface SiblingOverlap {
  a: string
  b: string
  parentId: string | null
  width: number
  height: number
}

/** A child whose rectangle is not inside its parent frame's. */
export interface OutsideFrame {
  id: string
  frame: string
}

export interface GeometryReport {
  nodes: GeometryNode[]
  overlaps: SiblingOverlap[]
  outside: OutsideFrame[]
}

const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined

function renderedSize(n: CanvasNode): { width: number; height: number } {
  const width = positive(n.measured?.width) ?? positive(n.width) ?? positive(n.style?.width) ?? 0
  const height =
    n.data.collapsed === true
      ? COLLAPSED_HEIGHT
      : positive(n.measured?.height) ?? positive(n.height) ?? positive(n.style?.height) ?? 0
  return { width, height }
}

/** `rootId` and every node below it. Grows until stable, so array order and a cyclic `parentId`
 *  cannot make it miss a node or loop. */
function subtree(nodes: readonly CanvasNode[], rootId: string): Set<string> {
  const ids = new Set([rootId])
  for (let grew = true; grew; ) {
    grew = false
    for (const nd of nodes) {
      if (nd.parentId && ids.has(nd.parentId) && !ids.has(nd.id)) {
        ids.add(nd.id)
        grew = true
      }
    }
  }
  return ids
}

/** Every node and frame (or `frame`'s subtree, the frame included), plus the overlap report over
 *  pairs that are both in scope. Pure. */
export function computeGeometry(
  nodes: readonly CanvasNode[],
  frame?: string
): GeometryReport | { error: string } {
  let scope: readonly CanvasNode[] = nodes
  if (frame !== undefined) {
    const root = nodes.find((nd) => nd.id === frame)
    if (!root) return { error: `geometry: no frame ${JSON.stringify(frame)} on this canvas` }
    if (root.type !== 'group') {
      return { error: `geometry: ${JSON.stringify(frame)} is not a frame (kind: ${root.type})` }
    }
    const ids = subtree(nodes, frame)
    scope = nodes.filter((nd) => ids.has(nd.id))
  }

  const all = nodes as unknown as FocusableNode[]
  const geo: GeometryNode[] = scope.map((nd) => ({
    id: nd.id,
    kind: nd.type ?? 'terminal',
    title: typeof nd.data.title === 'string' ? nd.data.title : '',
    parentId: nd.parentId ?? null,
    ...absolutePosition(nd as unknown as FocusableNode, all),
    ...renderedSize(nd),
    collapsed: nd.data.collapsed === true,
    pinned: isPinned(nd, nodes)
  }))

  const overlaps: SiblingOverlap[] = []
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      const a = geo[i]
      const b = geo[j]
      if (a.parentId !== b.parentId) continue
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (width > 0 && height > 0) overlaps.push({ a: a.id, b: b.id, parentId: a.parentId, width, height })
    }
  }

  const byId = new Map(geo.map((g) => [g.id, g]))
  const outside: OutsideFrame[] = []
  for (const c of geo) {
    const f = c.parentId ? byId.get(c.parentId) : undefined
    if (!f) continue
    const inside =
      c.x >= f.x && c.y >= f.y && c.x + c.width <= f.x + f.width && c.y + c.height <= f.y + f.height
    if (!inside) outside.push({ id: c.id, frame: f.id })
  }

  return { nodes: geo, overlaps, outside }
}

const plural = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`
const px = (v: number): string => String(Math.round(v * 10) / 10)

/** One summary line, then one line per problem naming both titles. A title is printed as a JSON
 *  string, so a title holding a newline cannot forge a line of this reply. */
function geometryMessage(r: GeometryReport): string {
  const byId = new Map(r.nodes.map((g) => [g.id, g]))
  const label = (id: string): string => `${JSON.stringify(byId.get(id)?.title ?? '')} (${id})`
  const frames = r.nodes.filter((g) => g.kind === 'group').length
  const summary =
    `${plural(r.nodes.length - frames, 'node')}, ${plural(frames, 'frame')}, ${plural(r.overlaps.length, 'overlap')}` +
    (r.outside.length
      ? `, ${r.outside.length} outside ${r.outside.length === 1 ? 'its frame' : 'their frames'}`
      : '')
  return [
    summary,
    ...r.overlaps.map((o) => `overlap: ${label(o.a)} and ${label(o.b)} by ${px(o.width)}×${px(o.height)}`),
    ...r.outside.map((o) => `outside: ${label(o.id)} sticks out of frame ${label(o.frame)}`)
  ].join('\n')
}

/** The `geometry` verb's reply, for the live canvas and for a project's serialized nodes alike. */
export function geometryReply(
  nodes: readonly CanvasNode[],
  frame?: string
): { ok: true; result: GeometryReport; message: string } | { ok: false; error: string } {
  const report = computeGeometry(nodes, frame)
  if ('error' in report) return { ok: false, error: report.error }
  return { ok: true, result: report, message: geometryMessage(report) }
}
