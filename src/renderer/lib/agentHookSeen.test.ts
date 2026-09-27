import { describe, it, expect } from 'vitest'
import type { NormalizedAgentEvent } from '@shared/agents/normalize'
import { agentReadiness, installAgentReadiness, markAgentEnded, recordAgentHookForReadiness } from './agentHookSeen'

describe('recordAgentHookForReadiness — the readiness proof a typed /rename waits on (#39)', () => {
  it('a node nobody has heard from this run is unknown', () => {
    expect(agentReadiness('never')).toBe('unknown')
  })

  it('SessionStart marks the node live', () => {
    recordAgentHookForReadiness({ nodeId: 'a', kind: 'session', sessionPhase: 'start' })
    expect(agentReadiness('a')).toBe('live')
  })

  it('any other hook event (a state change) also proves the CLI is live', () => {
    recordAgentHookForReadiness({ nodeId: 'b', kind: 'state' })
    expect(agentReadiness('b')).toBe('live')
  })

  it('SessionEnd marks it ended: the next CLI launched in that pane must report in again', () => {
    recordAgentHookForReadiness({ nodeId: 'c', kind: 'session', sessionPhase: 'start' })
    recordAgentHookForReadiness({ nodeId: 'c', kind: 'session', sessionPhase: 'end' })
    expect(agentReadiness('c')).toBe('ended')
    recordAgentHookForReadiness({ nodeId: 'c', kind: 'session', sessionPhase: 'start' })
    expect(agentReadiness('c')).toBe('live')
  })

  it("a grok SUBAGENT's own session_end does not end the parent", () => {
    recordAgentHookForReadiness({ nodeId: 'g', kind: 'session', sessionPhase: 'start' })
    recordAgentHookForReadiness({ nodeId: 'g', kind: 'session', sessionPhase: 'end', subagentType: 'explore' })
    expect(agentReadiness('g')).toBe('live')
  })

  it('a fresh create / recycle ends it (markAgentEnded)', () => {
    recordAgentHookForReadiness({ nodeId: 'r', kind: 'state' })
    markAgentEnded('r')
    expect(agentReadiness('r')).toBe('ended')
  })

  it('is per node', () => {
    recordAgentHookForReadiness({ nodeId: 'd', kind: 'session', sessionPhase: 'start' })
    expect(agentReadiness('e')).toBe('unknown')
  })
})

describe('installAgentReadiness — the subscription Canvas installs (#39)', () => {
  const fakeApi = () => {
    let cb: ((e: NormalizedAgentEvent) => void) | null = null
    return {
      emit: (e: Partial<NormalizedAgentEvent>) => cb?.({ agentId: 'claude', ...e } as NormalizedAgentEvent),
      api: {
        onAgentStatus: (f: (e: NormalizedAgentEvent) => void) => {
          cb = f
          return () => {
            cb = null
          }
        }
      }
    }
  }

  it('feeds every emitted event into the registry, and stops on unsubscribe', () => {
    const f = fakeApi()
    const off = installAgentReadiness(f.api)
    f.emit({ nodeId: 'ia', kind: 'session', sessionPhase: 'start' })
    expect(agentReadiness('ia')).toBe('live')
    f.emit({ nodeId: 'ia', kind: 'session', sessionPhase: 'end' })
    expect(agentReadiness('ia')).toBe('ended')
    off()
    f.emit({ nodeId: 'ia', kind: 'state' })
    expect(agentReadiness('ia')).toBe('ended')
  })
})
