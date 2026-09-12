import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * STRUCTURAL pins for the context-link push — the same class of test as
 * `control-cold-open.source.test.ts`: the wiring lives inside a 12,000-line component with no unit
 * seam, and a push that is never started compiles, typechecks and passes every behavioural test of
 * `lib/contextLinkSync` while shipping inert. The behaviour is proven there, against the real
 * projects and agent-status stores.
 *
 * THE BUG (2026-09-11): the push was a Canvas effect keyed on the visible canvas only, behind a
 * trailing debounce every re-run reset. An orchestrator in a background project opened sessions,
 * was told "context-linked to you", and could read none of them until the user drew a link by hand.
 */
const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const count = (needle: string): number => src.split(needle).length - 1

describe('the context-link push (source pins)', () => {
  it('starts ONE sync, and that sync is the only thing that sends the map', () => {
    expect(count('startContextLinkSync(')).toBe(1)
    expect(count('contextLink.setLinks(')).toBe(1)
    const start = src.indexOf('startContextLinkSync(')
    const send = src.indexOf('contextLink.setLinks(')
    const end = src.indexOf('linkSyncRef.current = sync', start)
    expect(send).toBeGreaterThan(start)
    expect(send).toBeLessThan(end)
  })

  it('tells the sync about every live edge/node change instead of scheduling its own push', () => {
    expect(src).toContain('linkSyncRef.current?.invalidate()')
    expect(src).not.toMatch(/setTimeout\(\(\) => void window\.nodeTerminal\.contextLink\.setLinks/)
  })
})
