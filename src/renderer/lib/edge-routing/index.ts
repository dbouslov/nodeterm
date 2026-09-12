// The whole-graph pass (spec 2.1, 3.6). Full: ports for every edge (spread needs them all), one
// route per edge, then nudging over all routes. Incremental (a drag): only edges touching a moved
// node, or whose current route's bbox meets a moved node's box, are re-routed; the rest keep
// identity, and nudging is skipped for the re-routed set — bundles reform on the full pass that
// runs when the drag ends.
import { inflate, intersects, obstaclesFor } from './obstacles'
import { portsFor } from './ports'
import { routeOne } from './route'
import { nudge } from './nudge'
import type { Route, RoutedGraph, RouteRequest } from './types'

export * from './types'
export { svgPathFrom, arrowheadPoints } from './svgPath'
export { obstaclesFor } from './obstacles'

export function routeAll(req: RouteRequest, previous?: RoutedGraph, moved?: ReadonlySet<string>): RoutedGraph {
  const live = req.edges.filter((e) => req.nodes.has(e.source) && req.nodes.has(e.target))
  const ports = portsFor({ nodes: req.nodes, edges: live })
  const routes = new Map<string, Route>()
  let fallbacks = 0

  if (previous && moved && moved.size) {
    const movedBoxes = [...moved].map((id) => req.nodes.get(id)).filter((b): b is NonNullable<typeof b> => !!b)
    for (const e of live) {
      const prev = previous.routes.get(e.id)
      const touches = moved.has(e.source) || moved.has(e.target)
      const crosses = !!prev && movedBoxes.some((b) => intersects(prev.bbox, b))
      if (prev && !touches && !crosses) { routes.set(e.id, prev); continue }
      const p = ports.get(e.id)
      if (!p) continue
      const r = routeOne(e, req, p)
      if (r.fallback) fallbacks++
      routes.set(e.id, r)
    }
    return { routes, fallbacks }
  }

  for (const e of live) {
    const p = ports.get(e.id)
    if (!p) continue
    const r = routeOne(e, req, p)
    if (r.fallback) fallbacks++
    routes.set(e.id, r)
  }
  const obstacleCache = new Map<string, ReturnType<typeof obstaclesFor>>()
  const obstaclesOf = (id: string) => {
    let o = obstacleCache.get(id)
    // The edge's OWN two nodes are no obstacle to the search (its ports sit on them) but they are
    // to a nudge: a channel offsets a run by more than the 20 px PORT_STUB, so the corner next to
    // a stub was carried into its own node — the stub collapsed or reversed and the arrowhead
    // pointed away from the node it marks. The raw boxes, plus 1 px so a run landing exactly ON a
    // border (a zero-length stub, no arrowhead direction at all) counts as entering too.
    if (!o) {
      const e = live.find((x) => x.id === id)!
      o = [...obstaclesFor(e, req), inflate(req.nodes.get(e.source)!, 1), inflate(req.nodes.get(e.target)!, 1)]
      obstacleCache.set(id, o)
    }
    return o
  }
  return { routes: nudge(routes, live, obstaclesOf), fallbacks }
}
