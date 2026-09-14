/**
 * Let go of a `<webview>`'s keyboard focus when nodeterm's window loses OS focus (Fix #16).
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
 * The signal is MAIN's window blur (`onWindowBlur`), not the page's own `blur`: the page's window
 * blurs the moment focus moves INTO a guest (a child browsing context), so releasing on that would
 * make every web page untypeable. The cost: back in nodeterm, a page is no longer focused until it
 * is clicked.
 */
export function releaseWebviewFocus(doc: Pick<Document, 'activeElement'>): boolean {
  const el = doc.activeElement as HTMLElement | null
  if (!el || el.tagName !== 'WEBVIEW') return false
  el.blur()
  return true
}

/** Subscribes `releaseWebviewFocus` to the window-blur event; returns the unsubscribe. */
export function installWebviewFocusRelease(
  onWindowBlur: (listener: () => void) => () => void,
  doc: Pick<Document, 'activeElement'> = document
): () => void {
  return onWindowBlur(() => {
    releaseWebviewFocus(doc)
  })
}
