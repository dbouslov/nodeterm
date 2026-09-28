// THE DOCK: the orchestrator's frame (GO's chat and its pages), marked `fixture: 'dock'` and pinned.
// It sits in one fixed slot, top-left, walled off from the workstreams: layout never moves it,
// implicit placement never files into it or lands on it, and agents cannot close, ungroup, unpin
// or empty it. Shared because the renderer (live nodes, flag in `data`), the cold open and the
// Server Edition (stored nodes, flag at the top level) all ask the same questions.

export const DOCK_FIXTURE = 'dock'

export interface DockShape {
  id: string
  parentId?: string
  /** Live node kind (React Flow `type`) or stored kind: the Dock is always a frame. */
  type?: string
  kind?: string
  fixture?: unknown
  title?: string
  data?: { fixture?: unknown; title?: unknown }
}

/** A frame carrying the literal 'dock'. The project file is hand-editable, so anything else, or
 *  the flag on a node that is not a frame, does not count. */
export function isDock(n: DockShape | undefined): boolean {
  return !!n && (n.type ?? n.kind) === 'group' && (n.fixture === DOCK_FIXTURE || n.data?.fixture === DOCK_FIXTURE)
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

type MarkShape = DockShape

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
  target?: string | null,
  callerId?: string
): string | null {
  const dock = dockOf(nodes)
  if (!dock) return null
  const targetInDock = !!target && (target === dock.id || inDock(target, nodes))
  // Moving INTO the Dock is the seat's call alone: only a caller inside the Dock may do it.
  if (action === 'move' && targetInDock && !(callerId && inDock(callerId, nodes))) {
    return 'move: nodes go into the Dock only from inside the Dock'
  }
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

const titleOf = (n: DockShape): string => {
  const t = n.data?.title ?? n.title
  return typeof t === 'string' && t ? t : n.id
}

/**
 * Why an agent's open (open-terminal / open-claude / open-agent) must be refused because of the
 * Dock, or null. An IMPLICIT open (no `--group`) from a Dock member, or `--after` a Dock member,
 * would join the Dock or land loose beside it, so it is refused and the reply lists the frames the
 * caller can name instead. An explicit `--group <dock>` is allowed only from inside the Dock.
 */
export function dockOpenRefusal(
  nodes: readonly DockShape[],
  verb: string,
  sourceId: string,
  after: readonly string[],
  group: string | undefined
): string | null {
  const dock = dockOf(nodes)
  if (!dock) return null
  const member = (id: string): boolean => inDock(id, nodes)
  if (group) {
    if ((group === dock.id || member(group)) && !member(sourceId)) {
      return `${verb}: --group ${group} is the Dock; nodes open there only from inside the Dock`
    }
    return null
  }
  const anchors = after.filter((id) => id !== sourceId)
  const implicit = anchors.length ? anchors.some(member) : member(sourceId)
  if (!implicit) return null
  const frames = nodes
    .filter((n) => (n.type ?? n.kind) === 'group' && !isDock(n) && !member(n.id))
    .map((n) => `${n.id} (${titleOf(n)})`)
  const options = [...frames.slice(0, 8), ...(member(sourceId) ? [`${dock.id} (the Dock)`] : [])]
  return (
    `${verb}: this would land in or beside the Dock; name its frame with --group <id>` +
    (options.length ? `: ${options.join(', ')}` : ' (no other frame exists yet: create one with `group` first)')
  )
}

/** A raw comma list (`--after a,b`) as ids, for `dockOpenRefusal`. */
export function idList(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}
