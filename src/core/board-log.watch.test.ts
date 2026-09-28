import { describe, expect, it, vi, afterEach } from 'vitest'
import path from 'path'
import type { FSWatcher } from 'fs'

// fs.watch injected: the real-fs tests in board-log.test.ts must re-append until the OS watcher
// is live (macOS FSEvents can drop a change made right after watch() returns), which would also
// hide a store that ignored its FIRST event. This pins that case without the OS in the loop.
type Listener = (event: string, filename: string | null) => void
const watched: Array<{ dir: string; listener: Listener }> = []

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const watch = (dir: string, listener: Listener): FSWatcher => {
    watched.push({ dir, listener })
    return { on: () => undefined, close: () => undefined } as unknown as FSWatcher
  }
  return { ...actual, default: actual, watch }
})

const { BoardLogStore } = await import('./board-log')

afterEach(() => {
  vi.useRealTimers()
  watched.length = 0
})

describe('BoardLogStore.watch (fs.watch injected)', () => {
  it('fires the callback once, 250ms after the FIRST change event', () => {
    vi.useFakeTimers()
    let hits = 0
    const unsub = new BoardLogStore({}).watch('/proj', () => {
      hits++
    })
    expect(watched).toHaveLength(1)
    expect(watched[0].dir).toBe(path.join('/proj', '.nodeterm'))

    watched[0].listener('change', 'board-log.jsonl')
    vi.advanceTimersByTime(249)
    expect(hits).toBe(0)
    vi.advanceTimersByTime(1)
    expect(hits).toBe(1)
    vi.advanceTimersByTime(5_000)
    expect(hits).toBe(1)
    unsub()
  })
})
