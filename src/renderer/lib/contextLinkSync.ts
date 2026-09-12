// Keeps main's context-link map in step with EVERYTHING it is built from, not just the canvas on
// screen.
//
// Main answers every get-linked-context read out of the map the renderer last pushed
// (core/context-link.ts `linkDocs`; the per-node JSON files are only a debug trace of it). The map
// has three inputs: the live React Flow edges of the MOUNTED project, every other project's stored
// `bridges` (the projects store), and each linked node's agent identity (the agent-status store).
// The push used to be a Canvas effect keyed on the first input alone, so a bridge written anywhere
// else reached main only when something unrelated changed on the visible canvas. The cold branch of
// open-terminal / open-claude / open-agent writes its fan-in bridge straight into the store
// (`appendCanvasLinks`), so an orchestrator in a project the user was not looking at was told
// "context-linked to you" and could read none of those nodes, nor they it (2026-09-11).
//
// Two rules, both load-bearing:
//  - COALESCE, never debounce. The first change arms one timer; later changes inside the window do
//    not reset it, and the map is rebuilt from the latest state when it fires. The old trailing
//    debounce was cleared by every re-run, and the canvas `nodes` array changes identity on every
//    React Flow change batch (even one filtered down to nothing), so a busy canvas could hold a new
//    link off indefinitely. Subscribing to two more stores makes changes more frequent, not less.
//  - Send only a map whose CONTENT changed. Each push makes main delete and rewrite every link file
//    and re-resolve every transcript; drags, selection and measure noise change none of it. Main
//    resolves a still-missing transcript at read time, so skipping an identical map never strands a
//    session whose transcript appeared after the last push.
import { buildBackgroundLinkMaps, buildLinkMap, type LinkNodeInfo } from '@shared/context-link-map'
import type { ContextLinkMap } from '@shared/types'
import { useAgentStatus } from '../state/agentStatus'
import { useProjects } from '../state/projects'

export const LINK_PUSH_DELAY_MS = 150

/**
 * The canvas React Flow holds right now. Its links come from here and every other project's from
 * the store. `projectId` is the MOUNTED project, not the store's active id: across a switch the two
 * disagree for a render, and pairing live edges with the wrong project would drop one project's
 * links and read the other's from a stale copy.
 */
export interface LiveLinkCanvas {
  projectId: string | null
  /** Context and note edges, already restricted to endpoints that exist. */
  edges: ReadonlyArray<{ source: string; target: string }>
  infoOf: (id: string) => LinkNodeInfo
}

export function buildContextLinkMap(live: LiveLinkCanvas): ContextLinkMap {
  const byId = useAgentStatus.getState().byId
  return {
    ...buildBackgroundLinkMaps(
      useProjects.getState().projects,
      live.projectId,
      (id) => byId[id]?.sessionId,
      (id) => byId[id]?.agentId
    ),
    ...buildLinkMap([...live.edges], live.infoOf)
  }
}

export interface ContextLinkSync {
  /** Something the live half of the map is built from changed. The two stores report their own. */
  invalidate(): void
  stop(): void
}

export function startContextLinkSync(deps: {
  live: () => LiveLinkCanvas
  send: (map: ContextLinkMap) => unknown
  delayMs?: number
}): ContextLinkSync {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastSent: string | null = null
  let stopped = false
  const flush = (): void => {
    timer = null
    if (stopped) return
    const map = buildContextLinkMap(deps.live())
    const key = JSON.stringify(map)
    if (key === lastSent) return
    lastSent = key
    // A push main never received must not count as delivered, or the content check would
    // suppress its retry until something else in the map happened to change.
    Promise.resolve()
      .then(() => deps.send(map))
      .catch(() => {
        if (lastSent === key) lastSent = null
      })
  }
  const invalidate = (): void => {
    if (stopped || timer) return
    timer = setTimeout(flush, deps.delayMs ?? LINK_PUSH_DELAY_MS)
  }
  const unsubProjects = useProjects.subscribe(invalidate)
  const unsubStatus = useAgentStatus.subscribe(invalidate)
  invalidate()
  return {
    invalidate,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      unsubProjects()
      unsubStatus()
    }
  }
}
