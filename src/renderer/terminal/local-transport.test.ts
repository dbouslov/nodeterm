import { describe, it, expect, vi } from 'vitest'
import type { NodeTerminalApi } from '@shared/types'
import { LocalTransport } from './local-transport'
import { agentReadiness, markAgentHookSeen } from '../lib/agentHookSeen'

describe('LocalTransport injected api', () => {
  it('delegates to the injected api, not the global', () => {
    const create = vi.fn(async () => ({ sessionId: 's', fresh: true }) as never)
    const api = {
      pty: {
        create,
        write: vi.fn(),
        resize: vi.fn(),
        setFlow: vi.fn(),
        kill: vi.fn(),
        destroy: vi.fn(),
        recycle: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        onSize: vi.fn(),
        onClosed: vi.fn(),
        onRecycled: vi.fn(),
        onResync: vi.fn()
      }
    } as unknown as NodeTerminalApi
    const t = new LocalTransport(api)
    void t.create({ persistKey: 'k' } as never)
    expect(create).toHaveBeenCalledWith({ persistKey: 'k' })
  })
})

describe('LocalTransport co-attach members', () => {
  it('subscribes to the authoritative size, the closed-by-peer event and the redraw', () => {
    const unsubSize = vi.fn()
    const unsubClosed = vi.fn()
    const unsubResync = vi.fn()
    const onSize = vi.fn(() => unsubSize)
    const onClosed = vi.fn(() => unsubClosed)
    const onResync = vi.fn(() => unsubResync)
    // @ts-expect-error — minimal window shim for the three members under test
    globalThis.window = { nodeTerminal: { pty: { onSize, onClosed, onResync } } }
    const t = new LocalTransport()
    const sizeCb = (): void => {}
    const closedCb = (): void => {}
    const resyncCb = (): void => {}
    const offSize = t.onSize?.('pty-1', sizeCb)
    const offClosed = t.onClosed?.('pty-1', closedCb)
    const offResync = t.onResync?.('pty-1', resyncCb)
    expect(onSize).toHaveBeenCalledWith('pty-1', sizeCb)
    expect(onClosed).toHaveBeenCalledWith('pty-1', closedCb)
    expect(onResync).toHaveBeenCalledWith('pty-1', resyncCb)

    // Every subscription must hand back a working unsubscribe: a terminal node mounts and
    // unmounts constantly (project switches), so a dropped unsubscribe is a leak per mount.
    offSize?.()
    offClosed?.()
    offResync?.()
    expect(unsubSize).toHaveBeenCalledTimes(1)
    expect(unsubClosed).toHaveBeenCalledTimes(1)
    expect(unsubResync).toHaveBeenCalledTimes(1)
  })
})

describe('LocalTransport.recycle — the replaced session holds a CLI that has not proven itself (#39)', () => {
  it('marks the node ended, so a typed /rename waits for the next CLI to report in', () => {
    const recycle = vi.fn()
    const t = new LocalTransport({ pty: { recycle } } as unknown as NodeTerminalApi)
    markAgentHookSeen('rk')
    t.recycle('rk')
    expect(recycle).toHaveBeenCalledWith('rk')
    expect(agentReadiness('rk')).toBe('ended')
  })
})

describe('LocalTransport.create / destroy — readiness bookkeeping (#39)', () => {
  const make = (fresh: boolean) => {
    const destroy = vi.fn()
    const t = new LocalTransport({
      pty: { create: async () => ({ sessionId: 's', fresh }), destroy }
    } as unknown as NodeTerminalApi)
    return { t, destroy }
  }

  it('a FRESH create marks the node ended — a new session holds no CLI that has reported in', async () => {
    markAgentHookSeen('lc1')
    await make(true).t.create({ persistKey: 'lc1' } as never)
    expect(agentReadiness('lc1')).toBe('ended')
  })

  it('a warm reattach leaves it alone', async () => {
    markAgentHookSeen('lc2')
    await make(false).t.create({ persistKey: 'lc2' } as never)
    expect(agentReadiness('lc2')).toBe('live')
  })

  it('destroy forgets the node (deleted: nothing to remember)', () => {
    markAgentHookSeen('lc3')
    const { t, destroy } = make(false)
    t.destroy('lc3')
    expect(destroy).toHaveBeenCalledWith('lc3', undefined)
    expect(agentReadiness('lc3')).toBe('unknown')
  })
})
