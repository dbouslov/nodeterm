import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startContextLinkSync, LINK_PUSH_DELAY_MS, type ContextLinkSync, type LiveLinkCanvas } from './contextLinkSync'
import { useProjects } from '../state/projects'
import { useAgentStatus } from '../state/agentStatus'
import type { BridgeLink, CanvasNodeState, ContextLinkMap } from '@shared/types'
import type { LinkNodeInfo } from '@shared/context-link-map'

const VP = { x: 0, y: 0, zoom: 1 }
const node = (id: string, over: Partial<CanvasNodeState> = {}): CanvasNodeState =>
  ({
    id,
    kind: 'terminal',
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    title: id,
    color: '',
    group: null,
    agentId: 'claude',
    ...over
  }) as CanvasNodeState
const bridge = (source: string, target: string): BridgeLink => ({ id: `bridge-${source}-${target}`, source, target })
const ids = (map: ContextLinkMap | undefined, nodeId: string): string[] => (map?.[nodeId] ?? []).map((e) => e.id)
const info = (id: string): LinkNodeInfo => ({ id, title: id, cwd: '', sticky: false, agentId: 'claude' })

let sent: ContextLinkMap[]
let sync: ContextLinkSync | null
let live: LiveLinkCanvas
const last = (): ContextLinkMap | undefined => sent[sent.length - 1]
const start = (send: (m: ContextLinkMap) => unknown = (m) => void sent.push(m)): ContextLinkSync =>
  (sync = startContextLinkSync({ live: () => live, send }))

/**
 * The shape of the 2026-09-11 field report: the orchestrator's project ("Code") is NOT the one on
 * screen ("School"), and it already holds one hand-drawn bridge.
 */
function seed(): { code: string; school: string } {
  const code = useProjects.getState().addProject('Code').id
  useProjects
    .getState()
    .commitCanvas(code, [node('orch'), node('old'), node('child')], VP, [bridge('old', 'orch')], [])
  const school = useProjects.getState().addProject('School').id
  live = { projectId: school, edges: [], infoOf: info }
  return { code, school }
}

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  sync = null
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})
afterEach(() => {
  sync?.stop()
  for (const id of Object.keys(useAgentStatus.getState().byId)) useAgentStatus.getState().remove(id)
  vi.useRealTimers()
})

describe('startContextLinkSync — every input of the map triggers a push', () => {
  it('pushes a bridge a cold open writes into a project that is not on screen, for BOTH endpoints', async () => {
    const { code } = seed()
    start()
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(ids(last(), 'orch')).toEqual(['old'])

    // What the cold `open-claude` branch does (Canvas → appendCanvasLinks): the store changes and
    // nothing on the visible canvas does. The old push was keyed on the visible canvas only.
    useProjects.getState().appendCanvasLinks(code, { bridges: [bridge('orch', 'child')] })
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(ids(last(), 'orch')).toEqual(['old', 'child'])
    expect(ids(last(), 'child')).toEqual(['orch'])
  })

  it('re-pushes when a background node reports its session, so the link gains its transcript', async () => {
    seed()
    start()
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(last()?.orch?.[0]?.sessionId).toBeUndefined()

    useAgentStatus.getState().setSessionId('old', 'sess-old')
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(last()?.orch?.[0]).toMatchObject({ id: 'old', sessionId: 'sess-old' })
  })

  it('takes the MOUNTED project from the live canvas and ignores its stale serialized copy', async () => {
    const { school } = seed()
    // The store's copy of the mounted project is whatever the last commit wrote — here a link the
    // user has since deleted on the live canvas. React Flow is the truth for that project.
    useProjects.getState().commitCanvas(school, [node('s1'), node('s2')], VP, [bridge('s1', 's2')], [])
    live = { projectId: school, edges: [{ source: 's2', target: 'orch-x' }], infoOf: info }
    start()
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(last()?.s1).toBeUndefined()
    expect(ids(last(), 's2')).toEqual(['orch-x'])
    expect(ids(last(), 'orch')).toEqual(['old']) // the background project still comes from the store
  })
})

describe('startContextLinkSync — coalesced, never starved, never redundant', () => {
  it('sends an unchanged map once, however often the canvas churns', async () => {
    seed()
    start()
    for (let t = 0; t < 1000; t += 20) {
      sync!.invalidate()
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(sent).toHaveLength(1)
  })

  it('delivers a change within one window WHILE the canvas keeps churning', async () => {
    // The old push was a trailing debounce that every re-run cleared, and the canvas `nodes`
    // array changes identity on every React Flow change batch — so a busy canvas could hold a new
    // link off indefinitely.
    const { school } = seed()
    start()
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    live = { projectId: school, edges: [{ source: 'a', target: 'b' }], infoOf: info }
    for (let t = 0; t <= LINK_PUSH_DELAY_MS; t += 20) {
      sync!.invalidate()
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(ids(last(), 'a')).toEqual(['b'])
  })

  it('retries a push main never received on the next change', async () => {
    seed()
    let fail = true
    start((m) => {
      if (fail) return Promise.reject(new Error('no handler'))
      sent.push(m)
    })
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(sent).toHaveLength(0)
    fail = false
    sync!.invalidate() // same content as the failed push — it must not count as delivered
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS)
    expect(ids(last(), 'orch')).toEqual(['old'])
  })

  it('stop() ends the subscriptions and any pending push', async () => {
    const { code } = seed()
    start()
    sync!.stop()
    useProjects.getState().appendCanvasLinks(code, { bridges: [bridge('orch', 'child')] })
    await vi.advanceTimersByTimeAsync(LINK_PUSH_DELAY_MS * 4)
    expect(sent).toHaveLength(0)
  })
})
