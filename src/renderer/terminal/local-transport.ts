import type { NodeTerminalApi, PtyCreateOptions, PtyCreateResult, RecycledInfo } from '@shared/types'
import type { ClientId } from '@shared/presence'
import type { TerminalTransport } from './transport'
import { forgetAgentReadiness, markAgentEnded } from '../lib/agentHookSeen'

/**
 * Local transport: binds a core's api (`api.pty`) to the TerminalTransport interface.
 * The api is injected — for the local session it IS `window.nodeTerminal` (the preload
 * IPC surface; all real work happens in node-pty in the main process), so behavior is
 * identical to the pre-injection global reads.
 */
export class LocalTransport implements TerminalTransport {
  /**
   * `injectedApi` — lazy `window.nodeTerminal` fallback (not an eager default parameter): the
   * module-scope `transport` singleton below is constructed at import time, and under node (vitest,
   * no jsdom) `window` doesn't exist yet — it must only be touched on first use.
   *
   * `viewerId` — which VIEW of a session this transport instance drives. The canvas node's
   * transport omits it (the PRIMARY view = today's exact behavior); the kanban card modal
   * constructs its own `LocalTransport(api, 'modal-<nodeId>')`, so its create/resize/setFlow/kill
   * co-attach and detach as an independent subscriber of the SAME session, without disturbing the
   * canvas node's client. The `TerminalTransport` method signatures are unchanged — the viewer is
   * baked into the instance, not threaded through every call site.
   */
  constructor(
    private readonly injectedApi?: NodeTerminalApi,
    private readonly viewerId?: string
  ) {}

  private get api(): NodeTerminalApi {
    return this.injectedApi ?? window.nodeTerminal
  }

  private get pty() {
    return this.api.pty
  }

  create(options: PtyCreateOptions): Promise<PtyCreateResult> {
    // Append the viewer only when this instance has one, so a PRIMARY transport's options object is
    // untouched (an explicit `viewerId: undefined` would still be PRIMARY, but keeping it absent is
    // bit-for-bit the pre-viewer create).
    const created = this.pty.create(this.viewerId ? { ...options, viewerId: this.viewerId } : options)
    // A fresh tmux session holds no CLI that has proven it reads input (issue #39,
    // lib/agentHookSeen). Every spawn passes here, the #38 background start included.
    return created.then((r) => {
      if (r.fresh && options.persistKey) markAgentEnded(options.persistKey)
      return r
    })
  }

  write(sessionId: string, data: string): void {
    this.pty.write(sessionId, data)
  }

  resize(sessionId: string, cols: number | null, rows: number | null): void {
    this.pty.resize(sessionId, cols, rows, this.viewerId)
  }

  setFlow(sessionId: string, resume: boolean): void {
    this.pty.setFlow(sessionId, resume, this.viewerId)
  }

  kill(sessionId: string): void {
    this.pty.kill(sessionId, this.viewerId)
  }

  destroy(persistKey: string, opts?: { everySocket?: boolean }): void {
    forgetAgentReadiness(persistKey)
    this.pty.destroy(persistKey, opts)
  }

  recycle(persistKey: string): void {
    // The session is replaced, and so is whatever CLI it held: a typed `/rename` must wait for
    // the next one to report in (issue #39, lib/agentHookSeen).
    markAgentEnded(persistKey)
    this.pty.recycle(persistKey)
  }

  onData(sessionId: string, listener: (data: string) => void): () => void {
    return this.pty.onData(sessionId, listener)
  }

  onExit(sessionId: string, listener: (exitCode: number) => void): () => void {
    return this.pty.onExit(sessionId, listener)
  }

  onSize(sessionId: string, listener: (size: { cols: number; rows: number }) => void): () => void {
    return this.pty.onSize(sessionId, listener)
  }

  onClosed(sessionId: string, listener: (info: { by: ClientId | null }) => void): () => void {
    return this.pty.onClosed(sessionId, listener)
  }

  onRecycled(sessionId: string, listener: (info: RecycledInfo) => void): () => void {
    return this.pty.onRecycled(sessionId, listener)
  }

  onResync(sessionId: string, listener: (screen: string) => void): () => void {
    return this.pty.onResync(sessionId, listener)
  }
}

/** The single transport instance used by the app. Becomes selectable later. */
export const transport: TerminalTransport = new LocalTransport()
