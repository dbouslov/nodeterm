// `retire --successor <id>`: a retiring chat hands its place on the canvas to a session it opened,
// then closes. MAIN decides whether it may (this file); the renderer decides the geometry
// (`src/renderer/lib/retire.ts`). The decision is main-side for the `browser` verb's reason: the
// proof lives here, and the renderer is the more attackable half.
import { IPC } from '../shared/ipc'
import { dryRunRequested } from '../shared/control-verbs'
import type { CorePlatform } from './platform'
import { strictRefusalFor } from './agents/node-identity-policy'

/** The verbs whose reply names the session nodes the call created (`result.ids`). */
const OPEN_VERBS: ReadonlySet<string> = new Set(['open-terminal', 'open-claude', 'open-agent'])

/**
 * Which node's open call created which node, THIS app run — the only proof `retire` accepts.
 *
 * Never project.json and never the persisted opener rope: both are git-shared and hand-editable, so
 * a cloned project could name any node as opened by any caller. In memory only, so it is empty after
 * a restart and retire fails closed until the caller opens a fresh successor.
 *
 * Keyed by node id, NOT by pane: an off-screen park (the PTY client is killed, tmux lives) and its
 * re-mount (an attach) never touch it. Only a real close ends a proof — see `forgetOnClose`.
 */
export class OpenerLedger {
  /** created node id → the node whose open call created it */
  private readonly openerOf = new Map<string, string>()

  record(openerId: string, ids: readonly string[]): void {
    for (const id of ids) this.openerOf.set(id, openerId)
  }

  opened(openerId: string, nodeId: string): boolean {
    return this.openerOf.get(nodeId) === openerId
  }

  /** `nodeId` really closed: it is nobody's successor now, and nothing it opened is its any more. */
  forget(nodeId: string): void {
    this.openerOf.delete(nodeId)
    for (const [id, opener] of this.openerOf) if (opener === nodeId) this.openerOf.delete(id)
  }
}

/**
 * Record the nodes a successful open call created — only when the caller's identity verdict for
 * THIS request was `verified` (main's own verdict, never a wire field), as the browser ledger does.
 * A dry run created nothing, and a reply without a string `ids` array records nothing.
 */
export function recordOpenReply(
  ledger: OpenerLedger,
  req: { verb: string; nodeId: string; args: Record<string, string>; verified: boolean },
  reply: { ok: boolean; result?: unknown }
): void {
  if (!OPEN_VERBS.has(req.verb) || !req.verified || !reply.ok || dryRunRequested(req.args)) return
  const ids = (reply.result as { ids?: unknown } | undefined)?.ids
  if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) ledger.record(req.nodeId, ids)
}

/**
 * May `nodeId` retire into `args.successor`? `null` = forward it: the renderer checks the rest (on
 * the canvas, a session node, this project) against the live canvas. Otherwise, the refusal.
 */
export function retireRefusal(
  ledger: OpenerLedger,
  req: { nodeId: string; args: Record<string, string>; verified: boolean }
): string | null {
  // The belt to hook-server's strict bucket, which refuses an unverified retire before any handler.
  if (!req.verified) return strictRefusalFor('retire')
  const successor = (req.args.successor ?? '').trim()
  if (!successor) return 'retire requires --successor <id>'
  if (successor === req.nodeId) {
    return `retire: --successor names you (${successor}) — name the session that replaces you`
  }
  if (!ledger.opened(req.nodeId, successor)) {
    return (
      `retire: ${successor} is not a session you opened during this app run — open your successor ` +
      'with open-claude or open-agent, then retire into it. The proof ends when that node closes or ' +
      'the app restarts. Nothing changed.'
    )
  }
  return null
}

/** End proofs on a REAL close only. Not `ptyKill` (a park), not `ptyCreate` (a re-mount), not
 *  `ptyRecycle` (a restart keeps the node): each of those leaves the node on the canvas. */
export function forgetOnClose(platform: Pick<CorePlatform, 'on'>, ledger: OpenerLedger): void {
  platform.on(IPC.ptyDestroy, (nodeId: string) => ledger.forget(nodeId))
}
