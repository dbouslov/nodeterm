import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Structural (the header lives in a 5000-line component): the Dock seat's helper chip is wired to
// the Dock test, the subagent count and the armed loop, uses the existing header chip class, and
// sits in the header, so it adds no size (T8 amendment B).
const src = readFileSync(new URL('./TerminalNode.tsx', import.meta.url), 'utf8')

describe('Dock seat helper chip', () => {
  it('renders only for a chat in the Dock, from helperChip, with the header chip class', () => {
    const at = src.indexOf('{seatInDock &&')
    expect(at).toBeGreaterThan(-1)
    const block = src.slice(at, at + 700)
    expect(block).toContain('helperChip(fanoutCount, !!status?.loop && !status.loop.dismissed)')
    expect(block).toContain('className="node-account-chip node-helper-chip"')
    expect(block).toContain(': null')
  })
  it('sits in the header, beside the account chip', () => {
    const header = src.indexOf('<AccountChip')
    const chip = src.indexOf('{seatInDock &&')
    expect(chip).toBeGreaterThan(header)
    expect(chip - header).toBeLessThan(600)
  })
})
