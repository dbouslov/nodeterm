// Bring a node's session up with NO node mounted — the background half of a cold open (#38).
//
// A session used to be spawned by exactly one thing: `TerminalNode`'s mount effect. React Flow
// holds only the active project's nodes, so a chat opened into any other project had no process
// behind it until somebody viewed that project, and its held launch (`pendingLaunch`) waited with
// it — a whole project once sat idle for seven days. The spawn does not actually need the node:
// `transport.create` keyed by the node id starts the tmux session `nt-<id>`, and tmux keeps it once
// the client detaches. The node's later mount then reattaches to it (a warm, not-fresh create) like
// any park, and the held launch is pasted by name in between (`deliverInBackground`).
//
// The caller passes a transport with its OWN viewerId, the kanban card modal's pattern: if the
// user switches to the project while this is in flight, the canvas node co-attaches as a separate
// subscriber, and the detach below leaves its view alone.

import type { PtyCreateOptions } from '@shared/types'
import type { TerminalTransport } from './transport'
import { markAgentEnded } from '../lib/agentHookSeen'

/** TerminalNode's `whenShellSettled`: quiet for this long after output means the prompt is up… */
const SETTLE_QUIET_MS = 200
/** …and no output at all for this long means write anyway. */
const SETTLE_CAP_MS = 1500

/**
 * Spawn the session, wait for its shell to settle, detach. True = a tmux-backed session is up and
 * can be typed into by name. Settling first matters for the same reason it does on a mount: the
 * held launch is an agent CLI line, and one pasted across zsh's rc-file tty flush comes out mangled.
 *
 * False = nothing was started that anyone could use, and the launch stays with the on-screen loop:
 * a refused or failed create, or a session that is NOT persistent (no tmux) — a plain shell dies
 * with its client, so it is killed at once rather than left running where no mount can reach it.
 */
export async function startDetached(
  transport: Pick<TerminalTransport, 'create' | 'onData' | 'kill'>,
  options: PtyCreateOptions
): Promise<boolean> {
  // The held launch is typed into this session next; until that CLI reports in, a typed `/rename`
  // waits (issue #39). Marked here too, not only on a fresh create: an existing session's age would
  // otherwise vouch for a CLI still starting (the 1.5 s settle cap is shorter than a slow start).
  if (options.persistKey) markAgentEnded(options.persistKey)
  let result
  try {
    result = await transport.create(options)
  } catch {
    return false
  }
  if (result.closed || result.unavailable || !result.sessionId) return false
  const sid = result.sessionId
  // Absent = an older core over the relay: assume persistent, as TerminalNode does.
  if (result.persistent === false) {
    transport.kill(sid)
    return false
  }
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const fire = (): void => {
      unsub()
      resolve()
    }
    const unsub = transport.onData(sid, () => {
      clearTimeout(timer)
      timer = setTimeout(fire, SETTLE_QUIET_MS)
    })
    timer = setTimeout(fire, SETTLE_CAP_MS)
  })
  transport.kill(sid)
  return true
}
