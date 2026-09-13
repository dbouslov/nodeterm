/**
 * `snapshot [--frame <groupId>] [--out <path>]` — the main-process half.
 *
 * Chats arranging the canvas used to do it blind: `screencapture` needs the macOS Screen Recording
 * grant, which an ad-hoc-signed build loses on every rebuild. This captures the app's OWN window
 * with `webContents.capturePage(rect)`, which needs no permission at all.
 *
 * Two steps, split around the renderer (which frames the shot and hands the view back):
 *   1. `prepareSnapshot` — BEFORE the request is forwarded: refuse a closed/minimized/hidden window
 *      and jail `--out`, so a refusal never borrows the user's view. The result is a TICKET main
 *      keeps against the request id; the renderer never names the file.
 *   2. `captureCanvasSnapshot` — the renderer's capture call, redeemed against that ticket: capture
 *      the rect it measured (scaled to window pixels), write the PNG, prune the default folder.
 *
 * `--out` reuses the browser screenshot jail (`resolveScreenshotPath`) and only rewords its
 * refusals. Main-side only; the Server Edition has no window and refuses the verb by name.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor } from '../core/fs-atomic'
import type { CanvasSnapshotCaptureResult } from '../shared/types'
import { SNAPSHOT_KEEP } from '../core/canvas-control-core'
import { resolveScreenshotPath, SCREENSHOT_NO_PROJECT_DIR, type ScreenshotPathDeps } from './browser-screenshot'

// The default folder's cap lives with the verb model, so the agent-facing docs render the same number.
export { SNAPSHOT_KEEP }

export const SNAPSHOT_NO_WINDOW =
  'snapshot refused: the nodeterm window is closed — ask the user to open it, then retry'
export const SNAPSHOT_WINDOW_MINIMIZED =
  'snapshot refused: the nodeterm window is minimized — ask the user to restore it, then retry'
export const SNAPSHOT_WINDOW_HIDDEN =
  'snapshot refused: the nodeterm window is hidden — ask the user to show it, then retry'
export const SNAPSHOT_OUT_OUTSIDE_PROJECT =
  'snapshot refused: --out must be inside the project directory, in a folder that already exists'
export const SNAPSHOT_OUT_NO_PROJECT_DIR =
  'snapshot refused: --out needs a local project folder and this project has none (an SSH or folderless project) — omit --out to save under the app data folder'
export const SNAPSHOT_BAD_RECT = 'snapshot failed: the canvas reported no area to capture'
export const SNAPSHOT_EMPTY_IMAGE =
  'snapshot failed: the window returned no image — retry once the canvas is on screen'
/** A capture call main has no ticket for: not forwarded by main, already redeemed, or timed out. */
export const SNAPSHOT_NO_TICKET = 'snapshot failed: no snapshot request is pending for this capture'

export interface SnapshotWindow {
  isVisible(): boolean
  isMinimized(): boolean
}

/** Minimized is checked first: a minimized window can still report itself visible. */
function snapshotWindowRefusal(win: SnapshotWindow | null): string | null {
  if (!win) return SNAPSHOT_NO_WINDOW
  if (win.isMinimized()) return SNAPSHOT_WINDOW_MINIMIZED
  if (!win.isVisible()) return SNAPSHOT_WINDOW_HIDDEN
  return null
}

/** What main remembers about a forwarded `snapshot`: whose it is, and the jailed `--out` if any. */
export interface SnapshotTicket {
  projectId: string
  out?: string
}

export async function prepareSnapshot(
  input: {
    window: SnapshotWindow | null
    /** The caller's project per main's own store; undefined for a node not saved yet. */
    projectId: string | undefined
    /** That project's LOCAL folder; undefined for an SSH or folderless project. */
    projectCwd: string | undefined
    out: string | undefined
  },
  deps: ScreenshotPathDeps
): Promise<{ ok: true; ticket: SnapshotTicket } | { ok: false; error: string }> {
  const refusal = snapshotWindowRefusal(input.window)
  if (refusal) return { ok: false, error: refusal }
  // Only the default file NAME uses the id, so an unsaved node still gets its snapshot.
  const projectId = input.projectId ?? 'canvas'
  if (input.out === undefined) return { ok: true, ticket: { projectId } }
  const r = await resolveScreenshotPath(input.projectCwd, input.out, deps)
  if (!r.ok) {
    const error = r.message === SCREENSHOT_NO_PROJECT_DIR ? SNAPSHOT_OUT_NO_PROJECT_DIR : SNAPSHOT_OUT_OUTSIDE_PROJECT
    return { ok: false, error }
  }
  return { ok: true, ticket: { projectId, out: r.abs } }
}

/** `<userData>/snapshots/<projectId>-<YYYYMMDD-HHMMSS-mmm UTC>.png`. The id is reduced to a safe
 *  file-name alphabet, so no id can put a separator (or `..`) into the path. */
export function defaultSnapshotPath(userDataDir: string, projectId: string, now: Date): string {
  const safeId = projectId.replace(/[^A-Za-z0-9_-]/g, '_') || 'canvas'
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace('Z', '')
  return path.join(userDataDir, 'snapshots', `${safeId}-${stamp}.png`)
}

/** Names to delete so the newest `keep` PNGs remain. Anything that is not a PNG is left alone. */
export function snapshotsToPrune(
  entries: readonly { name: string; mtimeMs: number }[],
  keep = SNAPSHOT_KEEP
): string[] {
  return entries
    .filter((e) => e.name.toLowerCase().endsWith('.png'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(keep)
    .map((e) => e.name)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The pixel size from a PNG's IHDR chunk, or null for anything that is not a PNG. Read from the
 *  bytes written, so the reply states what is in the file (on a Retina screen, twice the rect). */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24 || PNG_SIGNATURE.some((b, i) => buf[i] !== b)) return null
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== 'IHDR') return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const width = dv.getUint32(16)
  const height = dv.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

type Rect = { x: number; y: number; width: number; height: number }

export interface CaptureTarget extends SnapshotWindow {
  /** The page zoom (the UI-scale setting): one renderer CSS pixel is this many window pixels. */
  zoomFactor(): number
  /** Capture `rect` (window pixels) PNG-encoded; empty when nothing was captured. */
  capturePng(rect: Rect): Promise<Uint8Array>
}

export interface SnapshotIO {
  userDataDir: string
  now(): Date
  mkdir(dir: string): Promise<void>
  writeFile(p: string, data: Uint8Array): Promise<void>
  list(dir: string): Promise<{ name: string; mtimeMs: number }[]>
  remove(p: string): Promise<void>
}

/** The renderer's CSS-pixel rect, validated (it crossed IPC) and scaled into window pixels. */
function windowRect(raw: unknown, zoom: number): Rect | null {
  const r = (raw ?? {}) as Partial<Record<keyof Rect, unknown>>
  const vals = [r.x, r.y, r.width, r.height]
  if (!vals.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return null
  if (!(zoom > 0)) return null
  const [x, y, w, h] = vals as number[]
  if (x < 0 || y < 0) return null
  const out = { x: Math.round(x * zoom), y: Math.round(y * zoom), width: Math.round(w * zoom), height: Math.round(h * zoom) }
  return out.width >= 1 && out.height >= 1 ? out : null
}

export async function captureCanvasSnapshot(
  ticket: SnapshotTicket,
  rawRect: unknown,
  target: CaptureTarget,
  io: SnapshotIO
): Promise<CanvasSnapshotCaptureResult> {
  // Again: the window can be minimized between the forward and this call.
  const refusal = snapshotWindowRefusal(target)
  if (refusal) return { ok: false, error: refusal }
  const rect = windowRect(rawRect, target.zoomFactor())
  if (!rect) return { ok: false, error: SNAPSHOT_BAD_RECT }
  const png = await target.capturePng(rect)
  const size = pngSize(png)
  if (!size) return { ok: false, error: SNAPSHOT_EMPTY_IMAGE }
  const dest = ticket.out ?? defaultSnapshotPath(io.userDataDir, ticket.projectId, io.now())
  try {
    if (!ticket.out) await io.mkdir(path.dirname(dest))
    await io.writeFile(dest, png)
  } catch {
    return { ok: false, error: `snapshot failed: could not write ${dest}` }
  }
  // Only OUR folder is pruned — never the directory an `--out` points into.
  if (!ticket.out) await pruneSnapshots(path.dirname(dest), io)
  return { ok: true, path: dest, width: size.width, height: size.height }
}

async function pruneSnapshots(dir: string, io: SnapshotIO): Promise<void> {
  try {
    for (const name of snapshotsToPrune(await io.list(dir))) {
      await io.remove(path.join(dir, name)).catch(() => {})
    }
  } catch {
    // A failed prune never fails the snapshot that was just written.
  }
}

/** Buffer twin of `writeFileAtomic` (which takes a string): an exclusive-create temp beside the
 *  target, then `renameAtomic`. A reader never sees half a PNG, and a symlink planted at the target
 *  name after the jail's check is REPLACED by the rename, never written through. */
async function writeBufferAtomic(target: string, data: Uint8Array): Promise<void> {
  const tmp = tempNameFor(target)
  try {
    await fsp.writeFile(tmp, data, { flag: 'wx' })
    await renameAtomic(tmp, target)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export function realSnapshotIO(userDataDir: string): SnapshotIO {
  return {
    userDataDir,
    now: () => new Date(),
    mkdir: async (dir) => {
      await fsp.mkdir(dir, { recursive: true })
    },
    writeFile: writeBufferAtomic,
    list: async (dir) => {
      const out: { name: string; mtimeMs: number }[] = []
      for (const name of await fsp.readdir(dir)) {
        const st = await fsp.stat(path.join(dir, name)).catch(() => null)
        if (st?.isFile()) out.push({ name, mtimeMs: st.mtimeMs })
      }
      return out
    },
    remove: (p) => fsp.rm(p, { force: true })
  }
}
