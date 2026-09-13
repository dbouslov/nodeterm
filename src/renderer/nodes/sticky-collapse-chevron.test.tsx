// @vitest-environment jsdom
// The header chevron toggles the FRESH node in the store, not the `data` it was rendered with: two
// clicks go down to the title bar and back up to the exact height. Pins the chevron's wiring to
// `setCollapsed`; what the helper itself does is pinned in state/workspace.collapse.test.ts.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ReactFlowProvider, useNodes, type NodeProps } from '@xyflow/react'
import { StickyNode } from './StickyNode'
import { COLLAPSED_HEIGHT, type CanvasNode } from '../state/workspace'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

it('the sticky chevron minimizes, then restores the exact height', () => {
  const start = {
    id: 's1',
    type: 'sticky',
    position: { x: 0, y: 0 },
    width: 240,
    height: 260,
    style: { width: 240, height: 260 },
    data: { title: 'Note', color: '#ffd60a', group: null, text: '' }
  } as CanvasNode
  let seen: CanvasNode[] = []
  function Probe(): null {
    seen = useNodes() as CanvasNode[]
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
  }
  act(() =>
    root.render(
      <ReactFlowProvider defaultNodes={[start]}>
        <StickyNode {...({ id: 's1', data: start.data, selected: false } as unknown as NodeProps<CanvasNode>)} />
        <Probe />
      </ReactFlowProvider>
    )
  )
  const chevron = host.querySelector<HTMLButtonElement>('button[aria-label="Collapse"]')!

  act(() => chevron.click())
  expect(seen[0].height).toBe(COLLAPSED_HEIGHT)
  expect(seen[0].data.collapsed).toBe(true)

  act(() => chevron.click())
  expect(seen[0].height).toBe(260)
  expect(seen[0].data.collapsed).toBe(false)
})
