import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitSkipReason } from '../../src/renderer/state/persistGuards'
import { tracePersist } from '../../src/renderer/lib/persistTrace'
import { createPersistTrace, traceFromConsole } from '../../src/core/persist-trace'

/**
 * THE CHAIN, once, across the process boundary: a save decision the RENDERER made reaches the
 * trace file MAIN writes. The renderer prints a `[persist]` console line (`tracePersist`); main's
 * `console-message` listener hands every renderer console line to `traceFromConsole`; the sink
 * appends it. Only Electron's own console-message event is not in this chain. It lives in
 * test/acceptance because production layering forbids renderer + core imports in one src/ file.
 */

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ptrace-chain-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('a skipped renderer save reaches the trace file with its reason', () => {
  it('writes the skip reason, the active and on-screen projects and the loading flag', async () => {
    const printed: string[] = []
    vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      printed.push(String(line))
    })
    // The field state this trace exists to catch: a project is active, nothing is loaded.
    tracePersist('commit-skip', {
      reason: commitSkipReason(null, 'project-code'),
      active: 'project-code',
      onScreen: null,
      loading: true
    })
    const file = path.join(dir, 'persist-trace.log')
    const trace = createPersistTrace({ file })
    for (const line of printed) traceFromConsole(line, trace)
    await trace.flushed()
    const text = await fs.readFile(file, 'utf8')
    expect(text).toContain(
      '{"side":"renderer","ev":"commit-skip","reason":"canvas-not-loaded","active":"project-code","onScreen":null,"loading":true}'
    )
  })
})
