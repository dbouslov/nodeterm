// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from '@xyflow/react'
import { OverviewExpandButton } from './OverviewExpandButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function mount(count: number, onOpen = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root!.render(
      <ReactFlowProvider>
        <OverviewExpandButton count={count} onOpen={onOpen} />
      </ReactFlowProvider>
    )
  )
  return { host, onOpen }
}

describe('OverviewExpandButton', () => {
  it('opens the overview, and shows no badge at zero findings', () => {
    const { host, onOpen } = mount(0)
    const button = host.querySelector<HTMLButtonElement>('button.minimap-expand')!
    expect(button.getAttribute('aria-label')).toBe('Network overview')
    expect(host.querySelector('.minimap-expand__badge')).toBeNull()
    act(() => button.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the findings count as a badge', () => {
    const { host } = mount(3)
    expect(host.querySelector('.minimap-expand__badge')!.textContent).toBe('3')
  })
})
