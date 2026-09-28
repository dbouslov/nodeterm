import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * STRUCTURAL pins for the upstream #967 port (nodesEpoch.ts) in the fork's Canvas. The behaviour is
 * proven against real React in `nodesEpoch.test.tsx`; what this file pins is that Canvas actually
 * routes the epoch tag through the hook, and that the fork's persist traces survived the merge.
 *
 * THE BUG: the load effect wrote `nodesProjectIdRef` directly while `nodesRef` was re-mirrored from
 * state, so a SyncLane re-render between `setNodes(flow)` and its landing paired the previous
 * project's nodes with the new project's id (field bug 2026-09-26).
 */
const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('Canvas epoch tag (upstream #967)', () => {
  it('mirrors nodes and their project through useNodesEpoch', () => {
    expect(src).toMatch(/useNodesEpoch\(nodes\)/)
    expect(src).toMatch(/installEpoch\(project\.id, flow\)/)
  })

  it('never assigns the epoch tag ref directly', () => {
    expect(src.match(/nodesProjectIdRef\.current\s*=(?!=)/g) ?? []).toHaveLength(0)
  })

  it('keeps the fork persist traces around the load effect', () => {
    expect(src).toContain("tracePersist('load'")
    expect(src.match(/tracePersist\('load-bail'/g) ?? []).toHaveLength(2)
  })
})
