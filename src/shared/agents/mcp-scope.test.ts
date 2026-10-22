import { describe, expect, it } from 'vitest'
import { AGENT_DEFAULT_MCP, normalizedAgentMcp, withAgentMcp } from './mcp-scope'

describe('normalizedAgentMcp', () => {
  it('accepts the known names, lowercased, deduped and sorted', () => {
    expect(normalizedAgentMcp('none')).toEqual({ value: 'none' })
    expect(normalizedAgentMcp(' Chrome ')).toEqual({ value: 'chrome' })
    expect(normalizedAgentMcp('gmail,calendar,gmail')).toEqual({ value: 'calendar,gmail' })
    expect(normalizedAgentMcp('all')).toEqual({ value: 'all' })
  })

  it('refuses an unknown name, an empty list and none mixed with others', () => {
    expect(normalizedAgentMcp('slack')).toHaveProperty('error')
    expect(normalizedAgentMcp('')).toHaveProperty('error')
    expect(normalizedAgentMcp(' , ')).toHaveProperty('error')
    expect(normalizedAgentMcp('none,chrome')).toHaveProperty('error')
  })
})

describe('withAgentMcp', () => {
  it('leaves the command byte-identical when no scope was chosen', () => {
    expect(withAgentMcp('claude --model opus', 'claude', undefined)).toBe('claude --model opus')
  })

  it('starts a claude node with no MCP servers by default', () => {
    expect(AGENT_DEFAULT_MCP).toBe('none')
    expect(withAgentMcp('claude', 'claude', 'none')).toBe('claude --strict-mcp-config')
  })

  it('keeps claude-in-chrome under the strict config when chrome is named', () => {
    expect(withAgentMcp('claude', 'claude', 'chrome')).toBe('claude --strict-mcp-config --chrome')
  })

  it('opts back in to the full set when a claude.ai connector or all is named', () => {
    expect(withAgentMcp('claude', 'claude', 'gmail,calendar')).toBe('claude')
    expect(withAgentMcp('claude', 'claude', 'all')).toBe('claude')
    expect(withAgentMcp('claude', 'claude', 'chrome,drive')).toBe('claude --chrome')
  })

  it('is a no-op for agents that are not claude and for a stored value that no longer parses', () => {
    expect(withAgentMcp('codex', 'codex', 'none')).toBe('codex')
    expect(withAgentMcp('claude', 'claude', 'bogus')).toBe('claude')
  })
})
