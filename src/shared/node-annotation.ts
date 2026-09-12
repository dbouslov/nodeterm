// A node's ROLE and a RECOMMENDATION about it, written by an agent through the `annotate` verb
// (spec: docs/superpowers/specs/2026-09-11-network-overview-design.md §1-2). CONTENT, like sticky
// text: it rides .nodeterm/project.json and is therefore hostile input on every read — normalize at
// both serializer seams, exactly as `normalizeNodeIcon` does. Zero-import leaf apart from oneLine.
//
// NOT `data.tags`: that field is retired, and the kanban label migration strips it from every node
// on every canvas load, so anything written there is gone at the next hydrate.
import { oneLine } from './one-line'

export interface NodeAnnotation {
  /** One line, at most ANNOTATION_ROLE_MAX characters. */
  role?: string
  /** One line, at most ANNOTATION_RECOMMEND_MAX characters. */
  recommend?: string
  /** Node id of the verified caller that last wrote the record. */
  by: string
  /** Epoch ms of the last write. */
  at: number
}

export const ANNOTATION_ROLE_MAX = 80
export const ANNOTATION_RECOMMEND_MAX = 500
export const ANNOTATE_BULK_MAX = 50

function cleanLine(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = oneLine(raw).slice(0, max)
  return s ? s : undefined
}

/**
 * Validate an annotation read from a persisted (hostile) source. Returns the value to keep, or
 * undefined — no annotation, i.e. the pre-feature node. Never throws, never substitutes.
 */
export function normalizeNodeAnnotation(raw: unknown): NodeAnnotation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as { role?: unknown; recommend?: unknown; by?: unknown; at?: unknown }
  if (typeof v.by !== 'string' || !v.by) return undefined
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return undefined
  const role = cleanLine(v.role, ANNOTATION_ROLE_MAX)
  const recommend = cleanLine(v.recommend, ANNOTATION_RECOMMEND_MAX)
  if (!role && !recommend) return undefined
  return { ...(role ? { role } : {}), ...(recommend ? { recommend } : {}), by: v.by, at: v.at }
}

export interface AnnotateArgs {
  ids: string[]
  role: string | undefined
  recommend: string | undefined
  clear: boolean
}

const ANNOTATE_FLAGS: ReadonlySet<string> = new Set(['node', 'role', 'recommend', 'clear'])

/** Pure parse of the verb's flags. Shared by the renderer dispatch and the Server Edition factory. */
export function parseAnnotateArgs(
  args: Record<string, string | undefined>
): AnnotateArgs | { error: string } {
  const unknown = Object.keys(args).find((k) => !ANNOTATE_FLAGS.has(k))
  if (unknown) return { error: `annotate: unknown flag --${unknown}` }
  const ids = [...new Set((args.node ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) return { error: 'annotate requires --node <id,id>' }
  if (ids.length > ANNOTATE_BULK_MAX) return { error: `annotate: at most ${ANNOTATE_BULK_MAX} ids per call` }
  const clear = args.clear !== undefined
  const { role, recommend } = args
  if (role === undefined && recommend === undefined && !clear) {
    return { error: 'annotate: nothing to write (pass --role, --recommend or --clear)' }
  }
  return { ids, role, recommend, clear }
}

/**
 * The write rule (spec §2): without --clear an absent flag leaves that half untouched; with
 * --clear only the flags given survive. Returns undefined when nothing is left, which removes the
 * annotation from the node.
 */
export function applyAnnotation(
  existing: NodeAnnotation | undefined,
  parsed: AnnotateArgs,
  by: string,
  now: number
): NodeAnnotation | undefined {
  const base = parsed.clear ? {} : { role: existing?.role, recommend: existing?.recommend }
  const role = parsed.role !== undefined ? parsed.role : base.role
  const recommend = parsed.recommend !== undefined ? parsed.recommend : base.recommend
  return normalizeNodeAnnotation({ role, recommend, by, at: now })
}
