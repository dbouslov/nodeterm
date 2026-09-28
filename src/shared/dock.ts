// THE DOCK: the orchestrator's frame (GO's chat and its pages), marked `fixture: 'dock'` and pinned.
// It sits in one fixed slot, top-left, walled off from the workstreams: layout never moves it,
// implicit placement never files into it or lands on it, and agents cannot close, ungroup, unpin
// or empty it. Shared because the renderer (live nodes, flag in `data`), the cold open and the
// Server Edition (stored nodes, flag at the top level) all ask the same questions.

export const DOCK_FIXTURE = 'dock'

export interface DockShape {
  id: string
  parentId?: string
  fixture?: unknown
  data?: { fixture?: unknown }
}

/** Only the literal 'dock' counts: the project file is hand-editable. */
export function isDock(n: DockShape | undefined): boolean {
  return !!n && (n.fixture === DOCK_FIXTURE || n.data?.fixture === DOCK_FIXTURE)
}

/** The Dock frame on this canvas, if any. */
export function dockOf<T extends DockShape>(nodes: readonly T[]): T | undefined {
  return nodes.find((n) => isDock(n))
}

/** Whether node `id` sits inside the Dock, at any depth. The Dock itself is not inside it. */
export function inDock(id: string, nodes: readonly DockShape[]): boolean {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  let p = byId.get(id)?.parentId
  while (p && !seen.has(p)) {
    const frame = byId.get(p)
    if (isDock(frame)) return true
    seen.add(p)
    p = frame?.parentId
  }
  return false
}
