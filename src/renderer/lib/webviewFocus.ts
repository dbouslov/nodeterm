/**
 * Keep a `<webview>`'s keyboard focus across the time nodeterm's window spends in the background
 * (Fix #16): let go of it when the window loses OS focus, give it back when the window returns.
 *
 * On macOS, Electron activates the whole app when a `<webview>` guest takes focus, even while the
 * app is in the background. Measured on Electron 42.10.1: a focused guest whose page reloads, or
 * the embedder focusing a webview, brought a BACKGROUND app to the front; the same page with its
 * focus released first did not. A web node the user once clicked into whose page reloads by itself
 * (the orchestrator dashboards carry `<meta http-equiv="refresh" content="30">`) therefore pulled
 * nodeterm in front of whatever the user had switched to, on every reload. With no focused guest
 * while the window is in the background, a reload — or a ghost page coming back on screen — has no
 * focus to take again.
 *
 * The signals are MAIN's window blur and focus (`onWindowBlur` / `onWindowFocus`), not the page's
 * own. The page's window blurs the moment focus moves INTO a guest (a child browsing context), so
 * releasing on that would make every web page untypeable. And the release itself hands the host
 * document focus while the app is still in the background, so the page's own window `focus` fires
 * right then (measured; `document.hasFocus()` is true there too): giving the guest focus back on it
 * would be the activation this module exists to stop. Main's blur also fires when a sheet or
 * DevTools takes the key window; releasing then is harmless.
 *
 * Without the give-back, coming back left the page without focus and the app's focus restore
 * (`nodeToRefocus`) handed the keyboard to the last terminal: typing meant for the page, or a
 * password manager's autotype (username, Tab, password, Enter), landed in a terminal pane. So the
 * give-back runs synchronously in main's focus listener, the earliest moment the app is known to be
 * active again. Measured in a rig on 42.10.1, from the page's main world: the caret is back in the
 * page's field, with no further blur or activation. (`focus()` on a `<webview>` from an isolated
 * world does nothing.)
 */

/** Blur a focused `<webview>`. Returns it, or `null` when focus was anywhere else. */
export function releaseWebviewFocus(doc: Pick<Document, 'activeElement'>): HTMLElement | null {
  const el = doc.activeElement as HTMLElement | null
  if (!el || el.tagName !== 'WEBVIEW') return null
  el.blur()
  return el
}

/** Main's window signals, as `window.nodeTerminal` carries them. */
export interface WindowFocusSignals {
  onWindowBlur(listener: () => void): () => void
  onWindowFocus(listener: () => void): () => void
}

export interface WebviewFocusKeeperOptions {
  /** Nothing else may own the keyboard now: no modal, board or settings page (the refusals the
   *  terminal restore makes too). Asked only on return. */
  mayGiveBack: () => boolean
  /** A page was held and did not get the keyboard back: run the terminal restore it held off. */
  onNotGivenBack: () => void
}

export interface WebviewFocusKeeper {
  /** A page released on the window's blur is still in the document and waits for the window to
   *  come back. The terminal restore stands down meanwhile (`FocusRestoreState.webPageHeld`). */
  holding(): boolean
  /** Unsubscribe from both signals. */
  dispose(): void
}

export function installWebviewFocusKeeper(
  signals: WindowFocusSignals,
  opts: WebviewFocusKeeperOptions,
  doc: Pick<Document, 'activeElement' | 'body'> = document
): WebviewFocusKeeper {
  let held: HTMLElement | null = null
  const offBlur = signals.onWindowBlur(() => {
    held = releaseWebviewFocus(doc)
  })
  const offFocus = signals.onWindowFocus(() => {
    const page = held
    held = null
    if (!page) return
    // Whatever took the keyboard while the window was away keeps it: a terminal the hover dwell
    // focused under the pointer before the click that brought the window back, a dialog's button.
    const untouched = !doc.activeElement || doc.activeElement === doc.body
    if (untouched && opts.mayGiveBack()) page.focus()
    // Checked, not assumed: focus() does nothing on a page that left the document, or on a
    // keep-alive ghost (`display:none`).
    if (doc.activeElement !== page) opts.onNotGivenBack()
  })
  return {
    holding: () => held !== null && held.isConnected,
    dispose: () => {
      offBlur()
      offFocus()
    }
  }
}
