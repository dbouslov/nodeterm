import type { CanvasNode } from '@renderer/state/workspace'
import { useProjects } from '@renderer/state/projects'
import { useReopenHistory } from '@renderer/state/reopenHistory'
import { useAgentStatus } from '@renderer/state/agentStatus'
import { buildClosedSessionEntries } from './closedHistory'
import { snapshotNode } from './reopenNode'
import { uuid } from './uuid'

/**
 * Records a node close in BOTH histories — the persisted "Recently closed" ledger
 * (`closedSessions`) and the in-memory ⇧⌘T stack — against `projectId`. The one funnel for the
 * on-screen close (`deleteNodes`, over the live React Flow array) and the off-screen one
 * (`closeStoredNodes`, over the stored project's nodes hydrated by `nodeStatesToFlow`). The
 * off-screen close used to record neither, so a chat closed while its project was not on screen
 * lost its transcript pointer (issue #531's whole purpose) and could not be reopened.
 *
 * Must run BEFORE the teardown: the agent-status entry the teardown drops is the last place the
 * live session id exists. `allNodes` must be the full tree from before the removal, so parent-chain
 * absolute positions still resolve.
 *
 * `uuid()`, NOT crypto.randomUUID: the latter exists only in a SECURE context, so it is undefined
 * in the Server Edition served over plain HTTP on a LAN — and a throw here would make the close do
 * nothing at all on that surface. See lib/uuid.ts.
 */
export function recordNodeClose(
  projectId: string,
  ids: ReadonlySet<string>,
  allNodes: readonly CanvasNode[],
  closedAt: number = Date.now()
): void {
  // Keyed by node id, not by array position: the ledger entries and the snapshots below each run
  // their OWN filter over `allNodes`, and a node-id map keeps the two correlated even if those
  // filters ever drift apart.
  const closedSessionIdByNode = new Map<string, string>()
  const entries = buildClosedSessionEntries(
    ids,
    allNodes,
    closedAt,
    (nodeId) => {
      const id = uuid()
      closedSessionIdByNode.set(nodeId, id)
      return id
    },
    (nodeId) => useAgentStatus.getState().byId[nodeId]?.sessionId
  )
  if (entries.length) useProjects.getState().recordClosedSessions(projectId, entries)
  // The two ledgers must agree on which node minted which persisted entry, so ⇧⌘T's restore can
  // drop the persisted twin and the sidebar's reopen can drop this snapshot — see
  // `ReopenNodeSnapshot.closedSessionId`.
  const snapshots = allNodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      const snap = snapshotNode(n, allNodes)
      return snap ? { ...snap, closedSessionId: closedSessionIdByNode.get(n.id) } : snap
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
  if (snapshots.length) {
    useReopenHistory.getState().push({ kind: 'nodes', projectId, closedAt, nodes: snapshots })
  }
}
