// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasNodeState } from '@shared/types'
import type { OverviewInput } from '../../lib/networkOverview'
import { CommandPalette } from '../CommandPalette'
import { ConfirmDialog } from '../ConfirmDialog'
import { NetworkOverviewView } from './NetworkOverviewView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  title: id,
  color: '#888',
  group: null,
  ...extra
})

const input: OverviewInput = {
  nodes: [
    node('g', { kind: 'group', title: 'Wave 1' }),
    node('hub', { agentId: 'claude', parentId: 'g', annotation: { role: 'lead', by: 'hub', at: 1 } }),
    node('a', { agentId: 'claude', parentId: 'g', annotation: { recommend: 'close a', by: 'hub', at: 2 } })
  ],
  bridges: [{ id: 'l', source: 'hub', target: 'a' }],
  ropes: [],
  statusById: { a: { unread: false, state: 'done', lastEventAt: 0 } },
  launchById: {},
  idleMs: 30 * 60_000,
  now: 60 * 60_000
}

let root: Root | null = null
beforeAll(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function mount(onClose = vi.fn(), onGoToNode = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  // `over` is something Canvas opens ABOVE the overview later (the palette, a ConfirmDialog): same
  // tree, mounted after it, portalled to <body> by the component itself.
  const render = (over: ReactNode = null) =>
    act(() =>
      root!.render(
        <>
          <NetworkOverviewView
            projectId="research"
            projectName="Research"
            projectColor="#0a84ff"
            input={input}
            onClose={onClose}
            onGoToNode={onGoToNode}
          />
          {over}
        </>
      )
    )
  render()
  return { host, onClose, onGoToNode, openOver: render }
}

/** A real keypress goes where focus is. */
function pressEscape() {
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

describe('NetworkOverviewView', () => {
  it('renders the header, the cards and the findings, and a finding row jumps to its node', () => {
    const { host, onClose, onGoToNode } = mount()
    expect(host.querySelector('.overview-header__name')!.textContent).toBe('Research')
    // The card carries the agent-written role; the sidebar lists the recommendation, then the flag.
    expect(host.querySelector('[data-node-id="hub"] .ov-node__role')!.textContent).toBe('lead')
    expect(host.querySelector('[data-node-id="a"] .ov-node__role')!.textContent).toBe('no role')
    const rows = [...host.querySelectorAll<HTMLButtonElement>('.overview-finding')]
    expect(rows.map((r) => r.querySelector('.overview-finding__text')!.textContent)).toEqual([
      'close a',
      'a idle for 1h'
    ])
    act(() => rows[0].click())
    expect(onGoToNode).toHaveBeenCalledWith('a')
    act(() => host.querySelector<HTMLButtonElement>('.overview-header__close')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a card click jumps to that node, and Escape closes once', () => {
    const { host, onClose, onGoToNode } = mount()
    act(() => host.querySelector<HTMLElement>('[data-node-id="hub"]')!.click())
    expect(onGoToNode).toHaveBeenCalledWith('hub')
    expect(host.querySelector('.overview-overlay')!.contains(document.activeElement)).toBe(true)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('takes the keyboard off the canvas when it opens, so Escape reaches it and not a terminal', () => {
    // xterm's helper textarea stands in for a terminal left focused under the overlay: xterm would
    // send ESC to the agent CLI and cancel the event, and the overview would never see it.
    const pane = document.createElement('textarea')
    document.body.appendChild(pane)
    pane.focus()
    expect(document.activeElement).toBe(pane)
    const { host } = mount()
    expect(host.querySelector('.overview-overlay')!.contains(document.activeElement)).toBe(true)
  })

  it('an Escape something else already handled does not close it', () => {
    const { host, onClose } = mount()
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      e.preventDefault()
      host.querySelector('.overview-overlay')!.dispatchEvent(e)
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  // Spec §5: Escape closes the overview only when it is the top layer. One Escape must not close
  // both the thing above it and the overview.
  it('an Escape in the ⌘K palette over it closes only the palette', () => {
    const { onClose, openOver } = mount()
    const closePalette = vi.fn()
    openOver(<CommandPalette commands={[]} onClose={closePalette} />)
    expect(document.activeElement!.classList.contains('palette__input')).toBe(true)
    pressEscape()
    expect(closePalette).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('an Escape in a ConfirmDialog over it closes only the dialog', () => {
    const { onClose, openOver } = mount()
    const cancel = vi.fn()
    openOver(<ConfirmDialog message="Delete it?" onConfirm={vi.fn()} onCancel={cancel} />)
    expect(document.querySelector('.confirm')!.contains(document.activeElement)).toBe(true)
    pressEscape()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('once the palette over it is gone, the next Escape closes the overview once', () => {
    // ⌘K, Esc, Esc. The palette unmounts with focus inside it, so focus falls to <body>, outside
    // the overlay; the overview is the top layer again and must still hear Escape.
    const { onClose, openOver } = mount()
    const closePalette = vi.fn()
    openOver(<CommandPalette commands={[]} onClose={closePalette} />)
    pressEscape()
    expect(closePalette).toHaveBeenCalledTimes(1)
    openOver(null)
    expect(document.activeElement).toBe(document.body)
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Spec §3: fitView on mount AND on project change. React Flow's `fitView` prop fits once per
  // mount, so a project switch under an open overview kept the previous project's framing. jsdom
  // cannot measure nodes, so no fit is observable here: the switch must bring a fresh React Flow
  // (which fits on mount), and a same-project update must not (it would reset the user's pan and
  // zoom on every status event).
  it('gives the graph a fresh React Flow, so a fresh fit, only when the project changes', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const show = (projectId: string, nodes: CanvasNodeState[]) =>
      act(() =>
        root!.render(
          <NetworkOverviewView
            projectId={projectId}
            projectName={projectId}
            projectColor="#0a84ff"
            input={{ ...input, nodes, bridges: [], statusById: {} }}
            onClose={vi.fn()}
            onGoToNode={vi.fn()}
          />
        )
      )
    const flow = () => host.querySelector('.react-flow')

    root = createRoot(host)
    show('a', input.nodes)
    const first = flow()
    expect(first).not.toBeNull()
    show('a', [...input.nodes, node('late')])
    expect(flow()).toBe(first)
    // A card the keyboard reached (React Flow nodes are tabbable) goes with the old React Flow, so
    // focus would fall to <body>: the overlay takes it back.
    const card = host.querySelector<HTMLElement>('.react-flow__node')!
    card.focus()
    expect(document.activeElement).toBe(card)
    show('b', [node('other')])
    expect(flow()).not.toBeNull()
    expect(flow()).not.toBe(first)
    expect(document.activeElement).toBe(host.querySelector('.overview-overlay'))
  })
})
