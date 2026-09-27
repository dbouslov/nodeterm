// Notes that fit their text. A note's box used to keep whatever size it was given, so a rewrite
// either hid text under the bottom edge or left a band of blank space (the gaps in a frame of
// status notes). After its text changes, a note takes the height its RENDERED content needs —
// measured in the DOM by the note itself (StickyNode), never estimated from the string — keeps its
// width, and the canvas reflows around it (`reflow`, the one layout routine).
//
// PURE apart from the small request registry at the bottom, which is how the `sticky` verb reaches
// a mounted note's measurer. The measurement needs a rendered note, so only the live canvas fits:
// the off-screen and Server Edition paths write the text and leave the size as it was.
import { NODE_MIN_SIZES } from './nodeSizing'
import { nodeRect, reflow } from './reflow'
import type { CanvasNode } from '../state/workspace'

/** Above this a note stops growing and its body scrolls. */
export const STICKY_FIT_MAX = 2000

/** The height (px) a note needs for `contentHeight` px of rendered content, header included;
 *  null when there is no measurement to fit to. */
export function stickyFitHeight(contentHeight: number): number | null {
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return null
  return Math.min(STICKY_FIT_MAX, Math.max(NODE_MIN_SIZES.sticky.height, Math.ceil(contentHeight)))
}

/**
 * Give note `id` the height `height`, width unchanged, and reflow its neighbours and frames from
 * the rect it had. A collapsed note stays collapsed: only its remembered `expandedHeight` changes,
 * and nothing moves (its box did not). Returns `nodes` itself when nothing changes.
 */
export function applyStickyFit(nodes: CanvasNode[], id: string, height: number, grid = 0): CanvasNode[] {
  const note = nodes.find((n) => n.id === id)
  if (!note || note.type !== 'sticky') return nodes
  if (note.data.collapsed) {
    if (note.data.expandedHeight === height) return nodes
    return nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, expandedHeight: height } } : n))
  }
  const prevRect = nodeRect(note)
  if (prevRect.height === height) return nodes
  // `measured` is read first by the layout, so the stale one goes (reflow's contract).
  const next = nodes.map((n) =>
    n.id === id ? { ...n, height, style: { ...n.style, height }, measured: undefined } : n
  )
  return reflow(next, id, prevRect, grid)
}

// The request registry. A note registers its measurer while mounted; `requestStickyFit` runs it.
// A request for a note that has not mounted yet (one the verb has just created) is held and runs
// when it mounts. A mount with nothing requested measures nothing, so opening a project never
// resizes its old notes unasked — that is what `sticky --fit yes` is for.
const measurers = new Map<string, () => void>()
const pending = new Set<string>()

/** Ask note `id` to fit its text. True when a mounted note took the request now. */
export function requestStickyFit(id: string): boolean {
  const run = measurers.get(id)
  if (!run) {
    pending.add(id)
    return false
  }
  run()
  return true
}

/** Register a mounted note's measurer; returns the unregister. */
export function registerStickyFit(id: string, run: () => void): () => void {
  measurers.set(id, run)
  if (pending.delete(id)) run()
  return () => {
    if (measurers.get(id) === run) measurers.delete(id)
  }
}
