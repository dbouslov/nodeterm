import { describe, expect, it } from 'vitest'
import { annotateNodes, annotateReply } from './annotateNodes'

const nodes = [
  { id: 'a', annotation: undefined },
  { id: 'b', annotation: { role: 'lead', by: 'x', at: 1 } }
]

describe('annotateNodes', () => {
  it('refuses the whole list on one unknown id, naming it', () => {
    expect(annotateNodes(nodes, { ids: ['a', 'zz'], role: 'r', recommend: undefined, clear: false }, 'hub', 5)).toEqual({
      error: 'annotate: no node with id zz'
    })
  })
  it('returns the next annotation per id, stamped with the caller and time', () => {
    expect(annotateNodes(nodes, { ids: ['a', 'b'], role: undefined, recommend: 'close', clear: false }, 'hub', 5)).toEqual({
      updates: [
        { id: 'a', annotation: { recommend: 'close', by: 'hub', at: 5 } },
        { id: 'b', annotation: { role: 'lead', recommend: 'close', by: 'hub', at: 5 } }
      ]
    })
  })
  it('--clear yields undefined so the field is removed', () => {
    expect(annotateNodes(nodes, { ids: ['b'], role: undefined, recommend: undefined, clear: true }, 'hub', 5)).toEqual({
      updates: [{ id: 'b', annotation: undefined }]
    })
  })
})

describe('annotateReply', () => {
  it('names the count and the ids', () => {
    expect(annotateReply([{ id: 'a', annotation: undefined }, { id: 'b', annotation: undefined }])).toBe('annotated 2: a, b')
  })
})
