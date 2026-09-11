// The look of every canvas edge, derived from its KIND and STATE at render time — never stored on
// the edge object (spec: docs/superpowers/specs/2026-09-11-edge-routing-design.md, Section 1).
// Hue AND dash pattern both encode the kind (decision 1), so a colourblind reader still tells
// them apart; the test pins that no two kinds share both. Pure: no React, no store, no React Flow.
import { ROPE_NEUTRAL } from './edgeModel'

export type EdgeKind = 'context' | 'note' | 'rope' | 'fanout' | 'trigger' | 'annotation' | 'handoff'

/** Bundling order: members of one channel sit side by side in this order so colours read as
 *  stable ribbons. */
export const KIND_ORDER: readonly EdgeKind[] = ['context', 'rope', 'note', 'fanout', 'trigger', 'annotation', 'handoff']

export interface EdgeState {
  /** rope: the target is still armed on this source. */
  waiting?: boolean
  /** rope: the target is a driven browser. */
  driven?: boolean
  /** fanout: the subagent / loop card is working. */
  working?: boolean
  /** rope / fanout: the source agent's brand colour; absent ⇒ neutral. */
  agentColor?: string
}

/** What rides `edge.data` for every circuit edge. */
export interface EdgeData {
  kind: EdgeKind
  state?: EdgeState
  /** Smart Spawning's rope kind, when present; picks the port sides. */
  ropeKind?: 'opener' | 'dep'
}

export interface EdgeLook {
  color: string
  dash: string | null
  width: number
  opacity: number
  arrowStart: boolean
  arrowEnd: boolean
  arrowShape: 'triangle' | 'diamond'
  animated: boolean
}

export const SELECTED_COLOR = '#ffffff'
export const DRIVEN_COLOR = '#d97757'

interface KindLook {
  color: string | 'agent'
  dash: string | null
  width: number
  opacity: number
  arrowStart: boolean
  arrowEnd: boolean
  arrowShape: 'triangle' | 'diamond'
}

const TABLE: Record<EdgeKind, KindLook> = {
  context: { color: 'var(--edge-context)', dash: null, width: 2, opacity: 1, arrowStart: true, arrowEnd: true, arrowShape: 'triangle' },
  note: { color: 'var(--edge-note)', dash: '2 4', width: 2, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  rope: { color: 'agent', dash: null, width: 1.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  fanout: { color: 'agent', dash: '8 3 2 3', width: 1.25, opacity: 0.55, arrowStart: false, arrowEnd: false, arrowShape: 'triangle' },
  trigger: { color: 'var(--edge-trigger)', dash: '12 6', width: 1.5, opacity: 0.7, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  annotation: { color: 'var(--edge-annotation)', dash: '3 3', width: 1.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'triangle' },
  handoff: { color: 'var(--edge-handoff)', dash: null, width: 2.5, opacity: 1, arrowStart: false, arrowEnd: true, arrowShape: 'diamond' }
}

export function edgeAnimated(kind: EdgeKind, state: EdgeState = {}): boolean {
  if (kind === 'rope') return !!state.waiting || !!state.driven
  if (kind === 'fanout') return !!state.working
  return false
}

export function lookOf(kind: EdgeKind, state: EdgeState = {}, selected = false): EdgeLook {
  const base = TABLE[kind]
  let look: EdgeLook = {
    color: base.color === 'agent' ? (state.agentColor ?? ROPE_NEUTRAL) : base.color,
    dash: kind === 'rope' && state.waiting ? '6 4' : base.dash,
    width: base.width,
    opacity: base.opacity,
    arrowStart: base.arrowStart,
    arrowEnd: base.arrowEnd,
    arrowShape: base.arrowShape,
    animated: edgeAnimated(kind, state)
  }
  // Overlays, in order: driven < selected. Each replaces colour; selected also thickens.
  if (kind === 'rope' && state.driven) look = { ...look, color: DRIVEN_COLOR, width: 2.5, animated: true }
  if (selected) look = { ...look, color: SELECTED_COLOR, width: look.width + 1.5 }
  return look
}
