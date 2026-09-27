import { describe, it, expect } from 'vitest'
import { agentHookSeen, recordAgentHookForReadiness } from './agentHookSeen'

describe('recordAgentHookForReadiness — the readiness proof a typed /rename waits on (#39)', () => {
  it('a node nobody has heard from is not ready', () => {
    expect(agentHookSeen('never')).toBe(false)
  })

  it('SessionStart marks the node ready', () => {
    recordAgentHookForReadiness({ nodeId: 'a', kind: 'session', sessionPhase: 'start' })
    expect(agentHookSeen('a')).toBe(true)
  })

  it('any other hook event (a state change) also proves the CLI is live', () => {
    recordAgentHookForReadiness({ nodeId: 'b', kind: 'state' })
    expect(agentHookSeen('b')).toBe(true)
  })

  it('SessionEnd withdraws it: the next CLI launched in that pane must report in again', () => {
    recordAgentHookForReadiness({ nodeId: 'c', kind: 'session', sessionPhase: 'start' })
    recordAgentHookForReadiness({ nodeId: 'c', kind: 'session', sessionPhase: 'end' })
    expect(agentHookSeen('c')).toBe(false)
  })

  it('is per node', () => {
    recordAgentHookForReadiness({ nodeId: 'd', kind: 'session', sessionPhase: 'start' })
    expect(agentHookSeen('e')).toBe(false)
  })
})
