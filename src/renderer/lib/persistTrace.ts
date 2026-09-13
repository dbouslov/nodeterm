import { formatPersistLine, type PersistTraceFields } from '@shared/persist-trace'

/**
 * One persistence decision, printed as a `[persist]` console line. On the desktop, main's
 * console listener appends it to `userData/persist-trace.log` (core/persist-trace.ts); in a
 * Server Edition browser tab it stays in that tab's console. Diagnostics only: never throws and
 * never decides anything.
 */
export function tracePersist(ev: string, fields: PersistTraceFields = {}): void {
  try {
    console.info(formatPersistLine(ev, fields))
  } catch {
    // Diagnostics must never break a save.
  }
}

/** A failed save's errno code for the trace (`EACCES`, …), else a fixed word — never its message. */
export function traceErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && code ? code.slice(0, 40) : 'error'
}
