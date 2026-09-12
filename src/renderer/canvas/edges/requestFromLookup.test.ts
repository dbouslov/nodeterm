import { describe, it, expect } from 'vitest'
import { requestFromLookup, signatureOf, type InternalNodeLike } from './requestFromLookup'

const inode = (id: string, x: number, y: number, o: Partial<InternalNodeLike> = {}): InternalNodeLike => ({
  id, measured: { width: 200, height: 100 }, internals: { positionAbsolute: { x, y } }, ...o
})

describe('requestFromLookup', () => {
  it('uses absolute positions and measured sizes; groups are frames; unmeasured nodes are skipped', () => {
    const { req } = requestFromLookup(
      [inode('g', 0, 0, { type: 'group', measured: { width: 800, height: 600 } }), inode('a', 20, 20, { parentId: 'g' }), inode('u', 0, 0, { measured: {} })],
      [{ id: 'e', source: 'a', target: 'u', data: { kind: 'rope' } }]
    )
    expect(req.nodes.get('g')).toMatchObject({ isFrame: true, width: 800 })
    expect(req.nodes.get('a')).toMatchObject({ x: 20, y: 20, parentId: 'g', isFrame: false })
    expect(req.nodes.has('u')).toBe(false)
    expect(req.edges).toEqual([{ id: 'e', source: 'a', target: 'u', kind: 'rope', ropeKind: undefined }])
  })
  it('an edge without circuit data is dropped; dragging ids are reported', () => {
    const { req, dragging } = requestFromLookup([inode('a', 0, 0, { dragging: true }), inode('b', 500, 0)], [{ id: 'x', source: 'a', target: 'b' }])
    expect(req.edges).toEqual([])
    expect([...dragging]).toEqual(['a'])
  })
  it('signature changes on move, size, hidden, selected, dragging, parent — not on anything else', () => {
    const base = [inode('a', 0, 0)]
    const s = signatureOf(base)
    expect(signatureOf([inode('a', 1, 0)])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { hidden: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { selected: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { dragging: true })])).not.toBe(s)
    expect(signatureOf([inode('a', 0, 0, { type: 'terminal' })])).toBe(s)
  })
})
