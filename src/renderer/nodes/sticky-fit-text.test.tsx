// @vitest-environment jsdom
// A note fits its RENDERED text: a fit request lays out the hidden copy of its body and the note
// takes header + copy + borders as its height, read off the DOM. A hand edit fits only when it
// changed the text. The height math and the reflow are pinned in lib/stickyFit.test.ts; this pins
// the wiring from the DOM measurement to the store. jsdom has no layout, so the sizes are stubbed.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ReactFlowProvider, useNodes, type NodeProps } from '@xyflow/react'
import { StickyNode } from './StickyNode'
import { requestStickyFit } from '../lib/stickyFit'
import { registerWorkspaceDirty } from '../state/workspaceDirty'
import type { CanvasNode } from '../state/workspace'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HEADER = 30
const CONTENT = 400
const restore: (() => void)[] = []
function stub(prop: 'offsetHeight' | 'clientHeight' | 'clientWidth', value: (el: HTMLElement) => number): void {
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      return value(this)
    }
  })
  restore.push(() => (was ? Object.defineProperty(HTMLElement.prototype, prop, was) : undefined))
}
beforeEach(() => {
  const is = (el: HTMLElement, c: string): boolean => el.classList.contains(c)
  stub('offsetHeight', (el) =>
    is(el, 'sticky-node__header') ? HEADER : is(el, 'sticky-node__measure') ? CONTENT : is(el, 'sticky-node') ? 262 : 0
  )
  stub('clientHeight', (el) => (is(el, 'sticky-node') ? 260 : 0))
  stub('clientWidth', (el) => (is(el, 'sticky-node') ? 238 : 0))
  const raf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    cb(0)
    return 1
  }
  restore.push(() => (globalThis.requestAnimationFrame = raf))
})

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
  while (restore.length) restore.pop()!()
})

function mount(id: string, text: string): () => CanvasNode[] {
  const start = {
    id,
    type: 'sticky',
    position: { x: 0, y: 0 },
    width: 240,
    height: 260,
    style: { width: 240, height: 260 },
    data: { title: 'Note', color: '#ffd60a', group: null, text }
  } as CanvasNode
  let seen: CanvasNode[] = []
  function Probe(): null {
    seen = useNodes() as CanvasNode[]
    return null
  }
  // The node re-renders with the store's data, as React Flow does for a real node.
  function Live(): JSX.Element {
    const nodes = useNodes() as CanvasNode[]
    const n = nodes.find((x) => x.id === id) ?? start
    return <StickyNode {...({ id, data: n.data, selected: false } as unknown as NodeProps<CanvasNode>)} />
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
        <Live />
        <Probe />
      </ReactFlowProvider>
    )
  )
  return () => seen
}

it('a fit request sets the height to header + rendered text + borders, width kept', () => {
  const seen = mount('fit-1', '# a long note')
  expect(seen()[0].height).toBe(260)
  let dirty = 0
  const off = registerWorkspaceDirty(() => dirty++)
  act(() => {
    requestStickyFit('fit-1')
  })
  off()
  expect(seen()[0].height).toBe(HEADER + CONTENT + 2)
  expect(seen()[0].width).toBe(240)
  // Saved: a collapsed note's fit changes only data, which no dimensions change would report.
  expect(dirty).toBe(1)
})

it('finishing a hand edit fits the note only when the text changed', () => {
  const seen = mount('fit-2', 'before')
  const host = document.body
  const edit = (value?: string): void => {
    act(() => host.querySelector<HTMLElement>('.sticky-node__view:not(.sticky-node__measure *)')!.click())
    const area = host.querySelector<HTMLTextAreaElement>('textarea.sticky-node__body')!
    if (value !== undefined) {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => {
        set.call(area, value)
        area.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    act(() => {
      area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }
  edit()
  expect(seen()[0].height).toBe(260)
  edit('after, and much longer')
  expect(seen()[0].height).toBe(HEADER + CONTENT + 2)
})
