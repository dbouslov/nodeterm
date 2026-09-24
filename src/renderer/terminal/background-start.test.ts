import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PtyCreateOptions, PtyCreateResult } from '@shared/types'
import { startDetached } from './background-start'

// A transport whose create resolves with `result`, and whose output the test drives by hand.
function fakeTransport(result: Partial<PtyCreateResult> = {}) {
  const log: string[] = []
  const listeners = new Set<(d: string) => void>()
  return {
    log,
    emit: (d: string) => listeners.forEach((l) => l(d)),
    listening: () => listeners.size,
    transport: {
      create: async (o: PtyCreateOptions) => {
        log.push(`create ${o.persistKey}`)
        return { sessionId: 's1', fresh: true, persistent: true, ...result } as PtyCreateResult
      },
      onData: (_sid: string, l: (d: string) => void) => {
        listeners.add(l)
        return () => void listeners.delete(l)
      },
      kill: (sid: string) => void log.push(`detach ${sid}`)
    }
  }
}

const opts: PtyCreateOptions = { cols: 80, rows: 24, persistKey: 'n1' }

describe('startDetached — a session with no node mounted (#38)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('spawns, waits for the shell to go quiet, then detaches — tmux keeps the session', async () => {
    const f = fakeTransport()
    const done = startDetached(f.transport, opts)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.log).toEqual(['create n1'])
    f.emit('Last login…')
    await vi.advanceTimersByTimeAsync(150)
    f.emit('% ')
    await vi.advanceTimersByTimeAsync(150)
    // Still printing within the quiet window: not settled, not detached.
    expect(f.log).toEqual(['create n1'])
    await vi.advanceTimersByTimeAsync(100)
    await expect(done).resolves.toBe(true)
    expect(f.log).toEqual(['create n1', 'detach s1'])
    expect(f.listening()).toBe(0)
  })

  it('settles on the silence cap when the shell prints nothing', async () => {
    const f = fakeTransport()
    const done = startDetached(f.transport, opts)
    await vi.advanceTimersByTimeAsync(1500)
    await expect(done).resolves.toBe(true)
  })

  it('never leaves a session running that nothing could reattach: a plain shell is killed, not started', async () => {
    const f = fakeTransport({ persistent: false })
    await expect(startDetached(f.transport, opts)).resolves.toBe(false)
    expect(f.log).toEqual(['create n1', 'detach s1'])
  })

  it('answers false for a refused create (closed by someone else, or no remote host)', async () => {
    await expect(startDetached(fakeTransport({ closed: { by: null } }).transport, opts)).resolves.toBe(false)
    await expect(startDetached(fakeTransport({ unavailable: 'ssh' }).transport, opts)).resolves.toBe(false)
  })

  it('answers false when the create throws', async () => {
    const f = fakeTransport()
    f.transport.create = async () => {
      throw new Error('ipc gone')
    }
    await expect(startDetached(f.transport, opts)).resolves.toBe(false)
  })
})
