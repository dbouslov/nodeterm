// Which nodes' agent CLIs are known to be taking input in this app run — the readiness proof for
// typing into an agent pane (issue #39).
//
// A non-shell owning the pane (`#{pane_current_command}`) only says the CLI process exists. It
// does not say its TUI is reading input yet, and input that arrives in between is DROPPED:
// measured on Claude Code 2.1.283, text pasted in the ~0.4 s just before its SessionStart hook
// fired never reached the input box, while everything after SessionStart did. A hook event comes
// from inside the CLI, so it is the first thing that proves the session is live.
//
// Three answers, not two:
//  - `live`    a hook event arrived since the last launch — type away.
//  - `ended`   we KNOW the pane's CLI is new or gone: a SessionEnd, a fresh pty create, a recycle.
//              Only a hook event may make it `live` again.
//  - `unknown` nothing observed this run (a CLI running since before an app restart reports
//              nothing until its next turn). A reader may fall back on other evidence (the
//              session's age) or a bounded wait — never on "not seen = not ready, ever".
//
// Module-level and non-reactive on purpose: it is written on EVERY hook event, and nothing renders
// from it — a zustand field here would re-render every whole-map subscriber per event.

import type { NormalizedAgentEvent } from '@shared/agents/normalize'

export type AgentReadiness = 'live' | 'ended' | 'unknown'

const state = new Map<string, 'live' | 'ended'>()

/**
 * Subscribe the registry to a session's agent-status stream (Canvas installs it once per api).
 * Returns the unsubscribe. Its own subscription rather than a line inside Canvas's big listener,
 * so the wiring is tested here against a fake api instead of by reading Canvas's source.
 */
export function installAgentReadiness(api: {
  onAgentStatus(cb: (e: NormalizedAgentEvent) => void): () => void
}): () => void {
  return api.onAgentStatus((e) => recordAgentHookForReadiness(e))
}

/**
 * Every hook event: any event marks the node live, a SessionEnd
 * marks it ended (the CLI exited; whatever launches next in that pane has not proven itself yet).
 * A grok SUBAGENT's own session_end (it carries `subagentType`) is the child's teardown, not the
 * parent's, and changes nothing.
 */
export function recordAgentHookForReadiness(
  e: Pick<NormalizedAgentEvent, 'nodeId' | 'kind' | 'sessionPhase' | 'subagentType'>
): void {
  if (e.kind === 'session' && e.sessionPhase === 'end') {
    if (!e.subagentType) markAgentEnded(e.nodeId)
  } else markAgentHookSeen(e.nodeId)
}

/** Any hook event from this node's agent: its CLI is up and taking input. */
export function markAgentHookSeen(nodeId: string): void {
  state.set(nodeId, 'live')
}

/**
 * The pane's CLI is gone or brand new — a SessionEnd, a fresh create, a recycle, or the renderer
 * itself about to type a CLI launch into the pane (a resume, a held launch): it must report in again.
 * Marking BEFORE the write matters for an old session, whose age would otherwise vouch for a CLI
 * that is still starting.
 */
export function markAgentEnded(nodeId: string): void {
  state.set(nodeId, 'ended')
}

/** The node's session was destroyed (node deleted): nothing to remember. */
export function forgetAgentReadiness(nodeId: string): void {
  state.delete(nodeId)
}

export function agentReadiness(nodeId: string): AgentReadiness {
  return state.get(nodeId) ?? 'unknown'
}
