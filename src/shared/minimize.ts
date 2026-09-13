// `minimize --node <id,id> [--set on|off]` — shrink nodes to their title bar, or restore them.
//
// PURE and edition-neutral, so the desktop dispatch (Canvas.tsx), the node menu's Minimize / Restore
// row and the Server Edition factory resolve a request in one place and refuse exactly the same
// lists in exactly the same words. The resize itself is not here: the renderer runs `setCollapsed`
// (state/workspace.ts), the Server Edition flips the persisted `collapsed` flag (its `size.height`
// already IS the height to restore).

/** The kinds with a title bar to shrink to: the three that carry a header chevron. */
const MINIMIZABLE_KINDS: readonly string[] = ['terminal', 'sticky', 'files']

/** The little this needs to know about a node. `kind` is the React Flow type / persisted kind. */
export interface MinimizeCandidate {
  id: string
  kind: string
  collapsed: boolean
}

export type MinimizePlan =
  | { ok: true; change: string[]; already: string[] }
  | { ok: false; error: string }

/** `--node`, split, trimmed and de-duplicated: `close`'s grammar. */
export function minimizeIds(raw: string | undefined): string[] {
  return [...new Set((raw ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
}

const NOTHING_CHANGED = ' — nothing was changed'

/**
 * Resolve a request against the canvas. An id that cannot be minimized (unknown, a group frame, a
 * kind with no title bar) refuses the WHOLE list and is named: the caller of a wave of ids cannot
 * see which ones landed, so "minimized 6" has to mean 6. A node already in the asked state is not an
 * error; it comes back in `already`.
 */
export function planMinimize(
  ids: readonly string[],
  on: boolean,
  nodes: readonly MinimizeCandidate[]
): MinimizePlan {
  if (!ids.length) return { ok: false, error: 'minimize requires --node <id,id>' }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const unknown = ids.filter((id) => !byId.has(id))
  if (unknown.length) {
    return {
      ok: false,
      error: `minimize: no node on this canvas with id ${unknown.join(', ')}${NOTHING_CHANGED}`
    }
  }
  const targets = ids.map((id) => byId.get(id)!)
  const frames = targets.filter((t) => t.kind === 'group')
  if (frames.length) {
    return {
      ok: false,
      error: `minimize: group frames do not minimize (${frames.map((t) => t.id).join(', ')})${NOTHING_CHANGED}`
    }
  }
  const other = targets.filter((t) => !MINIMIZABLE_KINDS.includes(t.kind))
  if (other.length) {
    const named = other.map((t) => `${t.id} is ${t.kind}`).join(', ')
    return {
      ok: false,
      error: `minimize: only terminal, sticky and files nodes minimize (${named})${NOTHING_CHANGED}`
    }
  }
  return {
    ok: true,
    change: targets.filter((t) => t.collapsed !== on).map((t) => t.id),
    already: targets.filter((t) => t.collapsed === on).map((t) => t.id)
  }
}

/** The reply. A node already in the asked state is said out loud, so a lead re-asserting a layout
 *  learns it can stop. */
export function minimizeReply(on: boolean, change: readonly string[], already: readonly string[]): string {
  const did = change.length ? `${on ? 'minimized' : 'restored'} ${change.length}: ${change.join(', ')}` : ''
  const same = already.length ? `${on ? 'already minimized' : 'not minimized'}: ${already.join(', ')}` : ''
  if (!did) return `${same} — nothing to do`
  return same ? `${did}; ${same}` : did
}

/**
 * The node menu's Minimize / Restore row for a selection: restore when every target is minimized,
 * else minimize them all. Group frames are left out (shrinking a frame squeezes its children), and a
 * frames-only selection gets no row. Every other kind the menu reaches stays in, as it did under the
 * old Collapse / Expand row; only the verb is limited to the three kinds with a title bar.
 */
export function menuMinimizeRow(
  targets: readonly MinimizeCandidate[]
): { ids: string[]; on: boolean } | null {
  const rows = targets.filter((t) => t.kind !== 'group')
  if (!rows.length) return null
  return { ids: rows.map((t) => t.id), on: !rows.every((t) => t.collapsed) }
}
