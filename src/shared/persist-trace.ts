// PERSIST TRACE — one line per persistence DECISION, so a canvas that stopped reaching disk can be
// diagnosed after the fact. Field report 2026-09-13: after a relaunch, chats opened before the first
// tab switch never reached `.nodeterm/project.json` (so `send` to them was refused as cross-project),
// and nothing on screen or in any log said why. The in-memory debug ring (core/log-buffer.ts) is
// gone by the time anyone asks; this file is not.
//
// Diagnostics only: nothing reads these lines back to decide anything. Fields are ids, flags and
// sizes — never node text, prompts or file content — and `sanitizeTraceFields` enforces that at
// both ends, because the renderer's lines cross a process boundary as console text.
//
// Shared by both sides. The renderer prints `formatPersistLine(...)` to its console (no new bridge
// member: main already listens to every renderer console message), and main turns that line back
// into a record with `parsePersistLine` before core/persist-trace.ts appends it to the file.

export const PERSIST_TRACE_TAG = 'persist'
/** Longest string value kept — room for any node or project id, never for a paragraph. */
export const PERSIST_TRACE_STRING_MAX = 120
/** Most list entries kept (e.g. the project ids one save wrote). */
export const PERSIST_TRACE_LIST_MAX = 20

export type PersistTraceValue = string | number | boolean | null
/** What a caller may hand the trace. `undefined` fields are simply left out. */
export type PersistTraceFields = Record<string, PersistTraceValue | readonly string[] | undefined>
/** What a sink accepts: the sink sanitizes the fields itself. */
export type PersistTraceInput = { side: 'renderer' | 'main'; ev: string } & PersistTraceFields
/** One sanitized line: who decided (`side`), what (`ev`), and its ids/flags/sizes. */
export type PersistTraceRecord = { side: 'renderer' | 'main'; ev: string } & Record<
  string,
  PersistTraceValue | string[]
>

const KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/
const EVENT = /^[a-z][a-z0-9-]{0,39}$/
/** Set by the record itself, never by a field — a field may not re-label a line. */
const RESERVED = new Set(['side', 'ev'])
const PREFIX = `[${PERSIST_TRACE_TAG}] `

function cleanValue(v: unknown): PersistTraceValue | string[] | undefined {
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.slice(0, PERSIST_TRACE_STRING_MAX)
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === 'string')
      .slice(0, PERSIST_TRACE_LIST_MAX)
      .map((s) => s.slice(0, PERSIST_TRACE_STRING_MAX))
  }
  return undefined
}

/** Keeps only plain-identifier keys with primitive values (and lists of strings), each capped. */
export function sanitizeTraceFields(
  fields: Record<string, unknown>
): Record<string, PersistTraceValue | string[]> {
  const out: Record<string, PersistTraceValue | string[]> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!KEY.test(key) || RESERVED.has(key)) continue
    const clean = cleanValue(value)
    if (clean !== undefined) out[key] = clean
  }
  return out
}

/** The console line the renderer prints for one decision. */
export function formatPersistLine(ev: string, fields: PersistTraceFields = {}): string {
  return `${PREFIX}${JSON.stringify({ ev, ...sanitizeTraceFields(fields) })}`
}

/**
 * A renderer console message back into a record, or `null` when it is not a well-formed trace line.
 * Always `side: 'renderer'` — a line from the renderer cannot pose as one main wrote.
 */
export function parsePersistLine(message: string): PersistTraceRecord | null {
  if (typeof message !== 'string' || !message.startsWith(PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(message.slice(PREFIX.length))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { ev, ...rest } = parsed as Record<string, unknown>
  if (typeof ev !== 'string' || !EVENT.test(ev)) return null
  return { side: 'renderer', ev, ...sanitizeTraceFields(rest) }
}
