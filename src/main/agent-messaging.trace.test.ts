/**
 * The persist trace hears every messaging-gate refusal (diagnostics only). What it adds to a
 * refusal: which persisted canvas the gate read, and how old that canvas was — the fact that
 * explains a `cross-project` answer for a chat the canvas simply had not saved yet. What it must
 * never do: change an answer, or carry the message body.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { deliverFromControl, type AgentMessagingDeps } from '../core/agents/agent-messaging'
import { resetMessageFlow } from '../core/agents/agent-message-flow'
import { resetAgentMessageTraceForTests } from '../core/agents/agent-message-trace'
import { MANAGED_SCRIPT_REVISION } from '../core/agents/hooks/managed-script'

function fakeDeps(over: Partial<AgentMessagingDeps> = {}): AgentMessagingDeps {
  const projects = () => [
    { id: 'p1', nodes: [{ id: 'a1', title: 'Alpha', agentId: 'claude' }, { id: 'b1', title: 'Beta', agentId: 'claude' }] },
    { id: 'p2', nodes: [{ id: 'c2', title: 'Gamma', agentId: 'claude' }] }
  ]
  return {
    paneOwner: async () => ({
      tty: '/dev/pts/9',
      panePid: 100,
      paneId: '%1',
      command: 'claude',
      argv: ['claude'],
      pids: [200]
    }),
    sendEnvelope: async () => true,
    hasLiveSession: async () => true,
    mirrorEntry: () => ({ state: 'done', updatedAt: 1, stateVerified: true, clientRevision: MANAGED_SCRIPT_REVISION }),
    projects,
    isRemoteNode: () => false,
    messagingEnabled: () => true,
    paneOwnerProject: (id) => projects().find((p) => p.nodes.some((n) => n.id === id))?.id,
    customAgents: () => undefined,
    appendBoardLog: async () => false,
    subscribeReceipts: (cb) => {
      const t = setTimeout(() => cb({ nodeId: 'b1', newTurn: true, verified: true }), 5)
      return () => clearTimeout(t)
    },
    now: () => 1_000_000,
    ...over
  }
}

const req = (over: Record<string, unknown> = {}) =>
  ({ verb: 'send', sourceNodeId: 'a1', targetNodeId: 'b1', body: 'hello', ...over }) as never

beforeEach(() => {
  resetMessageFlow()
  resetAgentMessageTraceForTests()
})

describe('messaging-gate refusals reach the persist trace', () => {
  it('names the refusal, the persisted canvas the gate read and its age — never the body', async () => {
    const lines: { ev: string; fields: Record<string, unknown> }[] = []
    const deps = fakeDeps({
      trace: (ev, fields) => lines.push({ ev, fields }),
      canvasAgeMs: (id) => (id === 'p1' ? 1234 : undefined)
    })
    const { outcome } = await deliverFromControl(req({ targetNodeId: 'c2', body: 'secret prompt text' }), deps)
    expect(outcome).toEqual({ kind: 'notPermitted', reason: 'cross-project' })
    expect(lines).toEqual([
      {
        ev: 'gate-refuse',
        fields: {
          verb: 'send',
          reason: 'cross-project',
          source: 'a1',
          target: 'c2',
          canvas: 'p1',
          canvasAgeMs: 1234,
          canvases: 2,
          targetFound: true
        }
      }
    ])
    expect(JSON.stringify(lines)).not.toContain('secret')
  })

  // The field shape: the SOURCE itself was opened after the last save, so no persisted canvas
  // lists it at all.
  it('says when the source is in no persisted canvas', async () => {
    const lines: Record<string, unknown>[] = []
    const deps = fakeDeps({ trace: (_ev, fields) => lines.push(fields), canvasAgeMs: () => 5 })
    await deliverFromControl(req({ sourceNodeId: 'new1', targetNodeId: 'b1' }), deps)
    expect(lines).toEqual([
      expect.objectContaining({ reason: 'cross-project', canvas: null, canvasAgeMs: null })
    ])
  })

  it('gives the same answer with or without a trace hook, and with one that throws', async () => {
    const plain = await deliverFromControl(req({ targetNodeId: 'c2' }), fakeDeps())
    resetMessageFlow()
    const traced = await deliverFromControl(
      req({ targetNodeId: 'c2' }),
      fakeDeps({ trace: () => {}, canvasAgeMs: () => 1 })
    )
    resetMessageFlow()
    const throwing = await deliverFromControl(
      req({ targetNodeId: 'c2' }),
      fakeDeps({
        trace: () => {
          throw new Error('disk full')
        }
      })
    )
    expect(traced).toEqual(plain)
    expect(throwing).toEqual(plain)
  })

  it('writes nothing for a delivered message', async () => {
    const events: string[] = []
    const { outcome } = await deliverFromControl(req(), fakeDeps({ trace: (ev) => events.push(ev) }))
    expect(outcome.kind).toBe('delivered')
    expect(events).toEqual([])
  })
})
