// One chat size per frame. Chats (terminal/agent nodes) in one frame came in mixed sizes, so a
// frame's grid was ragged and its hug left blank space around the small ones. Now `arrange` on a
// frame's children gives every expanded chat the frame's common size before laying them out (or
// the `--size WxH` asked for), and a chat that joins a frame holding chats (`open-* --group`,
// `move --group`) takes that size. Notes keep theirs; a minimized chat takes the common width and
// keeps its title bar, remembering the common height for when it is restored. Pinned chats are
// left alone, as every automatic layout leaves them, and so are maximized ones (sized to the
// screen; restoring puts back the rect they had).
//
// PURE. The callers in Canvas then lay out and let the frames follow through `reflow`.
import { NODE_MIN_SIZES } from './nodeSizing'
import { isPinned, type CanvasNode } from '../state/workspace'
import { isMaximized } from './nodeFocus'

export interface ChatSize {
  width: number
  height: number
}

/** Past this a size is a typo, not a layout. */
const CHAT_SIZE_MAX = 5000

const isChat = (n: CanvasNode): boolean => n.type === 'terminal'
const nodeW = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? 0

/** `--size WxH`: null when absent, the refusal when it is not a usable chat size. */
export function parseChatSize(raw: string | undefined): ChatSize | null | { error: string } {
  if (raw === undefined) return null
  const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(raw)
  if (!m) return { error: `--size must be WxH in px, e.g. --size 640x420 (got "${raw}")` }
  const width = Number(m[1])
  const height = Number(m[2])
  const min = NODE_MIN_SIZES.terminal
  if (width < min.width || height < min.height) {
    return { error: `--size must be at least ${min.width}x${min.height} (a chat's minimum)` }
  }
  if (width > CHAT_SIZE_MAX || height > CHAT_SIZE_MAX) {
    return { error: `--size must be at most ${CHAT_SIZE_MAX}x${CHAT_SIZE_MAX}` }
  }
  return { width, height }
}

/**
 * The most common rendered size among the EXPANDED chats in `ids` (a tie goes to the larger, by
 * area then width); null when none of them is an expanded chat. Notes and minimized chats do not
 * vote: a note's size is its own, and a minimized chat's box is a title bar.
 */
export function commonChatSize(nodes: readonly CanvasNode[], ids: readonly string[]): ChatSize | null {
  const want = new Set(ids)
  const counts = new Map<string, { size: ChatSize; n: number }>()
  for (const nd of nodes) {
    if (!want.has(nd.id) || !isChat(nd) || nd.data.collapsed || isMaximized(nd)) continue
    const size = { width: nodeW(nd), height: nodeH(nd) }
    if (size.width <= 0 || size.height <= 0) continue
    const key = `${size.width}x${size.height}`
    const c = counts.get(key)
    if (c) c.n++
    else counts.set(key, { size, n: 1 })
  }
  let best: { size: ChatSize; n: number } | null = null
  for (const c of counts.values()) {
    const area = c.size.width * c.size.height
    const bestArea = best ? best.size.width * best.size.height : 0
    if (
      !best ||
      c.n > best.n ||
      (c.n === best.n && (area > bestArea || (area === bestArea && c.size.width > best.size.width)))
    ) {
      best = c
    }
  }
  return best ? { ...best.size } : null
}

/** The common size of the chats directly in frame `frameId`, not counting `exclude` (the joiners). */
export function frameChatSize(
  nodes: readonly CanvasNode[],
  frameId: string,
  exclude: readonly string[] = []
): ChatSize | null {
  const skip = new Set(exclude)
  const ids = nodes.filter((n) => n.parentId === frameId && !skip.has(n.id)).map((n) => n.id)
  return commonChatSize(nodes, ids)
}

/** One chat at `size` (see the header for minimized chats). The stale `measured` goes, since
 *  every layout reads it first. */
function sized<T extends CanvasNode>(n: T, size: ChatSize): T {
  if (n.data.collapsed) {
    if (nodeW(n) === size.width && n.data.expandedHeight === size.height) return n
    return {
      ...n,
      width: size.width,
      style: { ...n.style, width: size.width },
      measured: undefined,
      data: { ...n.data, expandedHeight: size.height }
    }
  }
  if (nodeW(n) === size.width && nodeH(n) === size.height) return n
  return {
    ...n,
    width: size.width,
    height: size.height,
    style: { ...n.style, width: size.width, height: size.height },
    measured: undefined
  }
}

/** Give every chat in `ids` the size `size`; everything else, and pinned chats, stay as they are. */
export function resizeChats(nodes: CanvasNode[], ids: readonly string[], size: ChatSize): CanvasNode[] {
  const want = new Set(ids)
  let changed = false
  const out = nodes.map((n) => {
    if (!want.has(n.id) || !isChat(n) || isPinned(n, nodes) || isMaximized(n)) return n
    const next = sized(n, size)
    if (next !== n) changed = true
    return next
  })
  return changed ? out : nodes
}

/** A chat about to join a frame, at that frame's common size (`frameChatSize`); a note, or no
 *  size to take, leaves it as it is. */
export function withChatSize<T extends CanvasNode>(node: T, size: ChatSize | null): T {
  return size && isChat(node) && !isMaximized(node) ? sized(node, size) : node
}
