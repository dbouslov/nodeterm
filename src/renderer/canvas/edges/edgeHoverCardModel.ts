// The edge hover card (#40): hovering a link shows the node at its FAR end — title, status and one
// line of what it is doing — and a click on the card (or the edge) jumps there. This module is the
// pure part: which end, what the card says, and the show/hide timing. No React, no canvas state.
import { create } from 'zustand'
import { oneLine } from '@shared/one-line'
import { normalizeNodeAnnotation } from '@shared/node-annotation'
import type { AgentNodeStatus } from '../../state/agentStatus'
import type { Point } from '../../lib/edge-routing/types'
import type { Rect } from '../../lib/floatingEdge'

export type EdgeCardStatus = 'working' | 'waiting' | 'finished' | 'idle'

export const EDGE_CARD_STATUS_LABEL: Record<EdgeCardStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  finished: 'Finished',
  idle: 'Idle'
}

export interface EdgeCardInfo {
  nodeId: string
  title: string
  /** Undefined when no hook has reported for the node (or it is not an agent): unknown, not idle. */
  status?: EdgeCardStatus
  summary?: string
}

/** The endpoint whose box centre is farther from `cursor` (flow space). Ties and missing boxes go to the target. */
export function farEndOf(edge: { source: string; target: string }, cursor: Point, boxes: Map<string, Rect>): string {
  const s = boxes.get(edge.source)
  const t = boxes.get(edge.target)
  if (!s || !t) return s ? edge.source : edge.target
  const d = (b: Rect) => Math.hypot(b.x + b.width / 2 - cursor.x, b.y + b.height / 2 - cursor.y)
  return d(s) > d(t) ? edge.source : edge.target
}

/**
 * Same reading of the store as the node's own badges: RUNNING for `working`, NEEDS YOU for
 * `waiting`/`blocked`, the unread "Finished" mark for a `done` turn nobody has looked at yet.
 */
export function edgeCardStatus(st: Pick<AgentNodeStatus, 'state' | 'unread'> | undefined): EdgeCardStatus | undefined {
  switch (st?.state) {
    case 'working':
      return 'working'
    case 'waiting':
    case 'blocked':
      return 'waiting'
    case 'done':
      return st.unread ? 'finished' : 'idle'
    default:
      return undefined
  }
}

/**
 * What the card says. The summary reuses what the app already has, no model call: the agent's own
 * session title (from the terminal title), else the role an agent annotated the node with. Both are
 * re-read defensively — the title is terminal output, the annotation is git-shared file content.
 */
export function edgeCardInfo(
  nodeId: string,
  data: { title?: unknown; annotation?: unknown } | undefined,
  status: Pick<AgentNodeStatus, 'state' | 'unread' | 'session'> | undefined
): EdgeCardInfo {
  const title = (typeof data?.title === 'string' && oneLine(data.title)) || nodeId
  const session = typeof status?.session === 'string' ? oneLine(status.session) : ''
  const summary = (session && session !== title ? session : '') || normalizeNodeAnnotation(data?.annotation)?.role
  return { nodeId, title, status: edgeCardStatus(status), summary: summary || undefined }
}

// ---- timing: a short delay before showing (sweeping across links must not flash cards), a short
// grace after leaving (so the pointer can travel onto the card to click it), and an instant swap
// when moving from one link straight to another while a card is up.
export const SHOW_DELAY_MS = 250
export const HIDE_DELAY_MS = 250

export interface HoverCardAnchor {
  /** The link the card came from: when it is gone, so is the card. */
  edgeId: string
  nodeId: string
  /** Client (screen) coordinates of the pointer when the link was entered. */
  x: number
  y: number
}

interface HoverCardState {
  card: HoverCardAnchor | null
  hover(a: HoverCardAnchor): void
  leave(): void
  /** Pointer is on the card itself: cancel a pending hide. */
  hold(): void
  dismiss(): void
}

let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
const clearTimers = () => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  showTimer = hideTimer = undefined
}

export const useEdgeHoverCard = create<HoverCardState>((set, get) => ({
  card: null,
  hover: (a) => {
    clearTimers()
    if (get().card) set({ card: a })
    else showTimer = setTimeout(() => set({ card: a }), SHOW_DELAY_MS)
  },
  leave: () => {
    clearTimeout(showTimer)
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => set({ card: null }), HIDE_DELAY_MS)
  },
  hold: () => clearTimeout(hideTimer),
  dismiss: () => {
    clearTimers()
    if (get().card) set({ card: null })
  }
}))

/**
 * A single click on a link jumps to its far end — but a DOUBLE click removes the link, and a jump
 * on the first click would pan the link out from under the second. So the jump waits out the
 * double-click window and the double-click handler cancels it.
 */
export const EDGE_CLICK_JUMP_DELAY_MS = 300

export function createEdgeClickJump(jump: (nodeId: string) => void, delayMs = EDGE_CLICK_JUMP_DELAY_MS) {
  let t: ReturnType<typeof setTimeout> | undefined
  return {
    click(nodeId: string) {
      clearTimeout(t)
      t = setTimeout(() => jump(nodeId), delayMs)
    },
    cancel() {
      clearTimeout(t)
      t = undefined
    }
  }
}
