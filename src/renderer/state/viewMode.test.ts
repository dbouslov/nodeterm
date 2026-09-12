import { describe, it, expect, beforeEach } from 'vitest'
import {
  goToNodeAction,
  parseViewMap,
  useViewMode,
  isAnyKanbanOpen,
  isKanbanOpen,
  isOverlayViewOpen,
  isOverviewOpen,
  toggleOverviewView,
  viewFor
} from './viewMode'
import { useSettings } from './settings'

describe('parseViewMap', () => {
  it('keeps canvas/kanban entries, tolerates garbage', () => {
    expect(parseViewMap(null)).toEqual({})
    expect(parseViewMap('not json')).toEqual({})
    expect(parseViewMap('[1,2]')).toEqual({})
    expect(parseViewMap(JSON.stringify({ p1: 'kanban', p2: 'canvas', p3: 42 }))).toEqual({ p1: 'kanban', p2: 'canvas' })
  })
})

describe('toggle + default', () => {
  beforeEach(() => useViewMode.setState({ viewByProject: {}, defaultView: 'canvas' }))
  it('flips a project explicitly (stores canvas/kanban, overriding the default)', () => {
    useViewMode.getState().toggle('p1')
    expect(useViewMode.getState().viewByProject.p1).toBe('kanban')
    useViewMode.getState().toggle('p1')
    expect(useViewMode.getState().viewByProject.p1).toBe('canvas') // explicit, not deleted
  })
  it('an unset project follows the default; toggling flips FROM the resolved default', () => {
    const s = useViewMode.getState()
    expect(viewFor(s, 'x')).toBe('canvas')
    expect(isKanbanOpen('x')).toBe(false)
    useViewMode.setState({ defaultView: 'kanban' })
    expect(isKanbanOpen('x')).toBe(true) // now follows the kanban default
    // toggling an unset project flips off the resolved default → explicit 'canvas'
    useViewMode.getState().toggle('x')
    expect(useViewMode.getState().viewByProject.x).toBe('canvas')
    expect(isKanbanOpen('x')).toBe(false) // explicit choice beats the kanban default
  })
})

describe('card requests (board-aware "go to node")', () => {
  it('carries a one-shot request the board consumes', () => {
    useViewMode.setState({ requestedCardNodeId: null })
    useViewMode.getState().requestCard('term-1')
    expect(useViewMode.getState().requestedCardNodeId).toBe('term-1')
    useViewMode.getState().clearCardRequest()
    expect(useViewMode.getState().requestedCardNodeId).toBeNull()
    // Re-requesting the SAME node must work — it is a fresh "go to", not a state to dedupe.
    useViewMode.getState().requestCard('term-1')
    expect(useViewMode.getState().requestedCardNodeId).toBe('term-1')
  })

  it('a view toggle drops an unconsumed request', () => {
    useViewMode.setState({ viewByProject: {}, defaultView: 'canvas', requestedCardNodeId: null })
    useViewMode.getState().toggle('p9')
    expect(isKanbanOpen('p9')).toBe(true)
    useViewMode.getState().requestCard('term-2')
    // Leaving the board: the request belonged to the view we just left; firing it later would
    // pop a card open out of nowhere.
    useViewMode.getState().toggle('p9')
    expect(isKanbanOpen('p9')).toBe(false)
    expect(useViewMode.getState().requestedCardNodeId).toBeNull()
  })
})

describe('the network overview is a third view', () => {
  beforeEach(() =>
    useViewMode.setState({ viewByProject: {}, defaultView: 'canvas', globalKanban: false, requestedCardNodeId: null })
  )

  it('parses and stores the overview view', () => {
    expect(parseViewMap(JSON.stringify({ a: 'overview', b: 'nope' }))).toEqual({ a: 'overview' })
  })

  it('toggleOverview flips overview <-> canvas, and the board toggle closes the overview', () => {
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(true)
    expect(isOverlayViewOpen('p')).toBe(true)
    expect(isKanbanOpen('p')).toBe(false)
    expect(isAnyKanbanOpen('p')).toBe(false)
    // The board toggle opens the board and closes the overview: the views are exclusive.
    useViewMode.getState().toggle('p')
    expect(isKanbanOpen('p')).toBe(true)
    expect(isAnyKanbanOpen('p')).toBe(true)
    expect(isOverviewOpen('p')).toBe(false)
    // …and the overview toggle does the inverse.
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(true)
    expect(isKanbanOpen('p')).toBe(false)
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(false)
    expect(isOverlayViewOpen('p')).toBe(false)
    expect(viewFor(useViewMode.getState(), 'p')).toBe('canvas')
  })

  it('an overview toggle drops an unconsumed card request', () => {
    useViewMode.getState().requestCard('term-3')
    useViewMode.getState().toggleOverview('p')
    expect(useViewMode.getState().requestedCardNodeId).toBeNull()
  })

  it('the overlay predicate also covers the global board, and never an empty project id', () => {
    const prev = useSettings.getState().settings
    useSettings.setState({ settings: { ...prev, omniKanbanEnabled: true } })
    try {
      useViewMode.setState({ globalKanban: true })
      expect(isOverlayViewOpen('p')).toBe(true)
      expect(isAnyKanbanOpen('p')).toBe(true)
      expect(isOverviewOpen('p')).toBe(false)
    } finally {
      useSettings.setState({ settings: prev })
    }
    expect(isOverviewOpen('')).toBe(false)
  })
})

describe('what "go to node" means under each view', () => {
  beforeEach(() =>
    useViewMode.setState({ viewByProject: {}, defaultView: 'canvas', globalKanban: false, requestedCardNodeId: null })
  )

  it('frames on the canvas, opens the card on the board, and leaves the overview before framing', () => {
    expect(goToNodeAction('p')).toBe('frame')
    useViewMode.getState().toggle('p')
    expect(goToNodeAction('p')).toBe('card')
    useViewMode.getState().toggleOverview('p')
    // Framing under the overlay would be invisible: the click would read as dead.
    expect(goToNodeAction('p')).toBe('leave-overview')
  })

  it('the global board wins over an overview left open beneath it', () => {
    // The tab's board toggle opens Omni without touching the per-project view, so a project can
    // still read 'overview' under the global board — and the board is what is on screen.
    useViewMode.getState().toggleOverview('p')
    const prev = useSettings.getState().settings
    useSettings.setState({ settings: { ...prev, omniKanbanEnabled: true } })
    try {
      useViewMode.setState({ globalKanban: true })
      expect(goToNodeAction('p')).toBe('card')
    } finally {
      useSettings.setState({ settings: prev })
    }
  })
})

describe('the overview toggle every entry point shares', () => {
  beforeEach(() =>
    useViewMode.setState({ viewByProject: {}, defaultView: 'canvas', globalKanban: false, requestedCardNodeId: null })
  )

  it('is the plain toggle when no global board is up', () => {
    toggleOverviewView('p')
    expect(isOverviewOpen('p')).toBe(true)
    toggleOverviewView('p')
    expect(isOverviewOpen('p')).toBe(false)
  })

  it('from the global board it closes the board and OPENS the overview, whatever the view beneath', () => {
    // A plain toggle with 'overview' beneath would land on the canvas: the ⤢ doing the opposite.
    const prev = useSettings.getState().settings
    useSettings.setState({ settings: { ...prev, omniKanbanEnabled: true } })
    try {
      for (const beneath of ['canvas', 'overview'] as const) {
        useViewMode.setState({ viewByProject: { p: beneath }, globalKanban: true })
        toggleOverviewView('p')
        expect(useViewMode.getState().globalKanban).toBe(false)
        expect(isOverviewOpen('p')).toBe(true)
      }
    } finally {
      useSettings.setState({ settings: prev })
    }
  })
})
