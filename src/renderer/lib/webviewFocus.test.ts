// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installWebviewFocusRelease, releaseWebviewFocus } from './webviewFocus'

/**
 * REAL DOM (jsdom): the whole question is what `document.activeElement` is after the call. The
 * `<webview>` here is an unknown element made focusable with `tabindex`, which is all this module
 * reads — its tag and whether it holds focus.
 */
function mount(tag: string): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('tabindex', '0')
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('releaseWebviewFocus', () => {
  it('takes keyboard focus away from a focused <webview>', () => {
    const wv = mount('webview')
    wv.focus()
    expect(document.activeElement).toBe(wv)
    expect(releaseWebviewFocus(document)).toBe(true)
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves every other focused element alone — a terminal keeps its focus', () => {
    const ta = mount('textarea')
    ta.focus()
    expect(releaseWebviewFocus(document)).toBe(false)
    expect(document.activeElement).toBe(ta)
  })

  it('does nothing when nothing is focused', () => {
    mount('webview')
    expect(releaseWebviewFocus(document)).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('installWebviewFocusRelease', () => {
  it('releases a focused <webview> every time the window loses OS focus, until unsubscribed', () => {
    const hook: { fire?: () => void; unsubscribed?: boolean } = {}
    const unsubscribe = installWebviewFocusRelease((listener) => {
      hook.fire = listener
      return () => {
        hook.unsubscribed = true
      }
    }, document)
    const wv = mount('webview')
    wv.focus()
    hook.fire?.()
    expect(document.activeElement).toBe(document.body)
    // The next reload of a page the user clicked into again is covered too.
    wv.focus()
    hook.fire?.()
    expect(document.activeElement).toBe(document.body)
    unsubscribe()
    expect(hook.unsubscribed).toBe(true)
  })
})
