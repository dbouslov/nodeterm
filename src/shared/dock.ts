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

interface MarkShape extends DockShape {
  type?: string
  kind?: string
}

/**
 * Why `pin --node <frameId> --set dock` from `callerId` must be refused, or null when it may go
 * to the human confirm. The app has no seat registry, so the gate is the geometry it can check:
 * the caller sits DIRECTLY in the frame (the seat marks its own box). One Dock per canvas.
 */
export function dockMarkRefusal(nodes: readonly MarkShape[], callerId: string, frameId: string): string | null {
  const frame = nodes.find((n) => n.id === frameId)
  if (!frame || (frame.type ?? frame.kind) !== 'group') return `pin --set dock: --node names no frame (${frameId})`
  if (isDock(frame)) return `pin --set dock: ${frameId} is already the Dock`
  if (dockOf(nodes)) return 'pin --set dock: this canvas already has a Dock'
  const caller = nodes.find((n) => n.id === callerId)
  if (caller?.parentId !== frameId) return 'pin --set dock: only a direct child of the frame may mark it'
  return null
}

export type DockAction = 'close' | 'ungroup' | 'unpin' | 'move'

/**
 * Why an AGENT's `action` on `ids` must be refused because of the Dock, or null. The Dock frame is
 * never closed, ungrouped, unpinned or moved. A page in the Dock (anything but a session) is never
 * closed; a session in it may close, which is how retire swaps the seat. Nothing is moved out of
 * the Dock (`move` with `target` outside it); moving in, or between frames inside it, is fine.
 */
export function dockRefusal(
  nodes: readonly MarkShape[],
  action: DockAction,
  ids: readonly string[],
  target?: string | null
): string | null {
  const dock = dockOf(nodes)
  if (!dock) return null
  const targetInDock = !!target && (target === dock.id || inDock(target, nodes))
  for (const id of ids) {
    const n = nodes.find((x) => x.id === id)
    if (!n) continue
    if (isDock(n)) return `${action}: ${id} is the Dock; only the user can release it (frame menu, Release Dock)`
    if (!inDock(id, nodes)) continue
    if (action === 'close' && (n.type ?? n.kind) !== 'terminal') {
      return `close: ${id} is a page in the Dock; the Dock keeps its pages`
    }
    if (action === 'move' && !targetInDock) return `move: ${id} is in the Dock; nothing moves out of the Dock`
  }
  return null
}

/** `ids` less the Dock frame: the human close and unpin paths skip it (Release Dock comes first). */
export function withoutDock(ids: readonly string[], nodes: readonly DockShape[]): string[] {
  return ids.filter((id) => !isDock(nodes.find((n) => n.id === id)))
}
