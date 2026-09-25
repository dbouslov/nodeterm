// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ReactFlowProvider, type Edge, type Node } from '@xyflow/react'
import { EdgeHoverCard, EdgeHoverCardView } from './EdgeHoverCard'
import { SHOW_DELAY_MS, useEdgeHoverCard } from './edgeHoverCardModel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren() })

function mount(el: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}

describe('EdgeHoverCardView', () => {
  it('shows title, status and summary, offset from the pointer', () => {
    const host = mount(
      <EdgeHoverCardView
        info={{ nodeId: 'n1', title: 'Builder', status: 'waiting', summary: 'Fixing login' }}
        x={100}
        y={50}
        onJump={() => {}}
        onEnter={() => {}}
        onLeave={() => {}}
      />
    )
    const card = host.querySelector<HTMLElement>('.edge-hover-card')!
    expect(card.querySelector('.edge-hover-card__title')!.textContent).toBe('Builder')
    expect(card.querySelector('.edge-hover-card__status--waiting')!.textContent).toBe('Waiting')
    expect(card.querySelector('.edge-hover-card__summary')!.textContent).toBe('Fixing login')
    // Never on the pointer itself, so the link under it stays clickable/draggable.
    expect(parseFloat(card.style.left)).toBeGreaterThan(100)
    expect(parseFloat(card.style.top)).toBeGreaterThan(50)
  })

  it('omits status and summary it does not have', () => {
    const host = mount(
      <EdgeHoverCardView info={{ nodeId: 'n1', title: 'n1' }} x={0} y={0} onJump={() => {}} onEnter={() => {}} onLeave={() => {}} />
    )
    expect(host.querySelector('.edge-hover-card__status')).toBeNull()
    expect(host.querySelector('.edge-hover-card__summary')).toBeNull()
  })

  it('clicking the card jumps to its node', () => {
    const onJump = vi.fn()
    const host = mount(
      <EdgeHoverCardView info={{ nodeId: 'n7', title: 'X' }} x={0} y={0} onJump={onJump} onEnter={() => {}} onLeave={() => {}} />
    )
    act(() => host.querySelector<HTMLElement>('.edge-hover-card')!.click())
    expect(onJump).toHaveBeenCalledExactlyOnceWith('n7')
  })
})

describe('EdgeHoverCard', () => {
  const nodes: Node[] = [
    { id: 'a', position: { x: 0, y: 0 }, data: { title: 'Alpha' } },
    { id: 'b', position: { x: 500, y: 0 }, data: { title: 'Beta' } }
  ]
  const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
  afterEach(() => {
    act(() => useEdgeHoverCard.getState().dismiss())
    vi.useRealTimers()
  })

  function show(edgeId: string) {
    vi.useFakeTimers()
    const host = mount(
      <ReactFlowProvider initialNodes={nodes} initialEdges={edges}>
        <EdgeHoverCard onJump={() => {}} />
      </ReactFlowProvider>
    )
    act(() => {
      useEdgeHoverCard.getState().hover({ edgeId, nodeId: 'b', x: 10, y: 10 })
      vi.advanceTimersByTime(SHOW_DELAY_MS)
    })
    return host
  }

  it('shows the far node of a live link', () => {
    show('e1')
    expect(document.querySelector('.edge-hover-card__title')?.textContent).toBe('Beta')
  })

  it('shows nothing once its link is gone (a removed link fires no mouseleave)', () => {
    show('removed')
    expect(document.querySelector('.edge-hover-card')).toBeNull()
  })
})
