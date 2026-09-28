import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeChange } from '@xyflow/react'
import { GROUP_GAP } from '@shared/placement'
import { arrangeNodes, fitGroupToChildren, type CanvasNode } from '../state/workspace'
import { useAgentNodes } from '../state/agentNodes'
import type { AgentNodeStatus } from '../state/agentStatus'
import {
  BAND_WINDOW_MS,
  CARD_GAP,
  CardBandDriver,
  cardRowBands,
  packCardRow,
  setCardBand,
  type BandStep
} from './cardBand'
import { buildLoopCards, loopParentIds } from './loopCards'
import { buildSubagentCards } from './subagentCards'
import { geometryReply } from './geometry'
import { absolutePosition } from './nodeFocus'
import { resizesEnded, settle, reflow } from './reflow'
import { planArrange } from './layoutVerbs'

// THE FIXTURE (design 5.1 T4): a chat in a frame, a sibling chat 40px below it, a sibling to the right.
const chat = (id: string, x: number, y: number, w = 600, h = 400, parentId?: string): CanvasNode => ({
  id,
  type: 'terminal',
  position: { x, y },
  width: w,
  height: h,
  ...(parentId ? { parentId, extent: 'parent' as const } : {}),
  data: { title: id, color: '#fff', group: null, agentId: 'claude' }
})
const frame = (id: string, x = 0, y = 0): CanvasNode => ({
  id,
  type: 'group',
  position: { x, y },
  width: 10,
  height: 10,
  data: { title: id, color: '#fff', group: null }
})

function fixture(opts: { chatW?: number; below?: boolean } = {}): CanvasNode[] {
  const w = opts.chatW ?? 600
  const nodes = [
    frame('F'),
    chat('C', 28, 62, w, 400, 'F'),
    chat('S', 28, 62 + 400 + 40, 600, 400, 'F'),
    chat('R', 28 + w + 40, 62, 600, 400, 'F')
  ]
  let out = fitGroupToChildren(nodes, 'F')
  if (opts.below) {
    // (n): a second top-level frame below the busy chat's frame, holding the chat David types in.
    const f = out.find((n) => n.id === 'F')!
    out = fitGroupToChildren([...out, frame('F2', 0, f.position.y + (f.height as number) + 40), chat('D', 28, 62, 600, 400, 'F2')], 'F2')
  }
  return out
}

const cron = (): AgentNodeStatus =>
  ({ loop: { count: 0, kind: 'cron', schedule: '*/5 * * * *', task: 't', items: [] } }) as unknown as AgentNodeStatus

/** Canvas's loop, around a plain array: the driver, the stores, and a record of every move. */
class Sim {
  loops: Record<string, AgentNodeStatus> = {}
  keys = new Map<string, number>()
  pointer: string | null = null
  busy = false
  moves = new Map<string, number>()
  commits: BandStep[] = []
  readonly driver: CardBandDriver
  private unsub: () => void

  constructor(public nodes: CanvasNode[]) {
    this.driver = new CardBandDriver({
      nodes: () => this.nodes,
      rows: (ns) => {
        const s = useAgentNodes.getState()
        return cardRowBands(ns, loopParentIds(this.loops), s.byId, s.sizes)
      },
      env: () => ({ busy: this.busy, lastKeydown: this.keys, pointerOver: this.pointer }),
      grid: () => 0,
      commit: (step) => {
        const before = this.nodes
        this.nodes = step.apply.reduce((acc, a) => setCardBand(acc, a.id, a.band), this.nodes)
        this.commits.push(step)
        for (const n of this.nodes) {
          const b = before.find((x) => x.id === n.id)
          if (b && (b.position.x !== n.position.x || b.position.y !== n.position.y)) {
            this.moves.set(n.id, (this.moves.get(n.id) ?? 0) + 1)
          }
        }
      }
    })
    // Canvas re-runs the effect whenever the card stores change.
    this.unsub = useAgentNodes.subscribe(() => this.driver.run())
    this.driver.run()
  }

  get(id: string): CanvasNode {
    return this.nodes.find((n) => n.id === id)!
  }
  abs(id: string): { x: number; y: number } {
    return absolutePosition(this.get(id), this.nodes)
  }
  cards(): CanvasNode[] {
    const ui = useAgentNodes.getState()
    const cardUi = { positions: ui.positions, sizes: ui.sizes, expanded: ui.expanded, selectedId: null, snap: 0 }
    return [
      ...buildLoopCards(this.nodes, this.loops, cardUi).nodes,
      ...buildSubagentCards(this.nodes, ui.byId, cardUi, loopParentIds(this.loops)).nodes
    ]
  }
  geometry() {
    const r = geometryReply([...this.nodes, ...this.cards()], undefined, { held: this.driver.held })
    if (!r.ok) throw new Error(r.error)
    return r
  }
  addLoop(pid: string): void {
    this.loops = { ...this.loops, [pid]: cron() }
    this.driver.run()
  }
  dropLoop(pid: string): void {
    const { [pid]: _gone, ...rest } = this.loops
    this.loops = rest
    this.driver.run()
  }
  key(id: string): void {
    this.keys.set(id, Date.now())
  }
  dispose(): void {
    this.unsub()
    this.driver.dispose()
  }
}

const spawn = (pid: string, n: number, prefix = 't'): string[] =>
  Array.from({ length: n }, (_, i) => {
    const id = `${prefix}${i}`
    useAgentNodes.getState().start(id, { parentNodeId: pid, type: 'general-purpose', label: id })
    return id
  })

/** The band of a row of cards on a 600px chat: two per row. */
const TWO_ROWS = GROUP_GAP + 96 + CARD_GAP + 96
const ONE_LOOP_ROW = GROUP_GAP + 92

let sims: Sim[] = []
const sim = (nodes: CanvasNode[]): Sim => {
  const s = new Sim(nodes)
  sims.push(s)
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  useAgentNodes.setState({ byId: {}, activityById: {}, positions: {}, sizes: {}, expanded: {}, selectedId: null, autoHideFinished: false })
})
afterEach(() => {
  for (const s of sims) s.dispose()
  sims = []
  vi.useRealTimers()
})

describe('packCardRow', () => {
  it('wraps at the chat edge, clamps a card to the chat width, and needs no band without cards', () => {
    const row = packCardRow(500, [
      { id: 'a', width: 230, height: 92 },
      { id: 'b', width: 230, height: 96 },
      { id: 'c', width: 900, height: 96 }
    ])
    expect(row.at.get('a')).toEqual({ x: 0, y: 0, width: 230 })
    expect(row.at.get('b')).toEqual({ x: 240, y: 0, width: 230 })
    expect(row.at.get('c')).toEqual({ x: 0, y: 106, width: 500 })
    expect(row.band).toBe(GROUP_GAP + 106 + 96)
    expect(packCardRow(500, []).band).toBe(0)
  })
})

describe('T4: helper cards count in layout', () => {
  it('(a) a loop card and 3 subagent cards: 0 overlaps, 0 outside, the sibling below moved by exactly the band', () => {
    const s = sim(fixture())
    const sY = s.abs('S').y
    s.addLoop('C')
    spawn('C', 3)
    vi.advanceTimersByTime(1000)
    const g = s.geometry()
    expect(g.result.overlaps).toEqual([])
    expect(g.result.outside).toEqual([])
    expect(s.get('C').data.cardBand).toBe(TWO_ROWS)
    expect(s.abs('S').y - sY).toBe(TWO_ROWS)
    expect(s.abs('R')).toEqual(absolutePosition(fixture().find((n) => n.id === 'R')!, fixture()))
  })

  it('(b) cards cleared: 61 s later the sibling and the frame are back at their exact prior rects', () => {
    const before = fixture()
    const s = sim(before)
    s.addLoop('C')
    spawn('C', 3)
    vi.advanceTimersByTime(1000)
    s.dropLoop('C')
    useAgentNodes.getState().clearForParent('C')
    vi.advanceTimersByTime(BAND_WINDOW_MS - 1000)
    expect(s.get('C').data.cardBand).toBe(TWO_ROWS) // not before the window
    vi.advanceTimersByTime(2000)
    expect(s.get('C').data.cardBand).toBeUndefined()
    for (const id of ['S', 'F', 'R']) {
      const b = before.find((n) => n.id === id)!
      const n = s.get(id)
      expect([n.position, n.width, n.height]).toEqual([b.position, b.width, b.height])
    }
  })

  it("(c) the chat's saved size never changes, and an arrange with cards differs only by the band", () => {
    const s = sim(fixture())
    s.addLoop('C')
    spawn('C', 3)
    vi.advanceTimersByTime(1000)
    const c = s.get('C')
    expect([c.width, c.height, c.measured]).toEqual([600, 400, undefined])
    const withBand = arrangeNodes(s.nodes, ['C', 'S'], { layout: 'column' })
    const plain = arrangeNodes(
      s.nodes.map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, cardBand: undefined } } : n)),
      ['C', 'S'],
      { layout: 'column' }
    )
    const at = (ns: CanvasNode[], id: string) => ns.find((n) => n.id === id)!.position
    expect(at(withBand, 'C')).toEqual(at(plain, 'C'))
    expect(at(withBand, 'S').y - at(plain, 'S').y).toBe(TWO_ROWS)
    expect(withBand.find((n) => n.id === 'C')!.height).toBe(400)

    // Through the arrange verb inside the frame, which sizes chats by commonChatSize first: the
    // common size is the chats' own (600x400), never grown by the band.
    const verb = (ns: CanvasNode[]) => {
      const p = planArrange(ns, 'arrange', { nodes: 'C,S', layout: 'column' }, 0)
      if (!p.ok) throw new Error(p.error)
      return p
    }
    const vBand = verb(s.nodes)
    const vPlain = verb(s.nodes.map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, cardBand: undefined } } : n)))
    expect(vBand.result.chatSize).toEqual({ width: 600, height: 400 })
    expect(vPlain.result.chatSize).toEqual({ width: 600, height: 400 })
    const c2 = vBand.nodes.find((n) => n.id === 'C')!
    expect([c2.width, c2.height, c2.data.cardBand]).toEqual([600, 400, TWO_ROWS])
    expect(at(vBand.nodes, 'S').y - at(vPlain.nodes, 'S').y).toBe(TWO_ROWS)
  })

  it('(d) a pinned chat: no band, no reflow, its card findings counted apart; a leftover band is cleared', () => {
    const pinned = fixture().map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, pinned: true } } : n))
    const s = sim(pinned)
    s.addLoop('C')
    spawn('C', 3)
    vi.advanceTimersByTime(5000)
    expect(s.get('C').data.cardBand).toBeUndefined()
    expect(s.commits).toEqual([])
    const summary = s.geometry().message.split('\n')[0]
    expect(summary).toMatch(/^3 nodes, 1 frame, 0 overlaps; 4 cards: [1-9]\d* overlaps?/)

    // Pinned while busy: the band it kept is released at once, pulling the sibling back.
    const base = pinned.map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, pinned: undefined } } : n))
    const grown = setCardBand(base, 'C', TWO_ROWS).map((n) =>
      n.id === 'C' ? { ...n, data: { ...n.data, pinned: true } } : n
    )
    const t = sim(grown)
    expect(t.get('C').data.cardBand).toBeUndefined()
    expect(t.get('S').position).toEqual(base.find((n) => n.id === 'S')!.position)
  })

  it('(e) a reload with a saved band and no cards releases it 60 s after mount', () => {
    const base = fixture()
    const s = sim(setCardBand(base, 'C', TWO_ROWS))
    vi.advanceTimersByTime(BAND_WINDOW_MS - 1)
    expect(s.get('C').data.cardBand).toBe(TWO_ROWS)
    vi.advanceTimersByTime(1)
    expect(s.get('C').data.cardBand).toBeUndefined()
    expect(s.get('S').position).toEqual(base.find((n) => n.id === 'S')!.position)
  })

  it('(f) hiding the fan-out of a chat with a band releases it at once', () => {
    const base = fixture()
    const hidden = setCardBand(base, 'C', TWO_ROWS).map((n) =>
      n.id === 'C' ? { ...n, data: { ...n.data, hideFanout: true } } : n
    )
    const s = sim(hidden)
    expect(s.get('C').data.cardBand).toBeUndefined()
    expect(s.get('S').position).toEqual(base.find((n) => n.id === 'S')!.position)
  })

  it('(f) a hideFanout chat: no cards, no band, nothing moves', () => {
    const hidden = fixture().map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, hideFanout: true } } : n))
    const s = sim(hidden)
    s.addLoop('C')
    spawn('C', 3)
    vi.advanceTimersByTime(5000)
    expect(s.cards()).toEqual([])
    expect(s.nodes).toBe(hidden)
  })

  for (const autoHide of [true, false]) {
    it(`(g) 5 cards in one row finishing 30 s apart move the sibling exactly twice (auto-hide ${autoHide ? 'on' : 'off'})`, () => {
      useAgentNodes.getState().setAutoHideFinished(autoHide)
      const s = sim(fixture({ chatW: 1400 }))
      const sY = s.abs('S').y
      const ids = spawn('C', 5)
      vi.advanceTimersByTime(1000)
      expect(s.abs('S').y - sY).toBe(GROUP_GAP + 96)
      for (const id of ids) {
        vi.advanceTimersByTime(30_000)
        useAgentNodes.getState().finish(id, {})
      }
      // Off, a finished card stays until the turn boundary takes it.
      if (!autoHide) useAgentNodes.getState().clearFinishedForParent('C')
      vi.advanceTimersByTime(BAND_WINDOW_MS + 1000)
      expect(s.abs('S').y).toBe(sY)
      expect(s.moves.get('S')).toBe(2)
    })
  }

  it('(h) expanding a card moves nothing, geometry exempts it, and a click elsewhere collapses it', () => {
    const s = sim(fixture())
    const [id] = spawn('C', 1)
    vi.advanceTimersByTime(1000)
    const moved = s.commits.length
    useAgentNodes.getState().toggleExpanded(id)
    vi.advanceTimersByTime(5000)
    expect(s.commits.length).toBe(moved)
    const card = s.cards().find((c) => c.id === id)!
    expect(card.height).toBe(340) // the peek draws past the band, over the sibling below
    expect(s.geometry().result.overlaps).toEqual([])
    useAgentNodes.getState().collapseExpanded()
    expect(useAgentNodes.getState().expanded[id]).toBeFalsy()
    // And its subagent finishing collapses it too.
    useAgentNodes.getState().toggleExpanded(id)
    useAgentNodes.getState().finish(id, {})
    expect(useAgentNodes.getState().expanded[id]).toBeFalsy()
  })

  it('(i) the pointer over the sibling below holds the move until it leaves, or 20 s', () => {
    const s = sim(fixture())
    const sY = s.abs('S').y
    s.pointer = 'S'
    spawn('C', 1)
    vi.advanceTimersByTime(19_000)
    expect(s.abs('S').y).toBe(sY)
    vi.advanceTimersByTime(2000)
    expect(s.abs('S').y).toBe(sY + GROUP_GAP + 96)

    useAgentNodes.getState().clearForParent('C')
    const t = sim(fixture())
    t.pointer = 'S'
    t.addLoop('C')
    vi.advanceTimersByTime(5000)
    expect(t.get('C').data.cardBand).toBeUndefined()
    t.pointer = null
    t.driver.run() // Canvas re-runs on pointer leave
    expect(t.get('C').data.cardBand).toBe(ONE_LOOP_ROW)
  })

  it('(j) a drag end and a resize end of a chat with cards move no band sibling beyond the push; the band is unchanged', () => {
    const banded = setCardBand(fixture(), 'C', TWO_ROWS)
    expect(settle(banded, 'C')).toEqual(banded)
    // Dropped 60px lower, the chat's band (not its own rect) reaches the sibling: the drag end
    // pushes it off the band by the gap, once, and never by a second band.
    const c0 = banded.find((n) => n.id === 'C')!
    const dropped = banded.map((n) => (n.id === 'C' ? { ...n, position: { ...n.position, y: n.position.y + 60 } } : n))
    const settled = settle(dropped, 'C')
    expect(settled.find((n) => n.id === 'S')!.position.y).toBe(c0.position.y + 60 + 400 + TWO_ROWS + 40)
    expect(settled.find((n) => n.id === 'C')!.data.cardBand).toBe(TWO_ROWS)
    const raw = dropped.map((n) => (n.id === 'C' ? { ...n, data: { ...n.data, cardBand: undefined } } : n))
    expect(settle(raw, 'C').find((n) => n.id === 'S')!.position).toEqual(
      raw.find((n) => n.id === 'S')!.position
    )

    const started = new Map()
    const c = banded.find((n) => n.id === 'C')!
    const start = [{ type: 'dimensions', id: 'C', resizing: true, dimensions: { width: 600, height: 400 } }]
    expect(resizesEnded(start as NodeChange<CanvasNode>[], banded, started)).toEqual([])
    const resized = banded.map((n) => (n.id === 'C' ? { ...n, height: 500 } : n))
    const end = [{ type: 'dimensions', id: 'C', resizing: false, dimensions: { width: 600, height: 500 } }]
    const [e] = resizesEnded(end as NodeChange<CanvasNode>[], resized, started)
    const after = reflow(resized, e.id, e.prevRect)
    const sAt = (ns: CanvasNode[]) => ns.find((n) => n.id === 'S')!.position.y
    expect(sAt(after) - sAt(banded)).toBe(100) // the hand change only, not a second band
    expect(after.find((n) => n.id === 'C')!.data.cardBand).toBe(c.data.cardBand)
  })

  it('(k) a band change due during a drag is applied only after the drag ends', () => {
    const s = sim(fixture())
    s.busy = true
    spawn('C', 1)
    vi.advanceTimersByTime(5000)
    expect(s.get('C').data.cardBand).toBeUndefined()
    s.busy = false
    vi.advanceTimersByTime(300)
    expect(s.get('C').data.cardBand).toBe(GROUP_GAP + 96)
  })

  it('(l) keydowns every 2 s on the sibling below for 60 s: no move until 3 s after the last', () => {
    const s = sim(fixture())
    const sY = s.abs('S').y
    s.key('S')
    spawn('C', 1)
    for (let t = 2000; t <= 60_000; t += 2000) {
      vi.advanceTimersByTime(2000)
      expect(s.abs('S').y).toBe(sY)
      s.key('S')
    }
    vi.advanceTimersByTime(2900)
    expect(s.abs('S').y).toBe(sY)
    vi.advanceTimersByTime(200)
    expect(s.abs('S').y).toBe(sY + GROUP_GAP + 96)
  })

  it('(m) a loop card and 4 subagent cards on 2 rows, subagents cleared: the band keeps one row, the sibling is pulled back once', () => {
    const s = sim(fixture({ chatW: 1000 }))
    const sY = s.abs('S').y
    s.addLoop('C')
    spawn('C', 4)
    vi.advanceTimersByTime(1000)
    expect(s.get('C').data.cardBand).toBe(TWO_ROWS)
    useAgentNodes.getState().clearForParent('C')
    vi.advanceTimersByTime(BAND_WINDOW_MS + 1000)
    expect(s.get('C').data.cardBand).toBe(ONE_LOOP_ROW)
    expect(s.abs('S').y).toBe(sY + ONE_LOOP_ROW)
    expect(s.moves.get('S')).toBe(2)
  })

  it("(n) a frame push that would move a chat David types in waits until 3 s after the last keypress", () => {
    const s = sim(fixture({ below: true }))
    const dY = s.abs('D').y
    s.key('D')
    spawn('C', 1)
    for (let t = 0; t < 20_000; t += 2000) {
      vi.advanceTimersByTime(2000)
      expect(s.abs('D').y).toBe(dY)
      expect(s.driver.held.has('C')).toBe(true)
      s.key('D')
    }
    // Held: geometry does not report the held chat's cards (round 7, m1).
    expect(s.geometry().result.overlaps).toEqual([])
    vi.advanceTimersByTime(3100)
    expect(s.abs('D').y).toBe(dY + GROUP_GAP + 96)
    expect(s.driver.held.size).toBe(0)
  })
})
