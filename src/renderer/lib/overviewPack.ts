// Compact layout for the Network overview. The overview used to copy the canvas 1:1, so a project
// with 40+ chats was unreadable at a glance. Here every chat is one small card, and cards are packed
// by BOX: one block per frame (label band on top), nested frames as nested blocks, and loose chats in
// a block of their own. Blocks are packed so the whole picture fills a view of the given aspect.
//
// Pure and deterministic: same items in, same rects out. Positions never come from the canvas —
// only the frame tree and canvas order do — so a node dragged on the canvas does not reshuffle this.

export interface PackItem {
  id: string
  parentId?: string
  isFrame: boolean
}

/** Root-space rectangle. */
export interface PackedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PackResult {
  /** Every item, plus `OVERVIEW_LOOSE_ID` when there are loose cards. */
  rects: Map<string, PackedRect>
  /** The block each packed item sits in (a frame id or `OVERVIEW_LOOSE_ID`); absent = top level. */
  parentOf: Map<string, string>
  width: number
  height: number
}

/** The synthetic block holding chats that are in no frame. Never a canvas node id. */
export const OVERVIEW_LOOSE_ID = '__overview-loose'

export const OVERVIEW_CARD = { width: 200, height: 80 } as const
/** Space between siblings. */
const GAP = 16
/** Inside a block, left/right/bottom. */
const PAD = 12
/** The label band on top of a block. */
const HEADER = 28
/** An empty frame still shows its label. */
const MIN_BLOCK_WIDTH = 160
/**
 * The shapes a frame block may aim for. The root aims for the view's shape and tries each of these
 * for the blocks inside it, keeping whichever packs the whole picture best: square-ish blocks suit a
 * few big frames, wide ones suit many small frames in a wide view.
 */
const BLOCK_ASPECTS = [1, 1.6, 2.5, 4] as const

interface Piece {
  id: string
  width: number
  height: number
  /** Positions of this piece's own descendants, relative to its top-left. */
  inner: Array<{ id: string; x: number; y: number; width: number; height: number }>
}

/**
 * Shelf-pack pieces into rows no wider than `rowWidth`, in the order given. Returns positions and
 * the packed size.
 */
function shelf(pieces: readonly Piece[], rowWidth: number) {
  const at: Array<{ x: number; y: number }> = []
  let x = 0
  let y = 0
  let rowH = 0
  let width = 0
  for (const p of pieces) {
    if (x > 0 && x + p.width > rowWidth) {
      y += rowH + GAP
      x = 0
      rowH = 0
    }
    at.push({ x, y })
    width = Math.max(width, x + p.width)
    rowH = Math.max(rowH, p.height)
    x += p.width + GAP
  }
  return { at, width, height: pieces.length ? y + rowH : 0 }
}

/**
 * Pack pieces choosing the row width whose result best fills a box of `aspect` (width / height):
 * the one minimizing `max(w, h·aspect)`, i.e. maximizing the zoom at which it fits such a box.
 * Candidates are every "first k pieces on one row" width, which covers each column count exactly
 * for equal cards. Ties go to the smaller area, then the earlier candidate.
 */
function packPieces(pieces: readonly Piece[], aspect: number) {
  if (pieces.length === 0) return { at: [], width: 0, height: 0 }
  const candidates: number[] = []
  let run = -GAP
  for (const p of pieces) {
    run += p.width + GAP
    candidates.push(run)
  }
  const widest = Math.max(...pieces.map((p) => p.width))
  let best = shelf(pieces, widest)
  let bestScore = Math.max(best.width, best.height * aspect)
  for (const w of candidates) {
    if (w < widest) continue
    const r = shelf(pieces, w)
    const score = Math.max(r.width, r.height * aspect)
    if (score < bestScore || (score === bestScore && r.width * r.height < best.width * best.height)) {
      best = r
      bestScore = score
    }
  }
  return best
}

/** Sort pieces tallest first, stable, so rows waste little height. */
function tallestFirst(pieces: Piece[]): Piece[] {
  return pieces.map((p, i) => ({ p, i })).sort((a, b) => b.p.height - a.p.height || a.i - b.i).map((e) => e.p)
}

function place(pieces: readonly Piece[], at: ReadonlyArray<{ x: number; y: number }>, dx: number, dy: number) {
  const out: Piece['inner'] = []
  pieces.forEach((p, i) => {
    const x = at[i].x + dx
    const y = at[i].y + dy
    out.push({ id: p.id, x, y, width: p.width, height: p.height })
    for (const c of p.inner) out.push({ ...c, x: c.x + x, y: c.y + y })
  })
  return out
}

export function packOverview(items: readonly PackItem[], opts: { aspect?: number } = {}): PackResult {
  const aspect = opts.aspect ?? 16 / 9
  const byId = new Map(items.map((i) => [i.id, i]))
  // The file is hostile input: a parent that is missing or not a frame is none. A parent cycle is
  // cut at ONE link — the item (in input order) whose parent would lead back to itself — so every
  // other frame in the cycle, and every card, keeps its own parent.
  const effectiveParent = new Map<string, string | undefined>()
  /** The parent as far as it is known: the decided one, else the file's (if it names a frame). */
  const upOf = (id: string): string | undefined => {
    if (effectiveParent.has(id)) return effectiveParent.get(id)
    const p = byId.get(id)?.parentId
    return p !== undefined && byId.get(p)?.isFrame ? p : undefined
  }
  for (const it of items) {
    const p = it.parentId
    let parent: string | undefined = p !== undefined && byId.get(p)?.isFrame ? p : undefined
    const seen = new Set<string>()
    for (let q = parent; q !== undefined && !seen.has(q); q = upOf(q)) {
      if (q === it.id) {
        parent = undefined
        break
      }
      // Another cycle above this item is cut when its own member is decided, not here.
      seen.add(q)
    }
    effectiveParent.set(it.id, parent)
  }
  const parentOfItem = (it: PackItem): string | undefined => effectiveParent.get(it.id)
  const children = new Map<string | undefined, PackItem[]>()
  for (const it of items) {
    const p = parentOfItem(it)
    children.set(p, [...(children.get(p) ?? []), it])
  }

  const cardPiece = (id: string): Piece => ({ id, ...OVERVIEW_CARD, inner: [] })

  /** A block: label band, then its cards and child blocks packed below it. */
  const block = (id: string, kids: readonly PackItem[], blockAspect: number): Piece => {
    const pieces = tallestFirst(
      kids.map((k) => (k.isFrame ? block(k.id, children.get(k.id) ?? [], blockAspect) : cardPiece(k.id)))
    )
    const packed = packPieces(pieces, blockAspect)
    return {
      id,
      width: Math.max(MIN_BLOCK_WIDTH, packed.width + 2 * PAD),
      height: HEADER + packed.height + PAD,
      inner: place(pieces, packed.at, PAD, HEADER)
    }
  }

  const top = children.get(undefined) ?? []
  const loose = top.filter((i) => !i.isFrame)
  let ordered: Piece[] = []
  let packed: ReturnType<typeof packPieces> = { at: [], width: 0, height: 0 }
  let bestScore = Infinity
  for (const blockAspect of BLOCK_ASPECTS) {
    const rootPieces = top.filter((i) => i.isFrame).map((f) => block(f.id, children.get(f.id) ?? [], blockAspect))
    if (loose.length) rootPieces.push(block(OVERVIEW_LOOSE_ID, loose, blockAspect))
    const o = tallestFirst(rootPieces)
    const p = packPieces(o, aspect)
    const score = Math.max(p.width, p.height * aspect)
    if (score < bestScore) {
      bestScore = score
      ordered = o
      packed = p
    }
  }

  const rects = new Map<string, PackedRect>()
  for (const r of place(ordered, packed.at, 0, 0)) rects.set(r.id, { x: r.x, y: r.y, width: r.width, height: r.height })
  const parentOf = new Map<string, string>()
  for (const it of items) {
    const p = effectiveParent.get(it.id)
    if (p !== undefined) parentOf.set(it.id, p)
    else if (!it.isFrame) parentOf.set(it.id, OVERVIEW_LOOSE_ID)
  }
  return { rects, parentOf, width: packed.width, height: packed.height }
}

/**
 * The camera that centres a packed overview in its pane, zoomed to fit with `padding` px around it
 * and never past 1 (a small network stays at its real size). Null until the pane is measured.
 * Computed, never React Flow's `fitView`, which resolves later against whatever is measured then.
 */
export function fitOverviewViewport(
  bounds: { width: number; height: number },
  pane: { width: number; height: number },
  padding = 24
): { x: number; y: number; zoom: number } | null {
  if (!(pane.width > 0) || !(pane.height > 0)) return null
  const w = Math.max(bounds.width, 1)
  const h = Math.max(bounds.height, 1)
  const zoom = Math.min(1, (pane.width - 2 * padding) / w, (pane.height - 2 * padding) / h)
  const z = zoom > 0 ? zoom : Math.min(1, pane.width / w, pane.height / h)
  return { x: (pane.width - w * z) / 2, y: (pane.height - h * z) / 2, zoom: z }
}
