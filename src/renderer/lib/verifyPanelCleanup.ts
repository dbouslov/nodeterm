// A `verify` review panel's frame goes when its last member does.
//
// WHY: the panel frame (`Verify: <target>`, lib/verifyPanelLayout.ts) exists to hold one review
// round. The caller closes the reviewers and the judge when the round is read, and the frame used to
// stay behind: on one orchestrator's canvas five empty or near-empty "Verify:" frames sat on top of
// the frame they were opened from. Nothing else was ever going to remove them.
//
// THE RULES (each pinned in verifyPanelCleanup.test.ts):
// 1. A panel frame is a group marked `verifyPanel` (only a literal `true`, as on both serializer
//    seams), or a LEGACY group whose title starts with "Verify: " — frames made before the mark
//    existed carry the title and nothing else.
// 2. A close that leaves a panel frame with no child removes that frame too (`emptiedVerifyPanels`),
//    on screen (`deleteNodes`) and off screen (`closeStoredNodes`). Only a frame that HELD a closed
//    node is considered: this is "the last member closed", not a sweep.
// 3. Every project load drops a panel frame with no child (`pruneEmptyVerifyPanels`, run where
//    Canvas hydrates the WHOLE project), which clears the frames earlier builds left behind. Not in
//    `nodeStatesToFlow`: that also hydrates one node at a time (`applyMutationToFlow`, a peer's
//    upsert), and a lone frame always looks childless.
// A LEAF (types only).
// A frame with any child is never removed, and a frame that is neither marked nor titled
// "Verify: " is never removed, empty or not: an empty frame of the user's own is theirs.


const LEGACY_TITLE_PREFIX = 'Verify: '

/** The node shape both rules read: a live React Flow node has it. */
interface FrameLike {
  type?: string
  data?: Record<string, unknown>
}

export function isVerifyPanelFrame(n: FrameLike): boolean {
  if (n.type !== 'group') return false
  if (n.data?.verifyPanel === true) return true
  const title = n.data?.title
  return typeof title === 'string' && title.startsWith(LEGACY_TITLE_PREFIX)
}

/**
 * The panel frames a close of `deleted` leaves empty, in canvas order. A removed panel frame can
 * empty the panel frame it sat in, so the walk repeats until nothing more empties. Frames that are
 * themselves in `deleted` are not named (they are already going).
 */
export function emptiedVerifyPanels(
  nodes: readonly (FrameLike & { id: string; parentId?: string })[],
  deleted: ReadonlySet<string>
): string[] {
  const gone = new Set(deleted)
  const out: string[] = []
  for (let changed = true; changed; ) {
    changed = false
    const touched = new Set(nodes.filter((n) => gone.has(n.id) && n.parentId).map((n) => n.parentId as string))
    for (const f of nodes) {
      if (gone.has(f.id) || !touched.has(f.id) || !isVerifyPanelFrame(f)) continue
      if (nodes.some((n) => n.parentId === f.id && !gone.has(n.id))) continue
      gone.add(f.id)
      out.push(f.id)
      changed = true
    }
  }
  return out
}

/**
 * `states` without the panel frames that hold nothing — repeated, so a panel frame whose only child
 * was an empty panel frame goes too. Returns `states` itself when nothing is dropped.
 */
export function pruneEmptyVerifyPanels<
  S extends { id: string; kind: string; parentId?: string; title?: string; verifyPanel?: boolean }
>(states: S[]): S[] {
  let cur = states
  for (;;) {
    const parents = new Set(cur.map((s) => s.parentId).filter((g): g is string => !!g))
    const next = cur.filter(
      (s) =>
        parents.has(s.id) ||
        !isVerifyPanelFrame({ type: s.kind, data: { verifyPanel: s.verifyPanel, title: s.title } })
    )
    if (next.length === cur.length) return cur
    cur = next
  }
}
