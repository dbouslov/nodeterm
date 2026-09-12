import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_RECOMMEND_MAX,
  ANNOTATION_ROLE_MAX,
  applyAnnotation,
  normalizeNodeAnnotation,
  parseAnnotateArgs
} from './node-annotation'

describe('normalizeNodeAnnotation', () => {
  it('keeps a well-formed record', () => {
    expect(normalizeNodeAnnotation({ role: 'lead', recommend: 'close it', by: 'n1', at: 5 })).toEqual({
      role: 'lead',
      recommend: 'close it',
      by: 'n1',
      at: 5
    })
  })
  it('drops non-objects and records missing by/at', () => {
    expect(normalizeNodeAnnotation('lead')).toBeUndefined()
    expect(normalizeNodeAnnotation(null)).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', at: 5 })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: 'n1' })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: 'n1', at: 'now' })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: 'n1', at: Number.NaN })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: '', at: 5 })).toBeUndefined()
  })
  it('drops a record with neither role nor recommend after cleaning', () => {
    expect(normalizeNodeAnnotation({ by: 'n1', at: 5 })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: '   ', recommend: 7, by: 'n1', at: 5 })).toBeUndefined()
  })
  it('collapses to one line and truncates to the caps', () => {
    const a = normalizeNodeAnnotation({
      role: ' a\nb '.padEnd(200, 'x'),
      recommend: 'r'.repeat(900),
      by: 'n1',
      at: 5
    })!
    expect(a.role).toHaveLength(ANNOTATION_ROLE_MAX)
    expect(a.role!.startsWith('a b')).toBe(true)
    expect(a.recommend).toHaveLength(ANNOTATION_RECOMMEND_MAX)
  })
})

describe('parseAnnotateArgs', () => {
  it('requires --node and one of --role/--recommend/--clear', () => {
    expect(parseAnnotateArgs({})).toEqual({ error: 'annotate requires --node <id,id>' })
    expect(parseAnnotateArgs({ node: ' , ' })).toEqual({ error: 'annotate requires --node <id,id>' })
    expect(parseAnnotateArgs({ node: 'a' })).toEqual({
      error: 'annotate: nothing to write (pass --role, --recommend or --clear)'
    })
  })
  it('splits, trims and dedupes ids and caps the list', () => {
    expect(parseAnnotateArgs({ node: ' a, b ,a', role: 'x' })).toEqual({
      ids: ['a', 'b'],
      role: 'x',
      recommend: undefined,
      clear: false
    })
    const fifty = Array.from({ length: 50 }, (_, i) => `n${i}`).join(',')
    expect(parseAnnotateArgs({ node: fifty, clear: '' })).toMatchObject({ clear: true })
    const many = Array.from({ length: 51 }, (_, i) => `n${i}`).join(',')
    expect(parseAnnotateArgs({ node: many, clear: '' })).toEqual({ error: 'annotate: at most 50 ids per call' })
  })
  it('reads --clear as a valueless flag', () => {
    expect(parseAnnotateArgs({ node: 'a', clear: '' })).toEqual({ ids: ['a'], role: undefined, recommend: undefined, clear: true })
    expect(parseAnnotateArgs({ node: 'a', clear: 'yes', role: 'r' })).toEqual({ ids: ['a'], role: 'r', recommend: undefined, clear: true })
  })
  it('refuses unknown flags', () => {
    expect(parseAnnotateArgs({ node: 'a', role: 'r', title: 't' })).toEqual({ error: 'annotate: unknown flag --title' })
  })
})

describe('applyAnnotation', () => {
  const now = 1000
  it('writes a fresh record with by/at', () => {
    expect(applyAnnotation(undefined, { ids: ['a'], role: 'lead', recommend: undefined, clear: false }, 'hub', now)).toEqual({
      role: 'lead',
      by: 'hub',
      at: now
    })
  })
  it('leaves an absent flag untouched without --clear', () => {
    const prev = { role: 'lead', recommend: 'old', by: 'x', at: 1 }
    expect(applyAnnotation(prev, { ids: ['a'], role: undefined, recommend: 'new', clear: false }, 'hub', now)).toEqual({
      role: 'lead',
      recommend: 'new',
      by: 'hub',
      at: now
    })
  })
  it('--clear alone removes; --clear with one flag keeps only that half', () => {
    const prev = { role: 'lead', recommend: 'old', by: 'x', at: 1 }
    expect(applyAnnotation(prev, { ids: ['a'], role: undefined, recommend: undefined, clear: true }, 'hub', now)).toBeUndefined()
    expect(applyAnnotation(prev, { ids: ['a'], role: 'tests', recommend: undefined, clear: true }, 'hub', now)).toEqual({
      role: 'tests',
      by: 'hub',
      at: now
    })
    expect(applyAnnotation(prev, { ids: ['a'], role: undefined, recommend: 'merge', clear: true }, 'hub', now)).toEqual({
      recommend: 'merge',
      by: 'hub',
      at: now
    })
  })
  it('normalizes what it writes (caps, one line)', () => {
    const a = applyAnnotation(undefined, { ids: ['a'], role: 'x\ny'.padEnd(100, 'z'), recommend: undefined, clear: false }, 'hub', now)!
    expect(a.role).toHaveLength(ANNOTATION_ROLE_MAX)
    expect(a.role!.startsWith('x y')).toBe(true)
  })
})
