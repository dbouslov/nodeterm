// Canvas sync — the reflector.
//
// Every attached client (an Electron renderer, a Server-Edition browser tab) casts its LOCAL node
// mutations on `canvas:mut`. This service stamps each one with a monotone `seq` and sends it back
// out on the same channel to EVERY attached client, so all clients converge on the same node set —
// a teammate's cursor never hovers over stale geometry, and a client whose canvas still held a node
// someone else deleted can no longer write it back on the next whole-file workspace.save.
//
// THE `seq` IS THE POINT, and it is the one piece of state here. Without a total order, two clients
// that edit the same node while each other's mutation is in flight apply them in OPPOSITE orders
// and diverge permanently — see the derivation in src/shared/canvas-order.ts, which is the client
// half of this contract. `seq` is server-authoritative: whatever the client put there is
// overwritten at ingest, so a client cannot forge its way to the front of the order.
//
// IT ECHOES TO THE SENDER TOO — that is deliberate, and it replaced the earlier sender-suppression.
// A sender's own echo is its ACK: it is the only way it learns where its edit landed in the total
// order, which is what lets it decide whether a peer's mutation supersedes its own optimistic
// state. The client drops the echo instead of re-applying it (canvas-order rule 1), so it does not
// fight its own optimistic state, and the publisher's `adopt` guard still means nothing is
// re-published: no loop.
//
// Beyond `seq` it is a pipe, not a store: it holds NO canvas state and persists nothing. The one
// policy it applies is the exec boundary (@shared/node-exec): `shell`/`ssh.extraArgs` never pass,
// and a held launch (`pendingLaunch`) passes only from an OWNER client to owner clients, stamped
// `origin: 'core'` (fanOutMutation). The canvas itself stays where it has always been — React Flow in each renderer — and the
// disk write stays with WorkspaceStore.
//
// NOT RATE-LIMITED, deliberately — unlike presence (see PRESENCE_RATE_BUDGETS). A presence cast is
// a SAMPLED signal whose loss is self-correcting: the next cursor frame carries the current
// position. A mutation is an EDGE: nothing supersedes it and nothing re-announces it, so a dropped
// one is LOST STATE — a node that never appears on a peer's canvas, or a delete that never lands
// (and then gets written back to disk by that peer's next save, which is the very bug Stage 3
// exists to fix). Legitimate traffic is also burstier than any bucket sized for it would survive:
// a drag emits at 20 Hz, and a bulk delete emits N mutations in ONE tick. What IS bounded is the
// PAYLOAD (see isCanvasMutation): an oversized or malformed mutation is refused at ingest, so a
// hostile cast cannot amplify into every peer's socket or wedge a peer's React Flow. If a budget
// is ever needed here, it must queue — never drop.
//
// No electron, no ws, no disk (see no-electron.test.ts).

import { platform, type CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import { isCanvasMutation, isRefId, MUTATION_MAX_BYTES } from '../shared/canvas-mutations'
import { sanitizeInboundMutation } from '../shared/node-exec'
import { type ClientId } from '../shared/presence'
import type { CanvasMutation } from '../shared/types'

// The ingest guard (`isCanvasMutation`) and its size cap live in `shared`, because the PUBLISHER
// must reach the same verdict BEFORE it casts: a mutation this reflector refuses is dropped
// silently, and a publisher that only learned about it by never hearing an ack would advance its
// baseline (never retrying the edit) and deafen that node to its peers for a whole pending TTL.
// Re-exported here because this is where the refusal is enforced, and where the tests look for it.
export { isCanvasMutation, MUTATION_MAX_BYTES }

/**
 * Every attached client the mutation goes to — INCLUDING the sender, whose copy is its ack (see the
 * header). Pure — exported for the test. `sender` is kept in the signature: it is the seam a policy
 * would need, and dropping it would make "the sender is included" look accidental rather than
 * chosen.
 */
export function reflectTargets(all: ClientId[], _sender: ClientId): ClientId[] {
  return all.slice()
}

/**
 * Stamp a client's mutation with its place in the total order, and BOUND the client-supplied `src`
 * tag (it is echoed to every peer, and a client could otherwise plant a megabyte there — or forge
 * another client's tag, which would only ever make that client ignore an edit meant for it, but is
 * still not something to reflect unchecked). Pure — exported for the test.
 */
export function stampMutation(m: CanvasMutation, seq: number): CanvasMutation {
  const stamped: CanvasMutation = { ...m, seq }
  if (!isRefId(stamped.src)) delete stamped.src
  // `origin: 'core'` is the core's own vouching (it lets a receiver take a held launch as sent), so a
  // client may never supply it. It is re-added below, per recipient, and only where it is true.
  delete (stamped as { origin?: unknown }).origin
  return stamped
}

/**
 * Deliver one stamped mutation to every client, deciding PER RECIPIENT whether the node's held launch
 * (`pendingLaunch`, machine-local — @shared/node-exec) goes with it. Pure over the platform —
 * exported for the test.
 *
 * `trusted` = the mutation came from an OWNER client or from the core itself. An owner recipient
 * then gets it with the launch and `origin: 'core'` (so two Server Edition tabs agree on who claimed
 * a launch — the exactly-once half); every other recipient (a relay peer, a hosted-team guest) gets
 * it WITHOUT the launch. An untrusted mutation carries no launch to anybody: a peer cannot arm,
 * re-arm or clear a launch on this machine.
 */
export function fanOutMutation(
  p: Pick<CorePlatform, 'clientIds' | 'sendTo' | 'isOwnerClient'>,
  projectId: string,
  stamped: CanvasMutation,
  trusted: boolean
): void {
  const vouched: CanvasMutation | null = trusted ? { ...stamped, origin: 'core' } : null
  const stripped = sanitizeInboundMutation(stamped)
  for (const id of p.clientIds()) {
    const owner = p.isOwnerClient?.(id) === true
    p.sendTo(id, IPC.canvasMut, projectId, vouched && owner ? vouched : stripped)
  }
}

/** The platform this reflector is already installed on. `on`/`onWithSender` COMPOSE on the same
 *  channel (ServerPlatform keeps an ordered SET per channel), so a second registration on the same
 *  platform would reflect every mutation twice. Keyed by platform, not a bare boolean, so a fresh
 *  boot (or a fresh test platform) registers again. */
let registeredOn: CorePlatform | null = null

/**
 * The total order. One counter for the whole process (not per project): `seq` is only ever compared
 * between mutations addressing the SAME node, and node ids are globally unique (a node id is a tmux
 * session name), so a single counter orders every canvas correctly and cannot be confused by a
 * client that switches projects. Reset with the registration, so a fresh boot starts from 0 — which
 * is safe because a client's ordering state (canvas-order) is per Canvas mount and starts empty too.
 */
let seq = 0

/**
 * Publish a mutation originated by the core itself (for example a headless Server Edition
 * control request). It takes the same validation, execution-field sanitization and total-order
 * stamp as a browser cast, then fans out to every connected canvas. Disk persistence remains the
 * caller's responsibility; this function is only the live convergence leg.
 */
export function publishCanvasMutation(projectId: string, mutation: CanvasMutation): boolean {
  if (!isRefId(projectId) || !isCanvasMutation(mutation)) return false
  const p = platform()
  // The core's own write: its held launch is authoritative for owner clients (a headless delivery
  // CLEARS it there — without that a browser would keep and re-save the stale launch).
  const stamped = stampMutation(sanitizeInboundMutation(mutation, true), ++seq)
  fanOutMutation(p, projectId, stamped, true)
  return true
}

/** Install the `canvas:mut` reflector. Call once at boot, after initPlatform(). */
export function initCanvasSync(): void {
  const p = platform()
  if (registeredOn === p) return
  registeredOn = p
  seq = 0
  p.onWithSender(IPC.canvasMut, (senderId: number, projectId: unknown, mutation: unknown) => {
    // Which canvas the edit belongs to is client-supplied too, and it is reflected verbatim.
    if (!isRefId(projectId)) return
    if (!isCanvasMutation(mutation)) return
    // Stamped ONCE, here: the order every client will agree on. The sender is in the target list —
    // its copy is the ack that tells it where its own edit landed (see the header).
    // The exec-enabling node fields (`shell`, `ssh.extraArgs`) are stripped HERE too, so they are
    // not even reflected to the other clients: a peer must not be able to put a program name or an
    // `-o ProxyCommand=…` into anybody's canvas (@shared/node-exec). Every receiver strips them
    // again on apply — this is the cheap upstream half.
    // A held launch (`pendingLaunch`) is kept only when the SENDER is an owner client, and then
    // forwarded only to owner clients (fanOutMutation).
    const fromOwner = p.isOwnerClient?.(senderId) === true
    const stamped = stampMutation(sanitizeInboundMutation(mutation, fromOwner), ++seq)
    fanOutMutation(
      { clientIds: () => reflectTargets(p.clientIds(), senderId), sendTo: p.sendTo.bind(p), isOwnerClient: p.isOwnerClient?.bind(p) },
      projectId,
      stamped,
      fromOwner
    )
  })
}
