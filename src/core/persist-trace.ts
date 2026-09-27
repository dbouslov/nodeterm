// The on-disk half of the persist trace (the record format and the reason it exists are in
// shared/persist-trace.ts). Append-only, bounded: when a line would push the file past `maxBytes`
// it is rotated to `<file>.1` (replacing the previous one) and a fresh file starts, so the trace
// never holds more than two files. Every failure is swallowed — this is diagnostics, and a save
// must never fail or wait because its trace line could not be written.

import { promises as fs } from 'fs'
import { renameAtomic } from './fs-atomic'
import {
  parsePersistLine,
  sanitizeTraceFields,
  type PersistTraceInput
} from '../shared/persist-trace'

export const PERSIST_TRACE_FILE = 'persist-trace.log'
/** Per file; with the one rotation the trace stays under twice this. */
export const PERSIST_TRACE_MAX_BYTES = 1024 * 1024

export interface PersistTrace {
  /** Queue one line. Never throws, never blocks the caller. */
  record(rec: PersistTraceInput): void
  /** Resolves once every line queued so far has been written (or has failed). */
  flushed(): Promise<void>
}

export function createPersistTrace(opts: {
  /** The file, or a getter resolved at write time (userData is not always known at startup). */
  file: string | (() => string)
  maxBytes?: number
  now?: () => Date
}): PersistTrace {
  const maxBytes = opts.maxBytes ?? PERSIST_TRACE_MAX_BYTES
  const now = opts.now ?? (() => new Date())
  // Last known size per file. Unknown ⇒ stat first, so a file left by the previous run counts.
  const sizes = new Map<string, number>()
  let chain: Promise<void> = Promise.resolve()

  const append = async (file: string, line: string): Promise<void> => {
    const bytes = Buffer.byteLength(line)
    let size = sizes.get(file)
    if (size === undefined) size = (await fs.stat(file).catch(() => null))?.size ?? 0
    if (size > 0 && size + bytes > maxBytes) {
      // A rotation that cannot rename (the `.1` slot is unwritable, a Windows lock outlasting
      // renameAtomic's retries) empties the live file instead. Losing the older lines keeps the
      // bound; throwing here would leave the file over the cap, so every later line would retry
      // the same rename and be dropped — the trace dark for the rest of the run.
      await renameAtomic(file, `${file}.1`).catch(() => fs.truncate(file, 0))
      size = 0
    }
    await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o600 })
    sizes.set(file, size + bytes)
  }

  return {
    record(rec) {
      let line: string
      try {
        const { side, ev, ...rest } = rec
        line = `${now().toISOString()} ${JSON.stringify({ side, ev, ...sanitizeTraceFields(rest) })}\n`
      } catch {
        return
      }
      chain = chain.then(async () => {
        let file = ''
        try {
          file = typeof opts.file === 'function' ? opts.file() : opts.file
          await append(file, line)
        } catch {
          // Size is unknown after a failure: re-stat on the next line rather than trust the cache.
          if (file) sizes.delete(file)
        }
      })
    },
    flushed: () => chain
  }
}

/**
 * Main's console listener hands EVERY renderer console message here; only a well-formed
 * `[persist]` line is written. Returns whether it was one.
 */
export function traceFromConsole(message: string, trace: PersistTrace): boolean {
  const rec = parsePersistLine(message)
  if (!rec) return false
  trace.record(rec)
  return true
}

/**
 * Whether a console message may write the persist trace: only from the app's own window
 * (`getType() === 'window'`, never a `<webview>` guest) AND from that window's TOP frame — a
 * webContents reports its sub-frames' console too, and an iframe (the PDF viewer in an editor node)
 * is not the app. A message whose frame is unknown is refused.
 */
export function traceConsoleSourceAllowed(
  contentsType: string,
  frame: { parent: unknown } | null | undefined
): boolean {
  return contentsType === 'window' && frame != null && frame.parent === null
}
