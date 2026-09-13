import type { Rect, Viewport } from '@xyflow/system'
import type { CanvasSnapshotCaptureResult } from '@shared/types'
import { nodeFitRect, type FocusableNode } from './nodeFocus'

/**
 * `snapshot [--frame <groupId>]` — what gets framed, the camera that frames it, and the sentences
 * the verb answers with. Pure, so Canvas.tsx's dispatch case stays a thin sequence of
 * frame → paint → capture → restore.
 *
 * The camera is COMPUTED and applied with `setViewport` (house rule: never React Flow `fitView`,
 * whose fit is resolved later against whatever is measured by then — see nodeFocus.ts). The
 * caller restores the exact previous viewport afterwards, so the user's view is borrowed for a
 * frame or two and handed back unchanged.
 */

/** The subset of a canvas node this module reads. */
export interface SnapshotNode extends FocusableNode {
  type?: string
  data?: { ghost?: unknown }
}

/** Space kept clear around the framed content, in screen pixels. */
export const SNAPSHOT_MARGIN_PX = 24

export const SNAPSHOT_EMPTY_CANVAS =
  'snapshot refused: the canvas has no nodes — there is nothing to capture'

export const SNAPSHOT_NOT_ON_SCREEN =
  "snapshot refused: your project is not the one on screen, and a snapshot never switches the user's view — ask the user to bring it up, then retry"

export const SNAPSHOT_NO_PANE = 'snapshot failed: the canvas has no size on screen'

export type SnapshotTarget =
  | { ok: true; bounds: Rect; frame?: string }
  | { ok: false; error: string }

/**
 * The canvas rect to frame: one frame's own rect (a nested frame placed through its parent chain),
 * or the union of every node. Keep-alive ghosts are skipped — they are invisible stand-ins parked
 * at the origin, and framing them would drag every shot toward 0,0 (the `fitAll` rule).
 */
export function snapshotTarget(nodes: readonly SnapshotNode[], frameId?: string): SnapshotTarget {
  if (frameId !== undefined) {
    const f = nodes.find((n) => n.id === frameId)
    if (!f) {
      return { ok: false, error: `snapshot refused: no frame "${frameId}" on this canvas — pass a group id from \`list\`` }
    }
    if (f.type !== 'group') {
      return { ok: false, error: `snapshot refused: "${frameId}" is not a frame — pass a group id from \`list\`` }
    }
    const rect = nodeFitRect(f, nodes)
    if (!rect) return { ok: false, error: `snapshot refused: frame "${frameId}" has no size yet — retry in a moment` }
    return { ok: true, bounds: rect, frame: frameId }
  }
  let box: { left: number; top: number; right: number; bottom: number } | null = null
  for (const n of nodes) {
    if (n.data?.ghost === true) continue
    const r = nodeFitRect(n, nodes)
    if (!r) continue
    box = box
      ? {
          left: Math.min(box.left, r.x),
          top: Math.min(box.top, r.y),
          right: Math.max(box.right, r.x + r.width),
          bottom: Math.max(box.bottom, r.y + r.height)
        }
      : { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }
  }
  if (!box) return { ok: false, error: SNAPSHOT_EMPTY_CANVAS }
  return { ok: true, bounds: { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top } }
}

export interface SnapshotFit {
  margin: number
  minZoom: number
  maxZoom: number
}

/**
 * The viewport that fits `bounds` inside a `paneWidth × paneHeight` pane with `margin` on every
 * side, centred. The zoom is clamped to the canvas's own range, so the shot is a view the user
 * could reach by hand. Null when the pane has no room.
 */
export function snapshotViewport(
  bounds: Rect,
  paneWidth: number,
  paneHeight: number,
  fit: SnapshotFit
): Viewport | null {
  const room = { w: paneWidth - 2 * fit.margin, h: paneHeight - 2 * fit.margin }
  if (!(room.w > 0) || !(room.h > 0) || !(bounds.width > 0) || !(bounds.height > 0)) return null
  const zoom = Math.min(fit.maxZoom, Math.max(fit.minZoom, Math.min(room.w / bounds.width, room.h / bounds.height)))
  return {
    x: (paneWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (paneHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
    zoom
  }
}

/** The canvas-space rect a `paneWidth × paneHeight` capture shows under viewport `v`. */
export function capturedCanvasRect(v: Viewport, paneWidth: number, paneHeight: number): Rect {
  return { x: -v.x / v.zoom, y: -v.y / v.zoom, width: paneWidth / v.zoom, height: paneHeight / v.zoom }
}

/** A board or overview drawn over the canvas would be what the capture shows — refuse, by name,
 *  rather than close it: a snapshot never changes what the user is looking at. */
export function snapshotViewRefusal(view: { kanbanOpen: boolean; overviewOpen: boolean }): string | null {
  const covered = view.kanbanOpen ? 'the kanban board' : view.overviewOpen ? 'the Network overview' : null
  return covered
    ? `snapshot refused: ${covered} is open, not the canvas, and a snapshot never switches the user's view — ask the user to close it, then retry`
    : null
}

export function snapshotReplyMessage(r: {
  path: string
  width: number
  height: number
  canvas: Rect
  zoom: number
  frame?: string
}): string {
  const what = r.frame ? `frame ${r.frame}` : 'the whole canvas'
  const c = r.canvas
  const n = Math.round
  return (
    `snapshot of ${what}: ${r.path} (${r.width}×${r.height} px) — ` +
    `canvas area x=${n(c.x)} y=${n(c.y)} w=${n(c.width)} h=${n(c.height)} at zoom ${Number(r.zoom.toFixed(3))}`
  )
}

export interface SnapshotRunDeps {
  nodes: readonly SnapshotNode[]
  frame?: string
  /** The canvas element's box in window CSS pixels (its bounding rect); null when not mounted. */
  pane: { left: number; top: number; width: number; height: number } | null
  fit: SnapshotFit
  getViewport(): Viewport
  setViewport(v: Viewport): Promise<unknown>
  /** Resolves once the viewport just set has been painted. */
  paint(): Promise<void>
  /** Main's capture of `rect` (the pane), written where main's ticket says. */
  capture(rect: { x: number; y: number; width: number; height: number }): Promise<CanvasSnapshotCaptureResult>
}

export type SnapshotRunResult =
  | {
      ok: true
      message: string
      result: { path: string; width: number; height: number; canvas: Rect; zoom: number; frame?: string }
    }
  | { ok: false; error: string }

export const SNAPSHOT_IN_PROGRESS = 'snapshot refused: a snapshot is already in progress — retry in a moment'

/** One snapshot at a time. Canvas.tsx runs control events concurrently, and a second run started
 *  mid-snapshot saves the first's borrowed framing as "previous": both shots come out framed wrong
 *  and the user is left on the first shot's framing instead of their own view. */
let snapshotInFlight = false

export async function runSnapshot(d: SnapshotRunDeps): Promise<SnapshotRunResult> {
  if (snapshotInFlight) return { ok: false, error: SNAPSHOT_IN_PROGRESS }
  snapshotInFlight = true
  try {
    return await frameCaptureRestore(d)
  } finally {
    // Released only once the view is handed back, so the next snapshot saves the user's view.
    snapshotInFlight = false
  }
}

/**
 * Frame → paint → capture → restore. Every refusal this module can make comes BEFORE the view is
 * touched; once it is, the user's exact previous viewport is put back in `finally`, whatever the
 * capture answered or threw.
 */
async function frameCaptureRestore(d: SnapshotRunDeps): Promise<SnapshotRunResult> {
  const target = snapshotTarget(d.nodes, d.frame)
  if (!target.ok) return target
  const pane = d.pane
  const view = pane && snapshotViewport(target.bounds, pane.width, pane.height, d.fit)
  if (!pane || !view) return { ok: false, error: SNAPSHOT_NO_PANE }
  const previous = d.getViewport()
  let used: Viewport
  let shot: CanvasSnapshotCaptureResult
  try {
    await d.setViewport(view)
    await d.paint()
    // Read back rather than assume: the reply states the view that was actually captured.
    used = d.getViewport()
    shot = await d.capture({ x: pane.left, y: pane.top, width: pane.width, height: pane.height })
  } finally {
    await d.setViewport(previous)
  }
  if (!shot.ok) return { ok: false, error: shot.error }
  const canvas = capturedCanvasRect(used, pane.width, pane.height)
  const frame = target.frame
  return {
    ok: true,
    message: snapshotReplyMessage({ path: shot.path, width: shot.width, height: shot.height, canvas, zoom: used.zoom, frame }),
    result: { path: shot.path, width: shot.width, height: shot.height, canvas, zoom: used.zoom, ...(frame ? { frame } : {}) }
  }
}
