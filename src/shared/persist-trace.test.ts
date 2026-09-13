import { describe, it, expect } from 'vitest'
import {
  PERSIST_TRACE_LIST_MAX,
  PERSIST_TRACE_STRING_MAX,
  formatPersistLine,
  parsePersistLine,
  sanitizeTraceFields
} from './persist-trace'

describe('the [persist] console line', () => {
  it('round-trips an event and its fields, marked as the renderer side', () => {
    const line = formatPersistLine('commit-skip', {
      reason: 'canvas-not-active-project',
      active: 'p1',
      onScreen: null,
      loading: false,
      nodes: 3
    })
    expect(line.startsWith('[persist] ')).toBe(true)
    expect(parsePersistLine(line)).toEqual({
      side: 'renderer',
      ev: 'commit-skip',
      reason: 'canvas-not-active-project',
      active: 'p1',
      onScreen: null,
      loading: false,
      nodes: 3
    })
  })

  it('is not fooled by other console lines', () => {
    expect(parsePersistLine('[nodeterm] node-create refused: canvas holds nothing')).toBeNull()
    expect(parsePersistLine('[persist] not json')).toBeNull()
    expect(parsePersistLine('[persist] {"no":"event"}')).toBeNull()
    expect(parsePersistLine('[persist] ["save"]')).toBeNull()
    expect(parsePersistLine('[persist] {"ev":"Not An Event Name"}')).toBeNull()
    expect(parsePersistLine('plain text')).toBeNull()
  })

  // Main writes whatever this parser hands it, so a renderer line must not be able to pose as a
  // record main made itself.
  it('never lets a renderer line claim to come from main', () => {
    expect(parsePersistLine('[persist] {"ev":"save","side":"main"}')?.side).toBe('renderer')
  })
})

describe('trace fields are ids, flags and sizes only', () => {
  it('drops objects, functions and non-finite numbers, and caps strings and lists', () => {
    const out = sanitizeTraceFields({
      ok: true,
      n: 2,
      none: null,
      bad: Number.NaN,
      obj: { text: 'a prompt' },
      fn: () => 1,
      long: 'x'.repeat(5000),
      ids: Array.from({ length: 50 }, (_, i) => `id${i}`),
      mixed: ['a', 1, 'b'],
      gone: undefined
    })
    expect(out).toEqual({
      ok: true,
      n: 2,
      none: null,
      long: 'x'.repeat(PERSIST_TRACE_STRING_MAX),
      ids: Array.from({ length: PERSIST_TRACE_LIST_MAX }, (_, i) => `id${i}`),
      mixed: ['a', 'b']
    })
  })

  it('drops keys that are not plain identifiers', () => {
    expect(sanitizeTraceFields({ 'a b': 1, _hidden: 2, ok: 3 })).toEqual({ ok: 3 })
  })
})
