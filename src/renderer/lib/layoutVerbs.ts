// `group`, `arrange` and `align` — the layout the canvas-control verbs compute, as pure functions.
//
// WHY PURE: the same plan runs on two node arrays. On screen it is the live React Flow canvas; OFF
// screen it is the owning project's SERIALIZED nodes, hydrated with `nodeStatesToFlow`
// (`planStoredLayout`), exactly as #41's `retire` and the off-screen `minimize` do. Chats an
// orchestrator opened at night used to float loose because `group` was refused while their tab was
// not the one on screen, and nothing ever came back to frame them.
//
// THE ONE DIFFERENCE OFF SCREEN is the size each node is laid out by. `arrangeNodes` and
// `fitGroupToChildren` read `measured` first and fall back to `width`/`height`; a hydrated node has
// no `measured` (nothing rendered it), so it is laid out by its SAVED size. That is the size the
// node is drawn at the next time the project is shown, apart from content that grows a node past
// it, and every off-screen reply says so.
import {
  alignNodes,
  arrangeNodes,
  commonParentId,
  fitGroupToChildren,
  flowToNodeStates,
  groupSelectedNodes,
  isPinned,
  nodeStatesToFlow,
  type CanvasNode
} from '../state/workspace'
import type { CanvasNodeState } from '@shared/types'
import { commonChatSize, parseChatSize, resizeChats } from './chatSize'
import { nodeRect, reflow } from './reflow'

export type LayoutPlan =
  | { ok: false; error: string }
  | { ok: true; nodes: CanvasNode[]; message: string; result: Record<string, unknown> }

const idList = (raw: string | undefined): string[] =>
  (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * `group --nodes <id,id> [--label L] [--color C]`. `color` is the RESOLVED palette value (the
 * dispatch resolves and refuses an unknown colour before planning).
 */
export function planGroup(
  live: CanvasNode[],
  args: { nodes?: string; label?: string },
  color: string | undefined,
  grid: number
): LayoutPlan {
  const ids = idList(args.nodes)
  const resolvable = ids.filter((id) => live.some((node) => node.id === id))
  if (resolvable.length === 0) return { ok: false, error: 'group: none of the given node ids exist' }
  const groupCount = live.filter((nd) => nd.type === 'group').length
  let grouped = groupSelectedNodes(live, resolvable, groupCount, grid)
  // The new frame is no longer guaranteed to be first (it is emitted in tree order),
  // and a refused set returns the array unchanged — find it by id instead.
  const oldIds = new Set(live.map((node) => node.id))
  const groupNode = grouped.find((node) => !oldIds.has(node.id) && node.type === 'group')
  if (!groupNode) {
    return {
      ok: false,
      error: 'group: nodes must be siblings in one container and may not include an ancestor with its descendant'
    }
  }
  if (args.label || color) {
    grouped = grouped.map((nd) =>
      nd.id === groupNode.id
        ? {
            ...nd,
            data: {
              ...nd.data,
              ...(args.label ? { title: args.label } : {}),
              ...(color ? { color } : {})
            }
          }
        : nd
    )
  }
  const skipped = ids.length - resolvable.length
  const note = skipped > 0 ? ` (${skipped} unknown id(s) skipped)` : ''
  return {
    ok: true,
    nodes: grouped,
    message: `grouped ${resolvable.length} node(s) into ${groupNode.id}${note}`,
    result: { groupId: groupNode.id, grouped: resolvable, skipped }
  }
}

/** `arrange --nodes … [--layout grid|row|column] [--cols N] [--size WxH]` and `align --nodes … --edge E`. */
export function planArrange(
  live: CanvasNode[],
  verb: 'arrange' | 'align',
  args: { nodes?: string; edge?: string; layout?: string; cols?: string; size?: string },
  grid: number
): LayoutPlan {
  const ids = idList(args.nodes)
  const edge = (['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'] as const).find((e2) => e2 === args.edge)
  if (verb === 'align' && !edge) {
    return { ok: false, error: 'align requires --edge left|right|top|bottom|hcenter|vcenter' }
  }
  // arrange/align run in ONE coordinate space: all top-level, or all children of one
  // frame. A mixed set (framed + loose, or two frames) is refused with a clear reason
  // rather than the old misleading "none are top-level".
  const container = commonParentId(live, ids)
  if (container === undefined) {
    const known = ids.filter((id) => live.some((n) => n.id === id))
    return {
      ok: false,
      error: known.length === 0
        ? `${verb}: none of the given node ids exist`
        : `${verb}: the nodes are in different containers — arrange the children of one frame (or top-level nodes) at a time`
    }
  }
  const layout = (['grid', 'row', 'column'] as const).find((l) => l === args.layout) ?? 'grid'
  const cols = args.cols ? parseInt(args.cols, 10) || undefined : undefined
  // One chat size per frame (lib/chatSize): `--size WxH`, else — for a frame's children —
  // the most common expanded chat size among them. Top-level arranges keep their sizes.
  const askedSize = verb === 'arrange' ? parseChatSize(args.size) : null
  if (askedSize && 'error' in askedSize) return { ok: false, error: `arrange: ${askedSize.error}` }
  const chatSize = askedSize ?? (verb === 'arrange' && container ? commonChatSize(live, ids) : null)
  const sizedLive = chatSize ? resizeChats(live, ids, chatSize) : live
  let next = verb === 'arrange'
    ? arrangeNodes(sizedLive, ids, { layout, cols, order: 'given' }) // --nodes order, not array order
    : alignNodes(live, ids, edge!)
  // Tidying a frame's children usually leaves the frame oversized (it was sized to their
  // old scattered spots) — shrink it to hug the new layout, then let its neighbours and
  // the frames above it follow (lib/reflow). Top-level sets have no frame.
  if (container) {
    const frameBefore = live.find((n) => n.id === container)
    next = fitGroupToChildren(next, container, grid)
    if (frameBefore) {
      // The fit leaves `measured` at the old size and reflow reads it first: drop it.
      next = next.map((n) => (n.id === container && n !== frameBefore ? { ...n, measured: undefined } : n))
      next = reflow(next, container, nodeRect(frameBefore), grid)
    }
  }
  const how = verb === 'arrange' ? `as ${layout}` : `to ${edge}`
  // Pinned members (or members of a pinned frame) were left where they are — say so.
  const pinnedIds = ids.filter((id) => {
    const nd = live.find((x) => x.id === id)
    return !!nd && isPinned(nd, live)
  })
  const count = ids.length - pinnedIds.length
  const note = pinnedIds.length ? ` (${pinnedIds.length} pinned, left in place)` : ''
  const sizeNote = chatSize ? `, chats sized ${chatSize.width}x${chatSize.height}` : ''
  return {
    ok: true,
    nodes: next,
    message: `${verb === 'arrange' ? 'arranged' : 'aligned'} ${count} node(s) ${how}${sizeNote}${note}`,
    result: { count, container, pinned: pinnedIds, ...(chatSize ? { chatSize } : {}) }
  }
}

/** What an off-screen layout verb says in addition: where the work landed and what it measured by. */
export const OFF_SCREEN_LAYOUT_NOTE =
  ' (project not on screen: laid out from the saved node sizes; the user sees it when they open that project)'

export type StoredLayoutPlan =
  | { ok: false; error: string }
  | { ok: true; upserts: CanvasNodeState[]; message: string; result: Record<string, unknown> }

/**
 * Run a layout plan over a project's SERIALIZED nodes. Only the nodes the plan changed (a new frame
 * included) come back, so nothing else in the project is round-tripped through the serializers.
 */
export function planStoredLayout(
  stored: CanvasNodeState[],
  plan: (live: CanvasNode[]) => LayoutPlan
): StoredLayoutPlan {
  const live = nodeStatesToFlow(stored)
  const out = plan(live)
  if (!out.ok) return out
  const before = new Set(live)
  const changed = out.nodes.filter((n) => !before.has(n))
  return {
    ok: true,
    upserts: flowToNodeStates(changed),
    message: out.message + OFF_SCREEN_LAYOUT_NOTE,
    result: { ...out.result, offCanvas: true }
  }
}
