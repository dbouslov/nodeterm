import { describe, it, expect } from 'vitest'
import { menuMinimizeRow, minimizeIds, minimizeReply, planMinimize, type MinimizeCandidate } from './minimize'

const n = (id: string, kind: string, collapsed = false): MinimizeCandidate => ({ id, kind, collapsed })

const canvas: MinimizeCandidate[] = [
  n('t1', 'terminal'),
  n('t2', 'terminal', true),
  n('s1', 'sticky'),
  n('f1', 'files', true),
  n('g1', 'group'),
  n('w1', 'web'),
  n('e1', 'editor')
]

describe('minimizeIds', () => {
  it('splits, trims and de-duplicates the comma list', () => {
    expect(minimizeIds(' t1, s1,,t1 ')).toEqual(['t1', 's1'])
    expect(minimizeIds(undefined)).toEqual([])
  })
})

describe('planMinimize', () => {
  it('splits the list into nodes to change and nodes already in the asked state', () => {
    expect(planMinimize(['t1', 't2', 's1', 'f1'], true, canvas)).toEqual({
      ok: true,
      change: ['t1', 's1'],
      already: ['t2', 'f1']
    })
    expect(planMinimize(['t1', 't2', 's1', 'f1'], false, canvas)).toEqual({
      ok: true,
      change: ['t2', 'f1'],
      already: ['t1', 's1']
    })
  })

  it('refuses an empty list', () => {
    expect(planMinimize([], true, canvas)).toEqual({ ok: false, error: 'minimize requires --node <id,id>' })
  })

  it('refuses the WHOLE list on an unknown id, naming every unknown one', () => {
    expect(planMinimize(['t1', 'nope', 'gone'], true, canvas)).toEqual({
      ok: false,
      error: 'minimize: no node on this canvas with id nope, gone — nothing was changed'
    })
  })

  it('refuses the WHOLE list on a group frame, naming it', () => {
    expect(planMinimize(['t1', 'g1'], true, canvas)).toEqual({
      ok: false,
      error: 'minimize: group frames do not minimize (g1) — nothing was changed'
    })
  })

  it('refuses the WHOLE list on an unsupported kind, naming the node and its kind', () => {
    expect(planMinimize(['s1', 'w1', 'e1'], false, canvas)).toEqual({
      ok: false,
      error:
        'minimize: only terminal, sticky and files nodes minimize (w1 is web, e1 is editor) — nothing was changed'
    })
  })
})

describe('minimizeReply', () => {
  it('names what changed and what was already in the asked state', () => {
    expect(minimizeReply(true, ['t1', 's1'], [])).toBe('minimized 2: t1, s1')
    expect(minimizeReply(true, ['t1'], ['t2'])).toBe('minimized 1: t1; already minimized: t2')
    expect(minimizeReply(true, [], ['t2', 'f1'])).toBe('already minimized: t2, f1 — nothing to do')
    expect(minimizeReply(false, ['t2'], ['t1'])).toBe('restored 1: t2; not minimized: t1')
    expect(minimizeReply(false, [], ['t1'])).toBe('not minimized: t1 — nothing to do')
  })
})

describe('menuMinimizeRow', () => {
  it('minimizes the targets unless every one of them is already minimized', () => {
    expect(menuMinimizeRow([n('t1', 'terminal'), n('t2', 'terminal', true)])).toEqual({ ids: ['t1', 't2'], on: true })
    expect(menuMinimizeRow([n('t2', 'terminal', true), n('f1', 'files', true)])).toEqual({ ids: ['t2', 'f1'], on: false })
  })

  it('leaves group frames out, and offers no row for a frames-only selection', () => {
    expect(menuMinimizeRow([n('g1', 'group'), n('t2', 'terminal', true)])).toEqual({ ids: ['t2'], on: false })
    expect(menuMinimizeRow([n('g1', 'group')])).toBeNull()
  })
})
