import { describe, it, expect } from 'vitest'
import { COLLAPSED_HEIGHT, setCollapsed } from './workspace'
import type { CanvasNode } from './workspace'

// `setCollapsed` is the ONE implementation behind the header chevrons (terminal, sticky, files),
// the node menu's Minimize / Restore and the `minimize` verb. The thing it must never lose is the
// height to come back to (`data.expandedHeight`), so the round trip is pinned hardest.

const node = (
  id: string,
  type: string,
  extra: Partial<CanvasNode> = {},
  data: Record<string, unknown> = {}
): CanvasNode =>
  ({
    id,
    type,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    style: { width: 320, height: 240 },
    data: { title: id, color: '#fff', group: null, ...data },
    ...extra
  }) as CanvasNode

const byId = (nodes: CanvasNode[], id: string): CanvasNode => nodes.find((n) => n.id === id)!

describe('setCollapsed', () => {
  it('minimizes a node to its title bar and remembers the height it had', () => {
    const nodes = [node('a', 'terminal', { measured: { width: 320, height: 250 } })]
    const a = byId(setCollapsed(nodes, ['a'], true), 'a')
    expect(a.height).toBe(COLLAPSED_HEIGHT)
    expect(a.style).toEqual({ width: 320, height: COLLAPSED_HEIGHT })
    expect(a.data.collapsed).toBe(true)
    // React Flow's measured height wins over the declared one — it is what the user sees.
    expect(a.data.expandedHeight).toBe(250)
  })

  it('restores a minimized node to the height it remembered', () => {
    const nodes = [
      node('a', 'terminal', { height: 40, style: { width: 320, height: 40 } }, { collapsed: true, expandedHeight: 520 })
    ]
    const a = byId(setCollapsed(nodes, ['a'], false), 'a')
    expect(a.height).toBe(520)
    expect(a.style).toEqual({ width: 320, height: 520 })
    expect(a.data.collapsed).toBe(false)
  })

  it('gives back the exact height after a minimize → restore round trip', () => {
    const nodes = [node('a', 'terminal', { height: 333, style: { width: 320, height: 333 } })]
    const back = byId(setCollapsed(setCollapsed(nodes, ['a'], true), ['a'], false), 'a')
    expect(back.height).toBe(333)
    expect(back.style).toEqual({ width: 320, height: 333 })
    expect(back.data.collapsed).toBe(false)
  })

  it('minimizes and restores mixed kinds in one call, each to its own height', () => {
    const nodes = [
      node('t', 'terminal', { measured: { width: 320, height: 410 } }),
      node('s', 'sticky', { measured: { width: 240, height: 180 } }),
      node('f', 'files', { measured: { width: 340, height: 470 } })
    ]
    const down = setCollapsed(nodes, ['t', 's', 'f'], true)
    expect(down.map((n) => n.height)).toEqual([COLLAPSED_HEIGHT, COLLAPSED_HEIGHT, COLLAPSED_HEIGHT])
    expect(down.map((n) => n.data.collapsed)).toEqual([true, true, true])
    const up = setCollapsed(down, ['t', 's', 'f'], false)
    expect(up.map((n) => n.height)).toEqual([410, 180, 470])
  })

  it("restores a never-measured node to its kind's old header fallback", () => {
    const bare = (id: string, type: string): CanvasNode =>
      node(id, type, { height: undefined, style: { width: 320 } })
    const nodes = [bare('t', 'terminal'), bare('s', 'sticky'), bare('f', 'files'), bare('w', 'web')]
    const down = setCollapsed(nodes, ['t', 's', 'f', 'w'], true)
    // terminal 300, sticky 200, files 460: the literal each header chevron fell back to; the node
    // menu's toggle used 300 for every kind.
    expect(down.map((n) => n.data.expandedHeight)).toEqual([300, 200, 460, 300])
  })

  it('leaves a node already in the asked state untouched', () => {
    // Expanded, resized by hand to 700 since its last restore: `expandedHeight` still says 520.
    // Re-applying it on a "restore" would shrink the node the user just sized.
    const open = node('open', 'terminal', { height: 700, style: { width: 320, height: 700 } }, {
      collapsed: false,
      expandedHeight: 520
    })
    const shut = node('shut', 'sticky', { height: 40, style: { width: 240, height: 40 } }, {
      collapsed: true,
      expandedHeight: 200
    })
    const nodes = [open, shut]
    expect(byId(setCollapsed(nodes, ['open'], false), 'open')).toBe(open)
    expect(byId(setCollapsed(nodes, ['shut'], true), 'shut')).toBe(shut)
    // Nothing changed → the SAME array, so React skips the render and nothing is marked dirty.
    expect(setCollapsed(nodes, ['open'], false)).toBe(nodes)
    expect(setCollapsed(nodes, ['shut'], true)).toBe(nodes)
  })

  it('touches only the listed ids', () => {
    const a = node('a', 'terminal')
    const b = node('b', 'terminal')
    const next = setCollapsed([a, b], ['a'], true)
    expect(byId(next, 'a').data.collapsed).toBe(true)
    expect(byId(next, 'b')).toBe(b)
  })
})

// The inline toggle each header chevron carried before the helper existed (TerminalNode,
// StickyNode and FilesNode differed only in the fallback), kept VERBATIM as the reference the
// refactor is held to: a chevron click is `setCollapsed(nodes, [id], !collapsed)`, and for every
// state a node can be in it must produce exactly what the old code did.
const legacyToggle = (n: CanvasNode, fallback: number): CanvasNode => {
  const next = !n.data.collapsed
  const expandedHeight =
    (n.data.expandedHeight as number) ?? n.measured?.height ?? (n.height as number) ?? fallback
  const height = next ? COLLAPSED_HEIGHT : expandedHeight
  return {
    ...n,
    height,
    style: { ...n.style, height },
    data: { ...n.data, collapsed: next, expandedHeight }
  }
}

describe('setCollapsed as the header chevron', () => {
  const states: [string, Partial<CanvasNode>, Record<string, unknown>][] = [
    ['expanded, measured', { measured: { width: 320, height: 256 } }, {}],
    ['expanded, declared height only', {}, {}],
    ['expanded, no height at all', { height: undefined, style: { width: 320 } }, {}],
    ['expanded, stale expandedHeight', { height: 700 }, { collapsed: false, expandedHeight: 520 }],
    ['collapsed, remembered height', { height: 40 }, { collapsed: true, expandedHeight: 480 }],
    ['collapsed, nothing remembered', { height: 40, measured: { width: 320, height: 40 } }, { collapsed: true }]
  ]
  for (const [kind, fallback] of [
    ['terminal', 300],
    ['sticky', 200],
    ['files', 460]
  ] as const) {
    for (const [label, extra, data] of states) {
      it(`${kind}: ${label}`, () => {
        const n = node('x', kind, extra, data)
        expect(setCollapsed([n], ['x'], !n.data.collapsed)[0]).toEqual(legacyToggle(n, fallback))
      })
    }
  }
})
