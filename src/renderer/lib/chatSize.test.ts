import { describe, it, expect } from 'vitest'
import { arrangeNodes, COLLAPSED_HEIGHT, type CanvasNode } from '../state/workspace'
import { commonChatSize, frameChatSize, parseChatSize, resizeChats, withChatSize } from './chatSize'

const node = (id: string, x: number, y: number, w: number, h: number, more: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: 'terminal', position: { x, y }, width: w, height: h, data: { title: id, color: '#fff', group: null }, ...more }) as CanvasNode
const inF = { parentId: 'f', extent: 'parent' } as Partial<CanvasNode>
const get = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((n) => n.id === id)!
const w = (n: CanvasNode): number => n.measured?.width ?? (n.width as number)
const h = (n: CanvasNode): number => n.measured?.height ?? (n.height as number)
const collapsed = (n: CanvasNode, expandedHeight: number): CanvasNode =>
  ({ ...n, height: COLLAPSED_HEIGHT, data: { ...n.data, collapsed: true, expandedHeight } }) as CanvasNode

describe('parseChatSize — `--size WxH`', () => {
  it('reads WxH (x or ×, any case), and absent is no size', () => {
    expect(parseChatSize('640x420')).toEqual({ width: 640, height: 420 })
    expect(parseChatSize(' 700X500 ')).toEqual({ width: 700, height: 500 })
    expect(parseChatSize('700×500')).toEqual({ width: 700, height: 500 })
    expect(parseChatSize(undefined)).toBeNull()
  })
  it('refuses a malformed size or one below a chat’s minimum', () => {
    expect(parseChatSize('big')).toEqual({ error: expect.stringContaining('--size') })
    expect(parseChatSize('100x100')).toEqual({ error: expect.stringContaining('at least 260x160') })
    expect(parseChatSize('9000x400')).toEqual({ error: expect.stringContaining('at most') })
  })
})

describe('commonChatSize — the size a frame’s chats share', () => {
  it('is the most common expanded chat size', () => {
    const nodes = [node('a', 0, 0, 600, 400), node('b', 0, 0, 600, 400), node('c', 0, 0, 800, 500)]
    expect(commonChatSize(nodes, ['a', 'b', 'c'])).toEqual({ width: 600, height: 400 })
  })
  it('breaks a tie toward the larger size', () => {
    const nodes = [node('a', 0, 0, 600, 400), node('b', 0, 0, 800, 500)]
    expect(commonChatSize(nodes, ['a', 'b'])).toEqual({ width: 800, height: 500 })
    expect(commonChatSize(nodes, ['b', 'a'])).toEqual({ width: 800, height: 500 })
  })
  it('counts neither notes nor minimized chats, and is null with no expanded chat', () => {
    const nodes = [
      node('a', 0, 0, 600, 400),
      node('n1', 0, 0, 300, 200, { type: 'sticky' }),
      node('n2', 0, 0, 300, 200, { type: 'sticky' }),
      collapsed(node('m', 0, 0, 900, 900), 900)
    ]
    expect(commonChatSize(nodes, ['a', 'n1', 'n2', 'm'])).toEqual({ width: 600, height: 400 })
    expect(commonChatSize(nodes, ['n1', 'm'])).toBeNull()
  })
  it('a maximized chat neither votes nor is resized (it is sized to the screen, not the frame)', () => {
    const max = { premaxRect: { x: 0, y: 0, width: 600, height: 400 } }
    const nodes = [
      node('a', 0, 0, 600, 400),
      node('m1', 0, 0, 1800, 1000, { data: { title: 'm1', color: '#fff', group: null, ...max } }),
      node('m2', 0, 0, 1800, 1000, { data: { title: 'm2', color: '#fff', group: null, ...max } })
    ]
    expect(commonChatSize(nodes, ['a', 'm1', 'm2'])).toEqual({ width: 600, height: 400 })
    const out = resizeChats(nodes, ['a', 'm1'], { width: 800, height: 500 })
    expect(get(out, 'm1')).toBe(nodes[1])
    expect(w(get(out, 'a'))).toBe(800)
  })

  it('reads the rendered (`measured`) size first', () => {
    const nodes = [node('a', 0, 0, 1, 1, { measured: { width: 640, height: 420 } })]
    expect(commonChatSize(nodes, ['a'])).toEqual({ width: 640, height: 420 })
  })
})

describe('resizeChats — one size for the chats, nothing else', () => {
  it('sizes expanded chats, leaves notes, gives minimized chats the width and keeps their title bar', () => {
    const nodes = [
      node('a', 0, 0, 600, 400, { measured: { width: 600, height: 400 } }),
      node('n', 0, 0, 300, 200, { type: 'sticky' }),
      collapsed(node('m', 0, 0, 900, 700), 700)
    ]
    const out = resizeChats(nodes, ['a', 'n', 'm'], { width: 800, height: 500 })
    expect([w(get(out, 'a')), h(get(out, 'a'))]).toEqual([800, 500])
    expect(get(out, 'a').measured).toBeUndefined()
    expect(get(out, 'n')).toBe(nodes[1])
    const m = get(out, 'm')
    expect([w(m), h(m)]).toEqual([800, COLLAPSED_HEIGHT])
    expect(m.data.collapsed).toBe(true)
    expect(m.data.expandedHeight).toBe(500)
  })
  it('leaves a pinned chat alone', () => {
    const nodes = [node('a', 0, 0, 600, 400, { data: { title: 'a', color: '#fff', group: null, pinned: true } })]
    expect(resizeChats(nodes, ['a'], { width: 800, height: 500 })).toBe(nodes)
  })
  it('then arranged in the given order, the chats do not overlap and keep that order', () => {
    const nodes = [
      node('f', 0, 0, 2000, 2000, { type: 'group' }),
      node('c', 900, 20, 800, 500, inF),
      node('a', 20, 20, 600, 400, inF),
      node('b', 20, 600, 600, 400, inF),
      node('n', 900, 900, 300, 200, { ...inF, type: 'sticky' })
    ]
    const ids = ['c', 'a', 'b', 'n']
    const sized = resizeChats(nodes, ids, commonChatSize(nodes, ids)!)
    const out = arrangeNodes(sized, ids, { layout: 'row', order: 'given' })
    const xs = ids.map((id) => get(out, id).position.x)
    expect([...xs].sort((p, q) => p - q)).toEqual(xs) // --nodes order, left to right
    for (const id of ['a', 'b', 'c']) expect([w(get(out, id)), h(get(out, id))]).toEqual([600, 400])
    expect([w(get(out, 'n')), h(get(out, 'n'))]).toEqual([300, 200])
    for (let i = 1; i < ids.length; i++) {
      const prev = get(out, ids[i - 1])
      expect(get(out, ids[i]).position.x).toBeGreaterThanOrEqual(prev.position.x + w(prev))
    }
  })
})

describe('adding a chat into a frame — it takes the frame’s common chat size', () => {
  const nodes = [
    node('f', 0, 0, 2000, 2000, { type: 'group' }),
    node('a', 20, 20, 600, 400, inF),
    node('b', 700, 20, 600, 400, inF),
    node('n', 20, 500, 300, 200, { ...inF, type: 'sticky' }),
    node('top', 3000, 0, 900, 900)
  ]
  it('frameChatSize reads the frame’s direct chats, excluding the ones joining', () => {
    expect(frameChatSize(nodes, 'f')).toEqual({ width: 600, height: 400 })
    expect(frameChatSize(nodes, 'f', ['a', 'b'])).toBeNull()
    expect(frameChatSize(nodes, 'nope')).toBeNull()
  })
  it('withChatSize sizes a new chat (style too) and leaves a note or no size alone', () => {
    const fresh = node('new', 0, 0, 900, 900, { style: { width: 900, height: 900 } })
    const sized = withChatSize(fresh, frameChatSize(nodes, 'f'))
    expect([sized.width, sized.height, sized.style?.width, sized.style?.height]).toEqual([600, 400, 600, 400])
    const note = node('s', 0, 0, 300, 200, { type: 'sticky' })
    expect(withChatSize(note, { width: 600, height: 400 })).toBe(note)
    expect(withChatSize(fresh, null)).toBe(fresh)
  })
})
