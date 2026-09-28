import { COLLAPSED_HEIGHT, isPinned, type CanvasNode } from '../state/workspace'
import { absolutePosition, type FocusableNode } from './nodeFocus'
import { bandOf } from './cardBand'

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
  /** A cron/loop card (lib/loopCards): the agent node it hangs off. Absent on every other node. */
  owner?: string
  /** A chat's card band (lib/cardBand): the room under it that overlaps are measured with. */
  band?: number
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

export interface GeometryOpts {
  /** Chats whose card band change is on hold (lib/cardBand): their cards are not findings yet. */
  held?: ReadonlySet<string>
}

/** Every node and frame (or `frame`'s subtree, the frame included), plus the overlap report over
 *  pairs that are both in scope. A chat is measured with its card band; a card overlapping its own
 *  chat or that chat's other cards is not an overlap, and an expanded card (a peek) or a card whose
 *  band change is on hold is not a finding at all. Pure. */
export function computeGeometry(
  nodes: readonly CanvasNode[],
  frame?: string,
  opts: GeometryOpts = {}
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
    pinned: isPinned(nd, nodes),
    ...(typeof nd.data.ownerNodeId === 'string' ? { owner: nd.data.ownerNodeId } : {}),
    ...(bandOf(nd) > 0 ? { band: bandOf(nd) } : {})
  }))
  // Held covers all three holds (drag, typing, pointer): a hold is short, and an agent reading
  // geometry must never "fix" a chat mid-hold by moving what David is using.
  const exempt = new Set(
    scope
      .filter((nd) => typeof nd.data.ownerNodeId === 'string')
      .filter((nd) => nd.data.ephExpanded === true || opts.held?.has(nd.data.ownerNodeId as string))
      .map((nd) => nd.id)
  )
  const bottom = (g: GeometryNode): number => g.y + g.height + (g.band ?? 0)
  const ownPair = (a: GeometryNode, b: GeometryNode): boolean =>
    (a.owner !== undefined && (a.owner === b.id || a.owner === b.owner)) || (b.owner !== undefined && b.owner === a.id)

  const overlaps: SiblingOverlap[] = []
  for (let i = 0; i < geo.length; i++) {
    for (let j = i + 1; j < geo.length; j++) {
      const a = geo[i]
      const b = geo[j]
      if (a.parentId !== b.parentId) continue
      if (exempt.has(a.id) || exempt.has(b.id) || ownPair(a, b)) continue
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const height = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y)
      if (width > 0 && height > 0) overlaps.push({ a: a.id, b: b.id, parentId: a.parentId, width, height })
    }
  }

  const byId = new Map(geo.map((g) => [g.id, g]))
  const outside: OutsideFrame[] = []
  for (const c of geo) {
    const f = c.parentId ? byId.get(c.parentId) : undefined
    if (!f || exempt.has(c.id)) continue
    const inside =
      c.x >= f.x && c.y >= f.y && c.x + c.width <= f.x + f.width && bottom(c) <= f.y + f.height
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
  // A card (it has an `owner`) sits in its chat's band, which the layout keeps clear, so a card on
  // another node or out of its chat's frame is a normal finding (lib/cardBand). Next to a pinned
  // node it is counted apart: a pinned chat keeps no band, and nothing may move a pinned node, so
  // an orchestrator driving `arrange` to "0 overlaps" must not chase it (#7).
  const isCard = (id: string): boolean => byId.get(id)?.owner !== undefined
  const pinnedCard = (id: string): boolean => {
    const g = byId.get(id)
    return g?.owner !== undefined && (g.pinned || byId.get(g.owner)?.pinned === true)
  }
  const apartPair = (a: string, b: string): boolean =>
    (isCard(a) || isCard(b)) && (pinnedCard(a) || pinnedCard(b) || !!byId.get(a)?.pinned || !!byId.get(b)?.pinned)
  const cards = r.nodes.filter((g) => g.owner !== undefined).length
  const frames = r.nodes.filter((g) => g.kind === 'group').length
  const nodeOverlaps = r.overlaps.filter((o) => !apartPair(o.a, o.b)).length
  const nodeOutside = r.outside.filter((o) => !pinnedCard(o.id)).length
  const cardOverlaps = r.overlaps.length - nodeOverlaps
  const cardOutside = r.outside.length - nodeOutside
  const summary =
    `${plural(r.nodes.length - frames - cards, 'node')}, ${plural(frames, 'frame')}, ${plural(nodeOverlaps, 'overlap')}` +
    (nodeOutside ? `, ${nodeOutside} outside ${nodeOutside === 1 ? 'its frame' : 'their frames'}` : '') +
    (cards
      ? `; ${plural(cards, 'card')}: ${plural(cardOverlaps, 'overlap')}` +
        (cardOutside ? `, ${cardOutside} outside ${cardOutside === 1 ? 'its frame' : 'their frames'}` : '')
      : '')
  return [
    summary,
    ...r.overlaps.map(
      (o) => `${apartPair(o.a, o.b) ? 'card ' : ''}overlap: ${label(o.a)} and ${label(o.b)} by ${px(o.width)}×${px(o.height)}`
    ),
    ...r.outside.map((o) => `${pinnedCard(o.id) ? 'card ' : ''}outside: ${label(o.id)} sticks out of frame ${label(o.frame)}`)
  ].join('\n')
}

/** The `geometry` verb's reply, for the live canvas and for a project's serialized nodes alike. */
export function geometryReply(
  nodes: readonly CanvasNode[],
  frame?: string,
  opts: GeometryOpts = {}
): { ok: true; result: GeometryReport; message: string } | { ok: false; error: string } {
  const report = computeGeometry(nodes, frame, opts)
  if ('error' in report) return { ok: false, error: report.error }
  return { ok: true, result: report, message: geometryMessage(report) }
}
