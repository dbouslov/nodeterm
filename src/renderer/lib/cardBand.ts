// HELPER CARDS COUNT IN LAYOUT. A chat's subagent and loop cards sit in a row under it, and the
// layout keeps room for that row: every layout step measures a chat by `applied()`, its own rect
// grown downward by `data.cardBand`. The band is layout-only; the chat's saved size never changes,
// and it is never fed to `commonChatSize`/`resizeChats`.
//
// THE RULES (each pinned in cardBand.test.ts):
// 1. The card row: the chat's cards (loop card first) at their collapsed size, GROUP_GAP below the
//    chat, wrapping at its right edge, each clamped to its width (`packCardRow`). A `hideFanout`
//    chat draws no cards and has no row.
// 2. Only `CardBands.step` changes a band. Its target is the tallest the chat's row has been over
//    the trailing BAND_WINDOW_MS: it grows BAND_GROW_MS after the row last changed, and shrinks at
//    most once per window, so a burst of helpers is one push and the room comes back one window
//    after the row shrank.
// 3. A change waits while anything is dragged or resized, while any chat it would move had a
//    keydown in the last TYPING_HOLD_MS (no cap), and while the pointer is over one of them
//    (capped at POINTER_HOLD_CAP_MS). The busy chat itself never moves.
// 4. A pinned chat never grows a band; one it already has is released at once.
// 5. `setCardBand` writes the band onto the chat FIRST and then reflows from the old applied rect,
//    and is a no-op when the band is already there, so a second application cannot shift twice.
import { GROUP_GAP } from '@shared/placement'
import { isPinned, type CanvasNode } from '../state/workspace'
import { absolutePosition, type FocusableNode } from './nodeFocus'
import type { Rect } from './nodeSizing'
import { reflow } from './reflow'

/** Space between two cards in the row, both ways. */
export const CARD_GAP = 10
/** Collapsed card sizes (the builders' defaults, lib/loopCards and lib/subagentCards). */
export const LOOP_CARD_SIZE = { width: 230, height: 92 }
export const SUBAGENT_CARD_SIZE = { width: 230, height: 96 }

export const BAND_GROW_MS = 1000
export const BAND_WINDOW_MS = 60_000
export const TYPING_HOLD_MS = 3000
export const POINTER_HOLD_CAP_MS = 20_000
/** How often a change held by a drag or resize looks again. */
export const BUSY_RETRY_MS = 250
export const SLIDE_MS = 180

const nodeW = (n: CanvasNode): number => n.measured?.width ?? (n.width as number) ?? 0
const nodeH = (n: CanvasNode): number => n.measured?.height ?? (n.height as number) ?? 0

/** The band a node keeps under it: `data.cardBand` when it is a usable number, else 0. */
export function bandOf(n: { data?: Record<string, unknown> }): number {
  const b = n.data?.cardBand
  return typeof b === 'number' && Number.isFinite(b) && b > 0 ? b : 0
}

/** The rect every layout step measures a node by: its own, grown downward by its band. */
export function applied(n: CanvasNode): Rect {
  return { x: n.position.x, y: n.position.y, width: nodeW(n), height: nodeH(n) + bandOf(n) }
}

export interface RowCard {
  id: string
  width: number
  height: number
}

export interface CardRow {
  /** Each card's offset inside the row (from the row's top-left) and its clamped width. */
  at: Map<string, { x: number; y: number; width: number }>
  /** The band the row needs under the chat: GROUP_GAP plus the rows' height; 0 with no cards. */
  band: number
}

/** Rule 1: the cards in reading order, wrapping at `chatWidth`, each no wider than it. Pure. */
export function packCardRow(chatWidth: number, cards: readonly RowCard[]): CardRow {
  const at = new Map<string, { x: number; y: number; width: number }>()
  let x = 0
  let y = 0
  let rowH = 0
  for (const c of cards) {
    const width = chatWidth > 0 ? Math.min(c.width, chatWidth) : c.width
    if (x > 0 && x + width > chatWidth) {
      x = 0
      y += rowH + CARD_GAP
      rowH = 0
    }
    at.set(c.id, { x, y, width })
    x += width + CARD_GAP
    rowH = Math.max(rowH, c.height)
  }
  return { at, band: cards.length ? GROUP_GAP + y + rowH : 0 }
}

/** The row of `chat`'s cards: its loop card (when `hasLoop`) first, then `subIds`, each at its
 *  collapsed size or the user's resize. */
export function cardRowOf(
  chat: CanvasNode,
  hasLoop: boolean,
  subIds: readonly string[],
  sizes: Readonly<Record<string, { width: number; height: number }>>
): CardRow {
  const lid = `loop-${chat.id}`
  const cards: RowCard[] = [
    ...(hasLoop ? [{ id: lid, ...(sizes[lid] ?? LOOP_CARD_SIZE) }] : []),
    ...subIds.map((id) => ({ id, ...(sizes[id] ?? SUBAGENT_CARD_SIZE) }))
  ]
  return packCardRow(nodeW(chat), cards)
}

/** Where a laid-out card goes, as an offset from its chat: in the row, GROUP_GAP below the chat. */
export function cardOffset(chat: CanvasNode, row: CardRow, id: string): { x: number; y: number } {
  const at = row.at.get(id) ?? { x: 0, y: 0 }
  return { x: at.x, y: nodeH(chat) + GROUP_GAP + at.y }
}

/** A card's drawn width, no wider than its chat (a chat with no size yet does not clamp). */
export function clampToChat(chat: CanvasNode, width: number): number {
  const w = nodeW(chat)
  return w > 0 ? Math.min(width, w) : width
}

/** The row band of every chat on `nodes` that draws cards: the loop owners in `loopParents` and the
 *  owners of `subs`, less the `hideFanout` ones. */
export function cardRowBands(
  nodes: readonly CanvasNode[],
  loopParents: ReadonlySet<string>,
  subs: Readonly<Record<string, { parentNodeId: string }>>,
  sizes: Readonly<Record<string, { width: number; height: number }>>
): Map<string, number> {
  const subsOf = new Map<string, string[]>()
  for (const id of Object.keys(subs)) {
    const pid = subs[id].parentNodeId
    subsOf.set(pid, [...(subsOf.get(pid) ?? []), id])
  }
  const out = new Map<string, number>()
  for (const pid of new Set([...loopParents, ...subsOf.keys()])) {
    const chat = nodes.find((n) => n.id === pid)
    if (!chat || chat.data.hideFanout) continue
    out.set(pid, cardRowOf(chat, loopParents.has(pid), subsOf.get(pid) ?? [], sizes).band)
  }
  return out
}

/**
 * Rule 5: `id`'s band set to `band`, and the canvas reflowed from its old applied rect. The SAME
 * array comes back when the chat is gone (a timer that fires after a project switch) or already has
 * that band.
 */
export function setCardBand(nodes: CanvasNode[], id: string, band: number, grid = 0): CanvasNode[] {
  const chat = nodes.find((n) => n.id === id)
  if (!chat || bandOf(chat) === band) return nodes
  const prev = applied(chat)
  const next = nodes.map((n) =>
    n.id === id ? { ...n, data: { ...n.data, cardBand: band > 0 ? band : undefined } } : n
  )
  return reflow(next, id, prev, grid)
}

/** Ids of the nodes whose ABSOLUTE position differs between `before` and `after`: a chat inside a
 *  frame that moved counts, though its own `position` did not change. */
export function movedNodes(before: readonly CanvasNode[], after: readonly CanvasNode[]): string[] {
  if (before === after) return []
  const b = before as unknown as FocusableNode[]
  const a = after as unknown as FocusableNode[]
  const was = new Map(b.map((n) => [n.id, absolutePosition(n, b)]))
  return a
    .filter((n) => {
      const w = was.get(n.id)
      if (!w) return false
      const p = absolutePosition(n, a)
      return p.x !== w.x || p.y !== w.y
    })
    .map((n) => n.id)
}

export interface BandEnv {
  now: number
  /** A drag or a resize is in progress. */
  busy: boolean
  /** Last keydown per node id. */
  lastKeydown: ReadonlyMap<string, number>
  /** The node under the pointer, or null. */
  pointerOver: string | null
}

export interface BandStep {
  /** The canvas with every band change that is due and not held; `nodes` itself when none is. */
  nodes: CanvasNode[]
  /** The changes, in order: replay them with `setCardBand` inside `setNodes`. */
  apply: { id: string; band: number }[]
  /** Every node (frames and cards' chats included) whose absolute position the changes move. */
  moved: string[]
  /** Chats with a band change that is due but held. */
  held: Set<string>
  /** When to step again, or null when nothing is pending. */
  wakeAt: number | null
}

interface Track {
  /** The row band as a step function: each value holds from its `t` until the next sample. */
  samples: { t: number; v: number }[]
  lastShrinkAt: number | null
  /** When the pointer first held the pending change (the cap runs from here). */
  pointerSince: number | null
}

/** Rules 2-4, over time. One instance per canvas; `step` is called whenever anything it reads may
 *  have changed, and again at `wakeAt`. */
export class CardBands {
  private tracks = new Map<string, Track>()
  /** The chats whose change the last step held: `geometry` skips their cards. */
  held: ReadonlySet<string> = new Set()

  step(nodes: CanvasNode[], rows: ReadonlyMap<string, number>, env: BandEnv, grid = 0): BandStep {
    const { now } = env
    const chats = nodes.filter((n) => n.type !== 'group' && (rows.has(n.id) || bandOf(n) > 0))
    const live = new Set(chats.map((n) => n.id))
    for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id)

    let cur = nodes
    const apply: { id: string; band: number }[] = []
    const held = new Set<string>()
    let wakeAt: number | null = null
    const wake = (t: number): void => {
      wakeAt = wakeAt === null ? t : Math.min(wakeAt, t)
    }

    for (const chat of chats) {
      const have = bandOf(chat)
      const row = rows.get(chat.id) ?? 0
      const track = this.observe(chat.id, row, have, now)
      let want: number | null = null
      if (isPinned(chat, nodes)) {
        // Rule 4: never grows; a band it was pinned with goes at once.
        if (have > 0) want = 0
      } else {
        const target = trailingMax(track, now)
        const lastChange = track.samples[track.samples.length - 1].t
        if (row > have && target > have) {
          if (now >= lastChange + BAND_GROW_MS) want = target
          else wake(lastChange + BAND_GROW_MS)
        } else if (target < have) {
          const after = track.lastShrinkAt === null ? now : track.lastShrinkAt + BAND_WINDOW_MS
          if (now >= after) want = target
          else wake(after)
        }
        const expiry = nextExpiry(track, now)
        if (expiry !== null) wake(expiry)
      }
      if (want === null) {
        track.pointerSince = null
        continue
      }

      // Rule 3: the holds.
      if (env.busy) {
        held.add(chat.id)
        wake(now + BUSY_RETRY_MS)
        continue
      }
      const next = setCardBand(cur, chat.id, want, grid)
      const movers = movedNodes(cur, next).filter((id) => id !== chat.id)
      const moverChats = movers.filter((id) => next.find((n) => n.id === id)?.type !== 'group')
      const typed = moverChats
        .map((id) => env.lastKeydown.get(id))
        .filter((t): t is number => t !== undefined && now - t < TYPING_HOLD_MS)
      if (typed.length) {
        held.add(chat.id)
        wake(Math.max(...typed) + TYPING_HOLD_MS)
        continue
      }
      if (env.pointerOver && moverChats.includes(env.pointerOver)) {
        track.pointerSince ??= now
        if (now < track.pointerSince + POINTER_HOLD_CAP_MS) {
          held.add(chat.id)
          wake(track.pointerSince + POINTER_HOLD_CAP_MS)
          continue
        }
      }
      if (want < have) track.lastShrinkAt = now
      track.pointerSince = null
      apply.push({ id: chat.id, band: want })
      cur = next
    }
    this.held = held
    return { nodes: cur, apply, moved: movedNodes(nodes, cur), held, wakeAt }
  }

  /** Record `row` for `id`. A chat seen for the first time with a band (a reload, a project switch)
   *  counts that band as seen now, so it is released one window later, not at once. */
  private observe(id: string, row: number, have: number, now: number): Track {
    let track = this.tracks.get(id)
    if (!track) {
      track = { samples: have > 0 ? [{ t: now, v: have }] : [], lastShrinkAt: null, pointerSince: null }
      this.tracks.set(id, track)
    }
    const last = track.samples[track.samples.length - 1]
    if (!last || last.v !== row) track.samples.push({ t: now, v: row })
    // Drop what has left the window, keeping the value in force.
    while (track.samples.length > 1 && track.samples[1].t <= now - BAND_WINDOW_MS) track.samples.shift()
    return track
  }
}

/** The tallest the row has been over the trailing window. */
function trailingMax(track: Track, now: number): number {
  let max = 0
  track.samples.forEach((s, i) => {
    const end = i + 1 < track.samples.length ? track.samples[i + 1].t : Infinity
    if (end > now - BAND_WINDOW_MS) max = Math.max(max, s.v)
  })
  return max
}

/** When the next superseded sample leaves the window (the trailing max may drop then). */
function nextExpiry(track: Track, now: number): number | null {
  for (let i = 0; i + 1 < track.samples.length; i++) {
    const out = track.samples[i + 1].t + BAND_WINDOW_MS
    if (out > now) return out
  }
  return null
}

export interface BandDriverDeps {
  /** The canvas as it is now (Canvas: `nodesRef.current`). */
  nodes(): CanvasNode[]
  /** The row band of every chat with cards on `nodes` (`cardRowBands`). */
  rows(nodes: CanvasNode[]): ReadonlyMap<string, number>
  env(): Omit<BandEnv, 'now'>
  grid(): number
  /** Apply the step's changes: replay `apply` with `setCardBand` inside `setNodes`. */
  commit(step: BandStep): void
}

/** The loop Canvas runs: step now, and again at the step's `wakeAt`. `run` is safe to call on
 *  every change to anything it reads; `dispose` stops the timer. */
export class CardBandDriver {
  private readonly bands = new CardBands()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: BandDriverDeps) {}

  get held(): ReadonlySet<string> {
    return this.bands.held
  }

  run = (): void => {
    this.dispose()
    const nodes = this.deps.nodes()
    const now = Date.now()
    const out = this.bands.step(nodes, this.deps.rows(nodes), { ...this.deps.env(), now }, this.deps.grid())
    if (out.apply.length) this.deps.commit(out)
    if (out.wakeAt !== null) this.timer = setTimeout(this.run, Math.max(0, out.wakeAt - now))
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
