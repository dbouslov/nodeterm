// Which nodes' agent CLIs have reported a hook event in this app run — the readiness proof for
// typing into an agent pane (issue #39).
//
// A non-shell owning the pane (`#{pane_current_command}`) only says the CLI process exists. It
// does not say its TUI is reading input yet, and input that arrives in between is DROPPED:
// measured on Claude Code 2.1.283, text pasted in the ~0.4 s just before its SessionStart hook
// fired never reached the input box, while everything after SessionStart did. A hook event comes
// from inside the CLI, so it is the first thing that proves the session is live.
//
// Module-level and non-reactive on purpose: it is written on EVERY hook event, and nothing renders
// from it — a zustand field here would re-render every whole-map subscriber per event.
// Transient: a CLI running since before this app run has reported nothing yet, which is why every
// reader bounds its wait instead of treating "not seen" as "not ready, ever".

import type { NormalizedAgentEvent } from '@shared/agents/normalize'

const seen = new Set<string>()

/**
 * Canvas's hook listener calls this for EVERY event: any event marks the node live, a SessionEnd
 * withdraws it (the CLI exited; whatever launches next in that pane has not proven itself yet).
 */
export function recordAgentHookForReadiness(e: Pick<NormalizedAgentEvent, 'nodeId' | 'kind' | 'sessionPhase'>): void {
  if (e.kind === 'session' && e.sessionPhase === 'end') clearAgentHookSeen(e.nodeId)
  else markAgentHookSeen(e.nodeId)
}

/** Any hook event from this node's agent: its CLI is up and taking input. */
export function markAgentHookSeen(nodeId: string): void {
  seen.add(nodeId)
}

/** The CLI ended its session (SessionEnd): the next launch in this pane must prove itself again. */
export function clearAgentHookSeen(nodeId: string): void {
  seen.delete(nodeId)
}

export function agentHookSeen(nodeId: string): boolean {
  return seen.has(nodeId)
}
