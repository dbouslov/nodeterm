import { describe, it, expect, beforeEach } from 'vitest'
import { recordNodeClose } from './recordNodeClose'
import { useProjects } from '@renderer/state/projects'
import { useReopenHistory } from '@renderer/state/reopenHistory'
import { useAgentStatus } from '@renderer/state/agentStatus'
import { nodeStatesToFlow } from '@renderer/state/workspace'
import type { CanvasNodeState } from '@shared/types'

const agentNode = (id: string): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 10, y: 20 },
  size: { width: 320, height: 240 },
  title: id,
  color: '#888',
  group: null,
  agentId: 'claude',
  cwd: '/tmp/x'
})

const project = (id: string, nodes: CanvasNodeState[]) => ({
  id,
  name: id,
  color: '#111',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes
})

beforeEach(() => {
  // `off` is the project the close acts on; `on` is what the human is looking at. The whole point
  // of the off-screen close is that the two differ.
  useProjects.setState({
    projects: [project('on', []), project('off', [agentNode('a'), agentNode('b')])],
    activeProjectId: 'on'
  })
  useReopenHistory.setState({ stack: [] })
  useAgentStatus.getState().setSessionId('a', 'sess-live-a')
})

describe('recordNodeClose (the closed-session ledger + ⇧⌘T for a close, on or off screen)', () => {
  it('records an off-screen close against the STORED project, with the live session id', () => {
    const all = nodeStatesToFlow(useProjects.getState().getProject('off')!.nodes)
    recordNodeClose('off', new Set(['a']), all)

    const ledger = useProjects.getState().getProject('off')!.closedSessions ?? []
    expect(ledger).toHaveLength(1)
    expect(ledger[0].node.id).toBe('a')
    expect(ledger[0].sessionId).toBe('sess-live-a')
    // Not the canvas on screen.
    expect(useProjects.getState().getProject('on')!.closedSessions ?? []).toHaveLength(0)

    const stack = useReopenHistory.getState().stack
    expect(stack).toHaveLength(1)
    const entry = stack[0]
    expect(entry.kind === 'nodes' && entry.projectId).toBe('off')
    // The two ledgers stay correlated, so reopening one consumes the other.
    expect(entry.kind === 'nodes' && entry.nodes[0].closedSessionId).toBe(ledger[0].id)
  })

  it('both ledgers carry the same closedAt', () => {
    recordNodeClose('off', new Set(['a', 'b']), nodeStatesToFlow(useProjects.getState().getProject('off')!.nodes), 4242)
    const ledger = useProjects.getState().getProject('off')!.closedSessions ?? []
    expect(ledger.map((e) => e.closedAt)).toEqual([4242, 4242])
    expect(useReopenHistory.getState().stack[0].closedAt).toBe(4242)
  })

  it('records nothing for a kind neither ledger restores', () => {
    const group: CanvasNodeState = { ...agentNode('g'), kind: 'group', agentId: undefined }
    recordNodeClose('off', new Set(['g']), nodeStatesToFlow([group]))
    expect(useProjects.getState().getProject('off')!.closedSessions ?? []).toHaveLength(0)
    expect(useReopenHistory.getState().stack).toHaveLength(0)
  })
})
