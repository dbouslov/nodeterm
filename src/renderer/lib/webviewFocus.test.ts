// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installWebviewFocusKeeper,
  releaseWebviewFocus,
  type WebviewFocusKeeperOptions
} from './webviewFocus'

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
    expect(releaseWebviewFocus(document)).toBe(wv)
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves every other focused element alone — a terminal keeps its focus', () => {
    const ta = mount('textarea')
    ta.focus()
    expect(releaseWebviewFocus(document)).toBeNull()
    expect(document.activeElement).toBe(ta)
  })

  it('does nothing when nothing is focused', () => {
    mount('webview')
    expect(releaseWebviewFocus(document)).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })
})

/** Main's two window signals, fired by hand. */
function install(opts: Partial<WebviewFocusKeeperOptions> = {}) {
  const fire: { blur?: () => void; focus?: () => void } = {}
  let unsubscribed = 0
  const onNotGivenBack = vi.fn()
  const keeper = installWebviewFocusKeeper(
    {
      onWindowBlur: (listener) => {
        fire.blur = listener
        return () => unsubscribed++
      },
      onWindowFocus: (listener) => {
        fire.focus = listener
        return () => unsubscribed++
      }
    },
    { mayGiveBack: () => true, onNotGivenBack, ...opts },
    document
  )
  return {
    keeper,
    onNotGivenBack,
    windowBlur: () => fire.blur?.(),
    windowFocus: () => fire.focus?.(),
    unsubscribed: () => unsubscribed
  }
}

describe('installWebviewFocusKeeper', () => {
  it('releases a focused page when the window loses OS focus and gives it back when it returns', () => {
    const { keeper, onNotGivenBack, windowBlur, windowFocus } = install()
    const wv = mount('webview')
    wv.focus()
    windowBlur()
    expect(document.activeElement).toBe(document.body)
    expect(keeper.holding()).toBe(true)
    windowFocus()
    expect(document.activeElement).toBe(wv)
    expect(keeper.holding()).toBe(false)
    // Every round trip, not just the first.
    windowBlur()
    expect(document.activeElement).toBe(document.body)
    windowFocus()
    expect(document.activeElement).toBe(wv)
    expect(onNotGivenBack).not.toHaveBeenCalled()
  })

  it("gives the page back only on main's window focus, never while the window is in the background", () => {
    // Measured (Electron 42.10.1): the release hands the host document focus while the app is
    // still in the background, so the page's own window `focus` fires right then. Focusing the
    // guest there would be the very activation this module exists to stop.
    const { keeper, windowBlur } = install()
    const wv = mount('webview')
    wv.focus()
    windowBlur()
    window.dispatchEvent(new Event('focus'))
    expect(document.activeElement).toBe(document.body)
    expect(keeper.holding()).toBe(true)
  })

  it('leaves the keyboard with whatever took it while the window was away', () => {
    // A pointer resting on a terminal before the click that brings the window back: the hover
    // dwell focuses that terminal, and the user's pick wins over the page.
    const { onNotGivenBack, windowBlur, windowFocus } = install()
    const wv = mount('webview')
    const term = mount('textarea')
    wv.focus()
    windowBlur()
    term.focus()
    windowFocus()
    expect(document.activeElement).toBe(term)
    expect(onNotGivenBack).toHaveBeenCalledTimes(1)
  })

  it('does not give the keyboard to a page that left the document while the window was away', () => {
    const { keeper, onNotGivenBack, windowBlur, windowFocus } = install()
    const wv = mount('webview')
    wv.focus()
    windowBlur()
    wv.remove()
    expect(keeper.holding()).toBe(false)
    windowFocus()
    expect(document.activeElement).toBe(document.body)
    expect(onNotGivenBack).toHaveBeenCalledTimes(1)
  })

  it('does not give the keyboard back while a modal, the board or the settings page is up', () => {
    const { onNotGivenBack, windowBlur, windowFocus } = install({ mayGiveBack: () => false })
    const wv = mount('webview')
    wv.focus()
    windowBlur()
    windowFocus()
    expect(document.activeElement).toBe(document.body)
    expect(onNotGivenBack).toHaveBeenCalledTimes(1)
  })

  it('reports a page that would not take focus as not given back', () => {
    // A keep-alive ghost is `display:none`, and focus() on an element that is not rendered does
    // nothing. Here: an unknown element without `tabindex`, which jsdom will not focus either.
    const { onNotGivenBack, windowBlur, windowFocus } = install()
    const wv = mount('webview')
    wv.focus()
    windowBlur()
    wv.removeAttribute('tabindex')
    windowFocus()
    expect(document.activeElement).toBe(document.body)
    expect(onNotGivenBack).toHaveBeenCalledTimes(1)
  })

  it('leaves an ordinary return alone when no page was released', () => {
    const { keeper, onNotGivenBack, windowBlur, windowFocus } = install()
    const term = mount('textarea')
    term.focus()
    windowBlur()
    expect(document.activeElement).toBe(term)
    expect(keeper.holding()).toBe(false)
    windowFocus()
    expect(document.activeElement).toBe(term)
    expect(onNotGivenBack).not.toHaveBeenCalled()
  })

  it('unsubscribes from both window signals on dispose', () => {
    const { keeper, unsubscribed } = install()
    keeper.dispose()
    expect(unsubscribed()).toBe(2)
  })
})
