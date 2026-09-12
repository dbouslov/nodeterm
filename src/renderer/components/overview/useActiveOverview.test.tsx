// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasNodeState, Project } from '@shared/types'
import { buildFindings } from '../../lib/networkOverview'
import { useAgentStatus } from '../../state/agentStatus'
import { useLaunchDelivery } from '../../state/launchDelivery'
import { useProjects } from '../../state/projects'
import { useSettings } from '../../state/settings'
import { useActiveOverview, type ActiveOverview } from './useActiveOverview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  title: id,
  color: '#888',
  group: null,
  ...extra
})

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'p',
  color: '#fff',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  ...over
})

let root: Root | null = null
let renders: (ActiveOverview | null)[] = []
function Probe() {
  renders.push(useActiveOverview())
  return null
}
function mount(): void {
  root = createRoot(document.createElement('div'))
  act(() => root!.render(<Probe />))
}
const latest = (): ActiveOverview | null => renders[renders.length - 1]

const prevSettings = useSettings.getState().settings
beforeEach(() => {
  renders = []
  useAgentStatus.setState({ byId: {} })
  useLaunchDelivery.setState({ byId: {} })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  useSettings.setState({ settings: prevSettings })
  vi.useRealTimers()
})

describe('useActiveOverview', () => {
  it('reads the ACTIVE project from the store, never another tab', () => {
    useProjects.setState({
      projects: [
        project({ id: 'p1', nodes: [node('other')] }),
        project({
          id: 'p2',
          name: 'Research',
          color: '#0a84ff',
          nodes: [node('a'), node('b')],
          bridges: [{ id: 'l', source: 'a', target: 'b' }]
        })
      ],
      activeProjectId: 'p2'
    })
    mount()
    const active = latest()!
    expect(active.projectName).toBe('Research')
    expect(active.projectColor).toBe('#0a84ff')
    expect(active.input.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(active.input.bridges).toEqual([{ id: 'l', source: 'a', target: 'b' }])
    expect(active.input.ropes).toEqual([])
  })

  it('is null with no active project', () => {
    useProjects.setState({ projects: [project()], activeProjectId: '' })
    mount()
    expect(latest()).toBeNull()
  })

  it('takes the idle threshold from the Eco setting, in ms', () => {
    useSettings.setState({ settings: { ...prevSettings, agentHibernationIdleMinutes: 45 } })
    useProjects.setState({ projects: [project()], activeProjectId: 'p1' })
    mount()
    expect(latest()!.input.idleMs).toBe(2_700_000)
  })

  it('an unusable threshold flags nothing idle, the way Eco then hibernates nothing', () => {
    // settings.json is hand-editable and merged unclamped (terminal/hibernation-policy.ts refuses
    // anything not > 0). A 1-minute floor would disagree with Eco and flag every done agent.
    const doneAt = Date.now() - 2 * 60 * 60_000
    useProjects.setState({ projects: [project({ nodes: [node('a', { agentId: 'claude' })] })], activeProjectId: 'p1' })
    useAgentStatus.setState({ byId: { a: { unread: false, state: 'done', lastEventAt: doneAt } } })
    useSettings.setState({ settings: { ...prevSettings, agentHibernationIdleMinutes: 30 } })
    mount()
    const idle = () => buildFindings(latest()!.input).filter((f) => f.kind === 'idle')
    expect(idle().map((f) => f.nodeId)).toEqual(['a'])
    for (const minutes of [0, Number.NaN, -5]) {
      act(() => useSettings.setState({ settings: { ...prevSettings, agentHibernationIdleMinutes: minutes } }))
      expect(idle()).toEqual([])
    }
  })

  it('re-renders for a status change the overview shows, and not for one it does not', () => {
    useProjects.setState({ projects: [project({ nodes: [node('a', { agentId: 'claude' })] })], activeProjectId: 'p1' })
    mount()
    const before = renders.length
    act(() => useAgentStatus.setState({ byId: { a: { unread: false, state: 'working', lastEventAt: 5 } } }))
    expect(latest()!.input.statusById.a?.state).toBe('working')
    const after = renders.length
    expect(after).toBeGreaterThan(before)
    // Identity proof is nothing a card or a finding reads: a hook event carrying only that must not
    // re-render the overlay (the whole-map subscription Canvas also refuses, see loopSig).
    act(() =>
      useAgentStatus.setState({
        byId: { a: { unread: false, state: 'working', lastEventAt: 5, stateVerified: true } }
      })
    )
    expect(renders.length).toBe(after)
  })

  it('ticks once a minute, so a done agent turns idle with nothing else changing', () => {
    vi.useFakeTimers()
    const t0 = 10 * 60 * 60_000
    vi.setSystemTime(t0)
    useSettings.setState({ settings: { ...prevSettings, agentHibernationIdleMinutes: 30 } })
    // Done 29.5 minutes ago: not idle yet, idle one tick later. Both clocks carry the same stamp so
    // the fixture does not depend on which one the idle rule reads.
    const doneAt = t0 - 29.5 * 60_000
    useProjects.setState({ projects: [project({ nodes: [node('a', { agentId: 'claude' })] })], activeProjectId: 'p1' })
    useAgentStatus.setState({ byId: { a: { unread: false, state: 'done', stateAt: doneAt, lastEventAt: doneAt } } })
    mount()
    const idle = () => buildFindings(latest()!.input).filter((f) => f.kind === 'idle')
    expect(idle()).toEqual([])
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(idle().map((f) => f.nodeId)).toEqual(['a'])
  })
})
