// `minimize` for a project that is NOT on screen (candidates item 8): the same request resolved by
// `planMinimize` (@shared/minimize) and applied by the same `setCollapsed` the on-screen dispatch
// runs, over the project's SERIALIZED nodes. The flag lives in the saved node, so nothing here needs
// a rendered canvas: `nodeStatesToFlow` hydrates each node with its saved (expanded) height, and
// `flowToNodeStates` writes that height back as the saved size while `collapsed` is set — exactly
// what a save of an on-screen minimize writes. The on-screen verb re-fits no frame, so neither does
// this one. Only the nodes that changed are returned, so nothing else in the project is
// round-tripped through the serializers.

import type { CanvasNodeState } from '@shared/types'
import { planMinimize, type MinimizePlan } from '@shared/minimize'
import { flowToNodeStates, nodeStatesToFlow, setCollapsed } from '../state/workspace'

export type StoredMinimizePlan =
  | { ok: true; change: string[]; already: string[]; upserts: CanvasNodeState[] }
  | Extract<MinimizePlan, { ok: false }>

export function planStoredMinimize(
  stored: CanvasNodeState[],
  ids: readonly string[],
  on: boolean
): StoredMinimizePlan {
  const live = nodeStatesToFlow(stored)
  const plan = planMinimize(
    ids,
    on,
    live.map((n) => ({ id: n.id, kind: n.type ?? 'terminal', collapsed: !!n.data.collapsed }))
  )
  if (!plan.ok) return plan
  const before = new Set(live)
  const changed = setCollapsed(live, plan.change, on).filter((n) => !before.has(n))
  return { ...plan, upserts: flowToNodeStates(changed) }
}
