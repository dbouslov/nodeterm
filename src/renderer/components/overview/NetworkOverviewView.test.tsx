// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasNodeState } from '@shared/types'
import type { OverviewInput } from '../../lib/networkOverview'
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
  act(() =>
    root!.render(
      <NetworkOverviewView
        projectName="Research"
        projectColor="#0a84ff"
        input={input}
        onClose={onClose}
        onGoToNode={onGoToNode}
      />
    )
  )
  return { host, onClose, onGoToNode }
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
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape something else already handled does not close it', () => {
    const { onClose } = mount()
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      e.preventDefault()
      window.dispatchEvent(e)
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})
