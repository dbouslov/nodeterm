// The Network overview's input for the ACTIVE project: its SERIALIZED nodes (Canvas commits the
// live canvas before the overlay mounts) plus the live status maps. The subscriptions live here, in
// the two small consumers (the minimap badge and the overlay), so Canvas itself never re-renders
// on a hook event — the same discipline as StatusAwareMiniMap and loopSig in Canvas.tsx.
import { useEffect, useMemo, useState } from 'react'
import { overviewSig, type OverviewInput } from '../../lib/networkOverview'
import { useAgentStatus } from '../../state/agentStatus'
import { useLaunchDelivery } from '../../state/launchDelivery'
import { useProjects } from '../../state/projects'
import { useSettings } from '../../state/settings'

export interface ActiveOverview {
  projectName: string
  projectColor: string
  input: OverviewInput
}

/** The idle rule is a clock rule: without a tick, a node that crosses the threshold on a quiet
 *  canvas (nothing else changing — exactly when it matters) would never flag. */
const TICK_MS = 60_000

export function useActiveOverview(): ActiveOverview | null {
  const project = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const sig = useAgentStatus((s) => overviewSig(project?.nodes ?? [], s.byId))
  const launchById = useLaunchDelivery((s) => s.byId)
  const idleMinutes = useSettings((s) => s.settings.agentHibernationIdleMinutes)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [])
  return useMemo(
    () =>
      project
        ? {
            projectName: project.name,
            projectColor: project.color,
            input: {
              nodes: project.nodes,
              bridges: project.bridges ?? [],
              ropes: project.ropes ?? [],
              // Read, not subscribed: `sig` is the subscription, over exactly what the overview shows.
              statusById: useAgentStatus.getState().byId,
              launchById,
              // Eco's own refusal (terminal/hibernation-policy.ts): a threshold that is not > 0
              // means nothing is ever idle, so the two keep agreeing on a hand-edited settings.json.
              idleMs: idleMinutes > 0 ? idleMinutes * 60_000 : Infinity,
              now
            }
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, sig, launchById, idleMinutes, now]
  )
}
