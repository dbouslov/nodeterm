import { describe, it, expect, vi } from 'vitest'
import { dockFrameMenu } from './dockMenu'

// A Dock whose GO chat is gone must never strand David: the Dock frame's own menu always offers
// Release Dock, and it is chosen by the frame alone, so an empty Dock gets it too.

type Row = { type?: string; label?: string; disabled?: boolean; hint?: string; onClick?: () => void }

describe('dockFrameMenu', () => {
  it('offers an enabled Release Dock that calls only the release handler', () => {
    const release = vi.fn()
    const rows = dockFrameMenu(release) as Row[]
    const row = rows.find((r) => r.label === 'Release Dock')!
    expect(row).toBeTruthy()
    expect(row.disabled).toBeFalsy()
    row.onClick!()
    expect(release).toHaveBeenCalledTimes(1)
  })
  it('shows Ungroup, Delete and Unpin greyed with the reason, never live', () => {
    const rows = dockFrameMenu(() => {}) as Row[]
    for (const label of ['Unpin frame', 'Ungroup', 'Delete (keeps nodes)']) {
      const row = rows.find((r) => r.label === label)!
      expect(row.disabled).toBe(true)
      expect(row.hint).toMatch(/Release Dock/)
    }
  })
})

import { frameMenuFor } from './dockMenu'

describe('frameMenuFor: the frame-menu choice (review fix 4, GO condition 2)', () => {
  const dockOnly = [{ id: 'D', type: 'group', data: { fixture: 'dock' } }]
  it('an EMPTY Dock (its GO chat gone) still offers Release Dock', () => {
    const release = vi.fn()
    const normal = vi.fn(() => [])
    const rows = frameMenuFor('D', dockOnly, release, normal) as Row[]
    const row = rows.find((r) => r.label === 'Release Dock')!
    expect(row.disabled).toBeFalsy()
    row.onClick!()
    expect(release).toHaveBeenCalledWith('D')
    expect(normal).not.toHaveBeenCalled()
  })
  it('an ordinary frame gets the ordinary menu', () => {
    const normal = vi.fn(() => [{ type: 'separator' as const }])
    const rows = frameMenuFor('G', [{ id: 'G', type: 'group', data: {} }], () => {}, normal)
    expect(normal).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([{ type: 'separator' }])
  })
})
