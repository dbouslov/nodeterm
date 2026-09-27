import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Structural pins for the #39 readiness registry's two writers that no test renders. The rules
 * themselves are proven in agentHookSeen.test.ts and sessionRename.test.ts; what only the source
 * can state is that Canvas's hook listener and TerminalNode's fresh create actually call them.
 * Without the listener, every rename waits the full 10 s and then sends blind — silently, since
 * the fallback still sends.
 */
const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('agent readiness wiring (source pins)', () => {
  it("Canvas's agent-status listener records EVERY event, before it branches on the kind", () => {
    const canvas = read('../canvas/Canvas.tsx')
    const start = canvas.indexOf('return api.onAgentStatus((e: NormalizedAgentEvent) => {')
    expect(start).toBeGreaterThan(-1)
    const firstSwitch = canvas.indexOf('switch (e.kind)', start)
    const call = canvas.indexOf('recordAgentHookForReadiness(e)', start)
    expect(call).toBeGreaterThan(start)
    // Above the switch, so no `case`/early return can skip it.
    expect(firstSwitch === -1 || call < firstSwitch).toBe(true)
  })

  it('a fresh tmux session marks the node ended (TerminalNode create continuation)', () => {
    expect(read('../nodes/TerminalNode.tsx')).toContain('if (coldStart) markAgentEnded(id)')
  })
})
