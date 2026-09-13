import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  prepareSnapshot,
  captureCanvasSnapshot,
  snapshotsToPrune,
  defaultSnapshotPath,
  pngSize,
  realSnapshotIO,
  SNAPSHOT_KEEP,
  SNAPSHOT_OUT_OUTSIDE_PROJECT,
  SNAPSHOT_OUT_NO_PROJECT_DIR,
  SNAPSHOT_NO_WINDOW,
  SNAPSHOT_WINDOW_MINIMIZED,
  SNAPSHOT_WINDOW_HIDDEN,
  SNAPSHOT_BAD_RECT,
  SNAPSHOT_EMPTY_IMAGE,
  type CaptureTarget,
  type SnapshotIO
} from './canvas-snapshot'

/** The first 33 bytes of a PNG — signature + IHDR — which is all `pngSize` reads. */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const visible = { isVisible: () => true, isMinimized: () => false }

function target(overrides: Partial<CaptureTarget> = {}): CaptureTarget & { rects: unknown[] } {
  const rects: unknown[] = []
  return {
    rects,
    ...visible,
    zoomFactor: () => 1,
    capturePng: async (rect) => {
      rects.push(rect)
      return pngHeader(1600, 1000)
    },
    ...overrides
  }
}

// The `--out` jail is proven against a REAL tree, like the browser screenshot jail it reuses: a real
// project dir, a real escaping symlink, a real sibling outside it.
let root: string
let project: string
const fsDeps = { realpath: (p: string) => fsp.realpath(p), lstat: (p: string) => fsp.lstat(p) }

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'canvas-snap-'))
  project = path.join(root, 'proj')
  await fsp.mkdir(project, { recursive: true })
})
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true })
})

const prep = (out: string | undefined, over: Partial<Parameters<typeof prepareSnapshot>[0]> = {}) =>
  prepareSnapshot({ window: visible, projectId: 'p1', projectCwd: project, out, ...over }, fsDeps)

describe('prepareSnapshot — refused before the renderer touches the view', () => {
  it('refuses a closed, minimized or hidden window, each by name', async () => {
    expect(await prep(undefined, { window: null })).toEqual({ ok: false, error: SNAPSHOT_NO_WINDOW })
    expect(await prep(undefined, { window: { isVisible: () => true, isMinimized: () => true } })).toEqual({
      ok: false,
      error: SNAPSHOT_WINDOW_MINIMIZED
    })
    expect(await prep(undefined, { window: { isVisible: () => false, isMinimized: () => false } })).toEqual({
      ok: false,
      error: SNAPSHOT_WINDOW_HIDDEN
    })
  })

  it('a visible window with no --out gets a ticket for the default folder', async () => {
    expect(await prep(undefined)).toEqual({ ok: true, ticket: { projectId: 'p1' } })
  })

  it('a node main has not saved yet still gets a ticket, named for the canvas', async () => {
    expect(await prep(undefined, { projectId: undefined })).toEqual({ ok: true, ticket: { projectId: 'canvas' } })
  })
})

describe('--out is jailed to the project directory', () => {
  it('a relative path lands inside the project', async () => {
    expect(await prep('shot.png')).toEqual({
      ok: true,
      ticket: { projectId: 'p1', out: path.join(await fsp.realpath(project), 'shot.png') }
    })
  })

  it('a `..` traversal out of the project is refused', async () => {
    expect(await prep('../../etc/x.png')).toEqual({ ok: false, error: SNAPSHOT_OUT_OUTSIDE_PROJECT })
  })

  it('an absolute path outside the project is refused', async () => {
    expect(await prep(path.join(root, 'x.png'))).toEqual({ ok: false, error: SNAPSHOT_OUT_OUTSIDE_PROJECT })
  })

  it('a symlinked folder that resolves outside the project is refused', async () => {
    await fsp.symlink(root, path.join(project, 'escape'), 'dir')
    expect(await prep('escape/x.png')).toEqual({ ok: false, error: SNAPSHOT_OUT_OUTSIDE_PROJECT })
  })

  it('a symlink planted at the exact target name is refused', async () => {
    await fsp.writeFile(path.join(root, 'outside.png'), 'x')
    await fsp.symlink(path.join(root, 'outside.png'), path.join(project, 'shot.png'))
    expect(await prep('shot.png')).toEqual({ ok: false, error: SNAPSHOT_OUT_OUTSIDE_PROJECT })
  })

  it('a project with no local folder (an SSH project) refuses --out, and says to omit it', async () => {
    const r = await prep('shot.png', { projectCwd: undefined })
    expect(r).toEqual({ ok: false, error: SNAPSHOT_OUT_NO_PROJECT_DIR })
    expect(SNAPSHOT_OUT_NO_PROJECT_DIR).toContain('omit --out')
  })

  it('speaks as snapshot, never as the browser verb whose guard it reuses', async () => {
    const r = await prep('../x.png')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).not.toContain('--screenshot')
    expect(!r.ok && r.error).toContain('--out')
  })
})

describe('snapshotsToPrune — keep the newest 20', () => {
  it('prunes the oldest beyond the cap, by modification time', () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ name: `p-${i}.png`, mtimeMs: 1000 + i }))
    expect(SNAPSHOT_KEEP).toBe(20)
    expect(snapshotsToPrune(entries).sort()).toEqual(['p-0.png', 'p-1.png', 'p-2.png', 'p-3.png', 'p-4.png'])
  })

  it('never touches a file that is not a PNG, and prunes nothing at or under the cap', () => {
    const pngs = Array.from({ length: 20 }, (_, i) => ({ name: `p-${i}.png`, mtimeMs: 1000 + i }))
    expect(snapshotsToPrune([...pngs, { name: 'notes.txt', mtimeMs: 1 }])).toEqual([])
  })
})

describe('captureCanvasSnapshot', () => {
  let io: SnapshotIO
  let userData: string
  beforeEach(async () => {
    userData = path.join(root, 'userData')
    io = realSnapshotIO(userData)
  })

  it('writes the default file on disk and prunes the folder to the newest 20', async () => {
    const dir = path.join(userData, 'snapshots')
    await fsp.mkdir(dir, { recursive: true })
    for (let i = 0; i < SNAPSHOT_KEEP; i++) {
      const f = path.join(dir, `old-${String(i).padStart(2, '0')}.png`)
      await fsp.writeFile(f, 'x')
      const t = new Date(Date.now() - (100 - i) * 60_000)
      await fsp.utimes(f, t, t)
    }
    const r = await captureCanvasSnapshot({ projectId: 'p1' }, { x: 0, y: 0, width: 800, height: 500 }, target(), io)
    expect(r).toMatchObject({ ok: true, width: 1600, height: 1000 })
    const written = r.ok ? r.path : ''
    expect(path.dirname(written)).toBe(dir)
    expect(path.basename(written)).toMatch(/^p1-\d{8}-\d{6}-\d{3}\.png$/)
    const left = (await fsp.readdir(dir)).sort()
    expect(left).toHaveLength(SNAPSHOT_KEEP)
    expect(left).toContain(path.basename(written))
    // The single oldest is the one that made room.
    expect(left).not.toContain('old-00.png')
    expect(pngSize(await fsp.readFile(written))).toEqual({ width: 1600, height: 1000 })
  })

  it('writes an --out ticket where it points and prunes nothing — not our folder, not its folder', async () => {
    // One PNG over the cap in each folder, so a prune of either would delete something.
    const seed = async (dir: string) => {
      await fsp.mkdir(dir, { recursive: true })
      const names = Array.from({ length: SNAPSHOT_KEEP + 1 }, (_, i) => `seed-${String(i).padStart(2, '0')}.png`)
      for (const name of names) await fsp.writeFile(path.join(dir, name), 'x')
      return names
    }
    const ours = path.join(userData, 'snapshots')
    const inOurs = await seed(ours)
    const inProject = await seed(project)
    const out = path.join(project, 'shot.png')
    const r = await captureCanvasSnapshot({ projectId: 'p1', out }, { x: 0, y: 0, width: 10, height: 10 }, target(), io)
    expect(r).toEqual({ ok: true, path: out, width: 1600, height: 1000 })
    expect(pngSize(await fsp.readFile(out))).toEqual({ width: 1600, height: 1000 })
    expect((await fsp.readdir(ours)).sort()).toEqual(inOurs)
    expect((await fsp.readdir(project)).sort()).toEqual([...inProject, 'shot.png'])
  })

  it('captures in window pixels: the CSS rect is scaled by the page zoom and rounded', async () => {
    const t = target({ zoomFactor: () => 1.5 })
    await captureCanvasSnapshot({ projectId: 'p1' }, { x: 10, y: 20.2, width: 100, height: 50 }, t, io)
    expect(t.rects).toEqual([{ x: 15, y: 30, width: 150, height: 75 }])
  })

  it('re-checks the window: minimized between the request and the capture is refused, nothing written', async () => {
    const t = target({ isMinimized: () => true })
    const r = await captureCanvasSnapshot({ projectId: 'p1' }, { x: 0, y: 0, width: 10, height: 10 }, t, io)
    expect(r).toEqual({ ok: false, error: SNAPSHOT_WINDOW_MINIMIZED })
    expect(t.rects).toEqual([])
    await expect(fsp.readdir(path.join(userData, 'snapshots'))).rejects.toThrow()
  })

  it('refuses a rect with no area or a non-number, without capturing', async () => {
    const t = target()
    for (const rect of [
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: Number.NaN, width: 10, height: 10 },
      { x: -5, y: 0, width: 10, height: 10 }
    ]) {
      expect(await captureCanvasSnapshot({ projectId: 'p1' }, rect, t, io)).toEqual({ ok: false, error: SNAPSHOT_BAD_RECT })
    }
    expect(t.rects).toEqual([])
  })

  it('refuses an empty capture rather than writing a file that is not an image', async () => {
    const t = target({ capturePng: async () => Buffer.alloc(0) })
    const r = await captureCanvasSnapshot({ projectId: 'p1' }, { x: 0, y: 0, width: 10, height: 10 }, t, io)
    expect(r).toEqual({ ok: false, error: SNAPSHOT_EMPTY_IMAGE })
    await expect(fsp.readdir(path.join(userData, 'snapshots'))).rejects.toThrow()
  })
})

describe('defaultSnapshotPath / pngSize', () => {
  it('names the file <projectId>-<UTC stamp>.png under <userData>/snapshots', () => {
    const p = defaultSnapshotPath('/u', 'p1', new Date('2026-09-12T17:48:57.123Z'))
    expect(p).toBe(path.join('/u', 'snapshots', 'p1-20260912-174857-123.png'))
  })

  it('a hostile project id cannot move the file out of the snapshots folder', () => {
    const p = defaultSnapshotPath('/u', '../../evil', new Date('2026-09-12T17:48:57.123Z'))
    expect(path.dirname(p)).toBe(path.join('/u', 'snapshots'))
  })

  it('reads the pixel size from the IHDR, and answers null for anything that is not a PNG', () => {
    expect(pngSize(pngHeader(3200, 2000))).toEqual({ width: 3200, height: 2000 })
    expect(pngSize(Buffer.from('not a png at all, just some text here'))).toBeNull()
    expect(pngSize(Buffer.alloc(0))).toBeNull()
  })
})
