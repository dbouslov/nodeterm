// @vitest-environment jsdom
//
// The Dock's chrome (T8, design 4.3): --surface-deep fill, 1 px neutral border, lock glyph, a
// 34 px header (GROUP_HEADER, so every hug agrees), no resize handle and no hover Ungroup: it
// reads as furniture, not as selected or working.
import { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { GROUP_HEADER } from '../state/workspace'
import { useWorktrees } from '../state/worktrees'

const resizer = vi.fn()
vi.mock('@xyflow/react', () => ({
  NodeResizer: (p: { isVisible?: boolean }) => {
    resizer(p.isVisible)
    return null
  },
  useReactFlow: () => ({ updateNodeData: vi.fn(), setNodes: vi.fn() })
}))

import { GroupNode } from './GroupNode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(data: Record<string, unknown>, selected = true): HTMLDivElement {
  const host = document.createElement('div')
  document.body.append(host)
  const props = { id: 'g', data: { title: 'GO', color: '#d97757', ...data }, selected } as unknown as Parameters<
    typeof GroupNode
  >[0]
  act(() => {
    createRoot(host).render(<GroupNode {...props} />)
  })
  return host
}

beforeEach(() => {
  document.body.innerHTML = ''
  resizer.mockClear()
  useWorktrees.setState({ refreshStatus: async () => {} })
})

describe('the Dock frame', () => {
  it('draws the Dock chrome: class, lock glyph, no hover Ungroup, no resize handle, no color paint', () => {
    const host = render({ fixture: 'dock', pinned: true })
    const frame = host.querySelector('.group-node') as HTMLDivElement
    expect(frame.classList.contains('group-node--dock')).toBe(true)
    expect(frame.classList.contains('selected')).toBe(false)
    expect(frame.style.borderColor).toBe('')
    expect(frame.style.background).toBe('')
    expect(frame.style.boxShadow).toBe('')
    expect(host.querySelector('.group-node__lock svg')).not.toBeNull()
    expect(host.querySelector('.group-node__ungroup')).toBeNull()
    expect(resizer).toHaveBeenLastCalledWith(false)
  })

  it('an ordinary frame is unchanged', () => {
    const host = render({})
    const frame = host.querySelector('.group-node') as HTMLDivElement
    expect(frame.classList.contains('group-node--dock')).toBe(false)
    expect(host.querySelector('.group-node__lock')).toBeNull()
    expect(host.querySelector('.group-node__ungroup')).not.toBeNull()
    expect(resizer).toHaveBeenLastCalledWith(true)
  })

  it('the stylesheet paints it with the tokens, in both themes, at the layout header height', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')
    const rule = (sel: string): string => {
      const at = css.indexOf(`${sel} {`)
      expect(at, sel).toBeGreaterThan(-1)
      return css.slice(at, css.indexOf('}', at))
    }
    const dock = rule('.group-node--dock')
    expect(dock).toContain('background: var(--surface-deep)')
    expect(dock).toMatch(/border: 1px solid var\(--dock-border\)/)
    // Defined for the dark default and again for the light theme.
    expect(css.match(/--dock-border: /g)).toHaveLength(2)
    const header = rule('.group-node--dock .group-node__label')
    expect(header).toContain(`height: ${GROUP_HEADER}px`)
  })
})

describe('GroupNode ungroup() refuses the Dock itself (review fix 4)', () => {
  it('the local ungroup returns early for a Dock, not only by hiding its button', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/renderer/nodes/GroupNode.tsx'), 'utf8')
    const at = src.indexOf('const ungroup = (): void => {')
    expect(src.slice(at, at + 200)).toMatch(/if \(dock\) return/)
  })
})

describe('Dock label scales like other frame labels at fit-all zoom (review fix 5)', () => {
  it('lock and name sit in one tag that scales with --group-label-boost, inside the 34 px strip', () => {
    const host = render({ fixture: 'dock', pinned: true })
    const tag = host.querySelector('.group-node__label > .group-node__docktag')!
    expect(tag).not.toBeNull()
    expect(tag.querySelector('.group-node__lock svg')).not.toBeNull()
    expect(tag.querySelector('.group-node__name')).not.toBeNull()
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')
    const at = css.indexOf('.group-node__docktag {')
    expect(at).toBeGreaterThan(-1)
    const rule = css.slice(at, css.indexOf('}', at))
    expect(rule).toContain('transform: scale(var(--group-label-boost, 1))')
    expect(rule).toContain('transform-origin: 0 50%')
    // The strip itself does not scale: it stays the layout's 34 px.
    const strip = css.slice(css.indexOf('.group-node--dock .group-node__label {'))
    expect(strip.slice(0, strip.indexOf('}'))).toContain('transform: none')
  })
})
