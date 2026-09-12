// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EdgeLegendBody, LEGEND_ROWS } from './EdgeLegend'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren() })

function mount(open: boolean) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<EdgeLegendBody open={open} onToggle={() => {}} />))
  return host
}

describe('EdgeLegendBody', () => {
  it('collapsed: one chip reading Legend, no rows', () => {
    const host = mount(false)
    expect(host.textContent).toBe('Legend')
    expect(host.querySelectorAll('.edge-legend-row')).toHaveLength(0)
  })
  it('expanded: the five live kinds plus waiting and selected, each with a sample stroke', () => {
    const host = mount(true)
    const rows = host.querySelectorAll('.edge-legend-row')
    expect(rows).toHaveLength(7)
    expect(LEGEND_ROWS.map((r) => r.label)).toEqual(['Context', 'Rope', 'Waiting', 'Note', 'Subagent / loop', 'Trigger', 'Selected'])
    expect(host.querySelectorAll('.edge-legend-row svg path')).toHaveLength(7)
  })
})
