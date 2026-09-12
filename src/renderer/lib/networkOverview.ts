// Pure engine behind the Network overview (spec: docs/superpowers/specs/2026-09-11-network-overview-
// design.md §4). No React, no stores: Canvas hands in the SERIALIZED project plus the status maps,
// and gets back the findings list and the React Flow graph the overlay renders.
import type { Edge, Node } from '@xyflow/react'
import type { BridgeLink, CanvasNodeState } from '@shared/types'
import { normalizeNodeAnnotation } from '@shared/node-annotation'
import type { AgentNodeStatus } from '../state/agentStatus'
import { nodeStatesToFlow } from '../state/workspace'
import { edgeAnimated, type EdgeData } from './edgeKinds'
import { WAIT_LABEL, ropeInfoOf, ropeVisual } from './edgeModel'
import { hiddenLinkIds } from './noteLink'
import type { LaunchDelivery } from './pendingLaunch'
import { STATE_LABEL, sessionStateAgeLabel, sessionStatusKind, type StatusKind } from './sessionList'

/** A role that makes its node a group's lead (the group-no-lead heuristic). */
export const LEAD_ROLE_RE = /\b(lead|orchestrator|hub)\b/i

export type FindingKind =
  | 'recommend'
  | 'idle'
  | 'isolated'
  | 'group-no-lead'
  | 'dropped'
  | 'turn-failed'
  | 'stalled-launch'
  | 'paused'

export interface Finding {
  /** `${kind}:${nodeId | groupId}` */
  id: string
  kind: FindingKind
  severity: 'info' | 'warn'
  nodeId?: string
  groupId?: string
  text: string
  source: 'agent' | 'heuristic'
  /** recommend: the annotation's stamp; verdicts: their own stamp. */
  at?: number
  /** recommend only: the title of the node named by `annotation.by`, or its id when that node is gone. */
  byTitle?: string
}

export interface OverviewInput {
  nodes: CanvasNodeState[]
  bridges: BridgeLink[]
  ropes: BridgeLink[]
  statusById: Record<string, AgentNodeStatus | undefined>
  launchById: Record<string, LaunchDelivery | undefined>
  /** `settings.agentHibernationIdleMinutes` in ms, so Eco and the overview agree on idle. */
  idleMs: number
  now: number
}

/** Sidebar order: agent recommendations, then the warn kinds in this order, then info. */
const KIND_ORDER: readonly FindingKind[] = [
  'recommend',
  'idle',
  'isolated',
  'group-no-lead',
  'dropped',
  'turn-failed',
  'stalled-launch',
  'paused'
]

function duration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return hr < 24 ? `${hr}h` : `${Math.floor(hr / 24)}d`
}

const labelOf = (n: CanvasNodeState): string => n.title || n.id

export function buildFindings(input: OverviewInput): Finding[] {
  const { nodes, bridges, ropes, statusById, launchById, idleMs, now } = input
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // Serialized nodes are the file's (spec §1: hostile input on every read), so the annotation is
  // re-validated at the point of use rather than trusted from whoever built the input.
  const annotationOf = new Map(nodes.map((n) => [n.id, normalizeNodeAnnotation(n.annotation)]))
  const linked = new Set<string>()
  for (const e of [...bridges, ...ropes]) {
    linked.add(e.source)
    linked.add(e.target)
  }
  const out: Finding[] = []
  const add = (f: Omit<Finding, 'id'>, key: string) => out.push({ id: `${f.kind}:${key}`, ...f })

  for (const n of nodes) {
    const a = annotationOf.get(n.id)
    if (!a?.recommend) continue
    const byTitle = byId.get(a.by)?.title || a.by
    add({ kind: 'recommend', severity: 'info', nodeId: n.id, text: a.recommend, source: 'agent', at: a.at, byTitle }, n.id)
  }
  for (const n of nodes) {
    if (!n.agentId) continue
    const st = statusById[n.id]
    // Eco's own rule (terminal/hibernation-policy.ts): the idle clock is `lastEventAt`, and a node
    // without one is unknown idle — never idle. Silence is not evidence.
    if (
      st?.state === 'done' &&
      st.lastEventAt !== undefined &&
      !st.hibernated &&
      !st.paused &&
      now - st.lastEventAt >= idleMs
    ) {
      const text = `${labelOf(n)} idle for ${duration(now - st.lastEventAt)}`
      add({ kind: 'idle', severity: 'warn', nodeId: n.id, text, source: 'heuristic', at: st.lastEventAt }, n.id)
    }
    if (!linked.has(n.id)) {
      add({ kind: 'isolated', severity: 'warn', nodeId: n.id, text: `${labelOf(n)} has no links`, source: 'heuristic' }, n.id)
    }
  }
  for (const g of nodes) {
    if (g.kind !== 'group') continue
    // Direct children only: a nested group answers for its own members.
    const members = nodes.filter((n) => n.parentId === g.id && n.agentId)
    if (members.length < 2) continue
    if (members.some((m) => LEAD_ROLE_RE.test(annotationOf.get(m.id)?.role ?? ''))) continue
    add({ kind: 'group-no-lead', severity: 'warn', groupId: g.id, text: `${g.title || 'Group'} has no lead`, source: 'heuristic' }, g.id)
  }
  for (const n of nodes) {
    const st = statusById[n.id]
    const label = labelOf(n)
    if (st?.dropped) {
      add({ kind: 'dropped', severity: 'warn', nodeId: n.id, text: `${label}: its agent CLI is gone`, source: 'heuristic' }, n.id)
    }
    if (st?.lastTurnError) {
      const at = st.lastTurnError.at
      add({ kind: 'turn-failed', severity: 'warn', nodeId: n.id, text: `${label}: last turn errored`, source: 'heuristic', at }, n.id)
    }
    const l = launchById[n.id]
    if (l) {
      const text =
        l.kind === 'stalled'
          ? `${label}: launch held, no terminal yet`
          : `${label}: launch failed after ${l.attempts} attempts`
      const at = l.kind === 'stalled' ? l.since : l.at
      add({ kind: 'stalled-launch', severity: 'warn', nodeId: n.id, text, source: 'heuristic', at }, n.id)
    }
    if (st?.paused) {
      add({ kind: 'paused', severity: 'info', nodeId: n.id, text: `${label} is paused`, source: 'heuristic' }, n.id)
    }
  }
  // Stable sort: within a kind, canvas order — except recommendations, newest first.
  return out.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.kind === 'recommend' ? (b.at ?? 0) - (a.at ?? 0) : 0)
  )
}

export interface OverviewNodeData extends Record<string, unknown> {
  title: string
  kind: string
  agentId?: string
  color: string
  role?: string
  statusKind: StatusKind
  statusLabel?: string
  ageLabel?: string
  chips: string[]
  unread: boolean
  textPreview?: string
  findingCount: number
  worktreeBranch?: string
  noLead: boolean
}

/** The verdict chips the node header already renders, as text. */
function chipsFor(n: CanvasNodeState, st: AgentNodeStatus | undefined, l: LaunchDelivery | undefined): string[] {
  const chips: string[] = []
  if (st?.dropped) chips.push('DROPPED')
  if (st?.lastTurnError) chips.push('TURN FAILED')
  if (st?.paused) chips.push('PAUSED')
  else if (st?.hibernated) chips.push('SLEEPING')
  if (n.pendingLaunch) chips.push(l ? 'QUEUED ⚠' : 'QUEUED')
  return chips
}

export function buildOverviewGraph(
  input: OverviewInput,
  colorOf: (agentId: string) => string | undefined,
  findings: readonly Finding[]
): { nodes: Node<OverviewNodeData>[]; edges: Edge[] } {
  const { nodes: states, bridges, ropes, statusById, launchById, now } = input
  const findingCount = new Map<string, number>()
  const noLead = new Set<string>()
  for (const f of findings) {
    const key = f.nodeId ?? f.groupId
    if (key) findingCount.set(key, (findingCount.get(key) ?? 0) + 1)
    if (f.kind === 'group-no-lead' && f.groupId) noLead.add(f.groupId)
  }
  const byId = new Map(states.map((n) => [n.id, n]))
  // nodeStatesToFlow gives parent-first order and parentId/extent — the canvas's own shape.
  const flow = nodeStatesToFlow(states)
  const nodes: Node<OverviewNodeData>[] = flow.flatMap((fn) => {
    const n = byId.get(fn.id)
    if (!n) return []
    const st = statusById[n.id]
    const statusKind = n.agentId ? sessionStatusKind(st?.state) : 'unknown'
    const data: OverviewNodeData = {
      title: n.title,
      kind: n.kind,
      agentId: n.agentId,
      color: n.color,
      role: normalizeNodeAnnotation(n.annotation)?.role,
      statusKind,
      statusLabel: n.agentId ? STATE_LABEL[statusKind] : undefined,
      ageLabel: n.agentId ? sessionStateAgeLabel(st?.lastEventAt, now) : undefined,
      chips: chipsFor(n, st, launchById[n.id]),
      unread: !!st?.unread,
      textPreview: n.kind === 'sticky' && n.text ? n.text.split('\n').slice(0, 2).join('\n') : undefined,
      findingCount: findingCount.get(n.id) ?? 0,
      worktreeBranch: n.worktree?.branch,
      noLead: noLead.has(n.id)
    }
    return [
      {
        id: n.id,
        // `group`, not a private type name: the edge router treats only `type === 'group'` as a
        // frame (transparent to edges between its own members, an obstacle to everyone else's).
        type: n.kind === 'group' ? 'group' : 'ovNode',
        position: fn.position,
        ...(fn.parentId ? { parentId: fn.parentId, extent: 'parent' as const } : {}),
        width: n.size.width,
        height: n.size.height,
        draggable: false,
        selectable: false,
        connectable: false,
        data
      }
    ]
  })
  const info = ropeInfoOf(flow, colorOf)
  const stickyIds = new Set(states.filter((n) => n.kind === 'sticky').map((n) => n.id))
  // One arrow per pair, as on the canvas (lib/noteLink.hiddenLinkIds): the rope wins the pixels.
  // The eye (`hideFanout`) is deliberately NOT applied here — the overview exists to show the network.
  const hidden = hiddenLinkIds(bridges, ropes)
  const edges: Edge[] = [
    ...bridges
      .filter((b) => !hidden.has(b.id))
      .map((b) => {
        const isNote = stickyIds.has(b.source)
        return {
          id: b.id,
          source: b.source,
          target: b.target,
          type: 'circuit',
          data: { kind: isNote ? 'note' : 'context' } satisfies EdgeData,
          label: isNote ? '🗒 note' : '⇄ context'
        }
      }),
    ...ropes.map((r) => {
      const v = ropeVisual(r, info)
      const state = { waiting: v.waiting, agentColor: info(r.source)?.agentColor }
      return {
        id: r.id,
        source: r.source,
        target: r.target,
        type: 'circuit',
        data: { kind: 'rope', state } satisfies EdgeData,
        animated: edgeAnimated('rope', state),
        ...(v.waiting ? { label: WAIT_LABEL } : {})
      }
    })
  ]
  return { nodes, edges }
}

/**
 * Primitive re-render key over what the findings and cards read from status — never positions,
 * so the overlay does not re-render on every hook event that changes nothing it shows.
 */
export function overviewSig(
  nodes: readonly CanvasNodeState[],
  statusById: Record<string, AgentNodeStatus | undefined>
): string {
  return nodes
    .map((n) => {
      const st = statusById[n.id]
      const at = (n.annotation as { at?: unknown } | undefined)?.at ?? ''
      const flags = `${st?.unread ? 'u' : ''}${st?.dropped ? 'd' : ''}${st?.paused ? 'p' : ''}${st?.hibernated ? 'h' : ''}`
      return `${n.id}:${String(at)}:${st?.state ?? ''}:${st?.lastEventAt ?? ''}:${st?.lastTurnError?.at ?? ''}:${flags}`
    })
    .join('|')
}
