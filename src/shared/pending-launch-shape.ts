// A held launch (`CanvasNodeState.pendingLaunch`) read back from a hand-editable file
// (workspace.json's `localExec`). The launch loop runs `p.after.every(...)`, so an `after` that is
// not a list would throw, and a gate dropped by a repair would open early.
//
// Fork backport of upstream 2d3e54cb's module, sized to this build's `PendingLaunch`: it has no
// `manualOnly` to park an unreadable hold behind ▶, so a hold this module cannot read in full is
// DROPPED whole — nothing launches, which is the safe direction. A dependent that has launched
// cannot un-launch; one that never launched can be re-issued.
//
// Fields this build does not know are KEPT, so saving from this build does not erase a field a
// newer build wrote.

import type { PendingLaunch } from './types'

const KNOWN = new Set(['after', 'command', 'executor', 'awaitWorking', 'awaitSetupGroup'])

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((d) => typeof d === 'string')

export function normalizePendingLaunch(value: unknown): PendingLaunch | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  if (typeof v.command !== 'string') return undefined
  // A newer build's gates this build does not enforce: kept as unknown fields, the hold would fire
  // at once. `manualOnly`/`attempted: true` wait for ▶; `afterPr`/`afterSuccess` wait on more than `after`.
  if (v.manualOnly === true || v.attempted === true) return undefined
  if (v.afterPr !== undefined || v.afterSuccess !== undefined) return undefined
  if (v.after !== undefined && !isStringList(v.after)) return undefined
  if (v.executor !== undefined && v.executor !== 'server') return undefined
  if (v.awaitWorking !== undefined && !isStringList(v.awaitWorking)) return undefined
  if (v.awaitSetupGroup !== undefined && typeof v.awaitSetupGroup !== 'string') return undefined
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(v)) if (!KNOWN.has(key)) out[key] = v[key]
  out.after = v.after ?? []
  out.command = v.command
  if (v.executor !== undefined) out.executor = v.executor
  if (v.awaitWorking !== undefined) out.awaitWorking = v.awaitWorking
  if (v.awaitSetupGroup !== undefined) out.awaitSetupGroup = v.awaitSetupGroup
  return out as unknown as PendingLaunch
}
