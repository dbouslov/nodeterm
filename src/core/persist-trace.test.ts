import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createPersistTrace, traceFromConsole, traceConsoleSourceAllowed } from './persist-trace'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ptrace-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const lines = async (file: string): Promise<string[]> =>
  (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean)

describe('the persist trace file', () => {
  it('writes one timestamped JSON line per record', async () => {
    const file = path.join(dir, 'persist-trace.log')
    const trace = createPersistTrace({ file, now: () => new Date('2026-09-13T17:21:58.000Z') })
    trace.record({ side: 'main', ev: 'save', wrote: ['p1'] })
    await trace.flushed()
    expect(await lines(file)).toEqual([
      '2026-09-13T17:21:58.000Z {"side":"main","ev":"save","wrote":["p1"]}'
    ])
  })

  it('stays bounded: one rotation, never a third file, each file under the cap', async () => {
    const file = path.join(dir, 'persist-trace.log')
    const cap = 600
    const trace = createPersistTrace({ file, maxBytes: cap })
    for (let i = 0; i < 200; i++) trace.record({ side: 'main', ev: 'save', n: i })
    await trace.flushed()
    const names = (await fs.readdir(dir)).sort()
    expect(names).toEqual(['persist-trace.log', 'persist-trace.log.1'])
    for (const name of names) {
      expect((await fs.stat(path.join(dir, name))).size).toBeLessThanOrEqual(cap)
    }
    // The newest record is the one kept in the live file.
    expect((await lines(file)).at(-1)).toContain('"n":199')
  })

  it('counts a file left by the previous run, so a relaunch cannot grow it past the cap', async () => {
    const file = path.join(dir, 'persist-trace.log')
    await fs.writeFile(file, `${'x'.repeat(550)}\n`)
    const trace = createPersistTrace({ file, maxBytes: 600 })
    trace.record({ side: 'main', ev: 'save', n: 1 })
    await trace.flushed()
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(600)
    expect(await fs.readFile(`${file}.1`, 'utf8')).toContain('x'.repeat(550))
  })

  // PR #18 review: a rotation whose rename failed left the live file over the cap, so every later
  // line re-tried the same rename, failed again, and was dropped — the trace went dark for good.
  it('a failed rotation keeps the trace writing, still under the cap', async () => {
    const file = path.join(dir, 'persist-trace.log')
    await fs.writeFile(file, `${'x'.repeat(550)}\n`)
    // A non-empty directory where the rotation target goes: the rename cannot succeed.
    await fs.mkdir(`${file}.1`)
    await fs.writeFile(path.join(`${file}.1`, 'keep'), 'k')
    const trace = createPersistTrace({ file, maxBytes: 600 })
    trace.record({ side: 'main', ev: 'save', n: 1 })
    trace.record({ side: 'main', ev: 'save', n: 2 })
    await trace.flushed()
    const all = await lines(file)
    expect(all.at(-1)).toContain('"n":2')
    expect(all.some((l) => l.includes('"n":1'))).toBe(true)
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(600)
  })

  it('a failed write neither throws nor stops the next record', async () => {
    const good = path.join(dir, 'persist-trace.log')
    let target = path.join(dir, 'missing-dir', 'persist-trace.log')
    const trace = createPersistTrace({ file: () => target })
    expect(() => trace.record({ side: 'main', ev: 'save', n: 1 })).not.toThrow()
    await trace.flushed()
    target = good
    trace.record({ side: 'main', ev: 'save', n: 2 })
    await trace.flushed()
    expect(await lines(good)).toHaveLength(1)
    expect((await lines(good))[0]).toContain('"n":2')
  })

  // Main hands every renderer console message to this; only `[persist]` lines may reach the file.
  it('takes a renderer [persist] console line and ignores every other console line', async () => {
    const file = path.join(dir, 'persist-trace.log')
    const trace = createPersistTrace({ file })
    expect(traceFromConsole('[canvas] workspace save failed', trace)).toBe(false)
    expect(traceFromConsole('[persist] {"ev":"save","ok":true}', trace)).toBe(true)
    await trace.flushed()
    const all = await lines(file)
    expect(all).toHaveLength(1)
    expect(all[0]).toContain('{"side":"renderer","ev":"save","ok":true}')
  })
})

// PR #18 review: the listener's filter was `getType() === 'window'` alone, and a webContents'
// console-message fires for its sub-frames too — so an iframe inside the app window (the PDF viewer
// in an editor node) could write trace lines. Only the window's own top frame may.
describe('which console messages may write the trace', () => {
  const top = { parent: null }
  const child = { parent: top }
  it("takes the app window's top frame", () => {
    expect(traceConsoleSourceAllowed('window', top)).toBe(true)
  })
  it('refuses an iframe inside the app window', () => {
    expect(traceConsoleSourceAllowed('window', child)).toBe(false)
  })
  it('refuses a webview guest, even its top frame', () => {
    expect(traceConsoleSourceAllowed('webview', top)).toBe(false)
  })
  it('refuses a message whose frame is unknown', () => {
    expect(traceConsoleSourceAllowed('window', null)).toBe(false)
    expect(traceConsoleSourceAllowed('window', undefined)).toBe(false)
  })
})
