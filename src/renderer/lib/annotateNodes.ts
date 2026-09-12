// The `annotate` verb's bulk rule (spec: docs/superpowers/specs/2026-09-11-network-overview-design.md
// §2), pure so the active canvas and the serialized-project path share one answer.
import { applyAnnotation, type AnnotateArgs, type NodeAnnotation } from '@shared/node-annotation'

export interface AnnotateUpdate {
  id: string
  /** The node's next annotation; undefined removes it. */
  annotation: NodeAnnotation | undefined
}

/** Validate every id first and refuse the whole list on the first unknown one, naming it. */
export function annotateNodes(
  nodes: readonly { id: string; annotation?: NodeAnnotation }[],
  parsed: AnnotateArgs,
  by: string,
  now: number
): { updates: AnnotateUpdate[] } | { error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const id of parsed.ids) if (!byId.has(id)) return { error: `annotate: no node with id ${id}` }
  return {
    updates: parsed.ids.map((id) => ({ id, annotation: applyAnnotation(byId.get(id)!.annotation, parsed, by, now) }))
  }
}

export function annotateReply(updates: readonly AnnotateUpdate[]): string {
  return `annotated ${updates.length}: ${updates.map((u) => u.id).join(', ')}`
}
