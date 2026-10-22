// Which MCP servers a claude node starts with. Canvas-control launches (`open-claude`,
// `open-agent --agent claude`, `spawn-team`) default to `none`: `--strict-mcp-config` with no
// `--mcp-config`, so the user's claude.ai connectors and plugin servers are never loaded. Measured
// 2026-10 at ~6K tokens at start plus ~7K more when late-connecting connectors join after the first
// tool call — paid by every agent chat that never touches them. A brief that needs them opts in.
//
// The claude.ai connectors cannot be picked one by one (they are not `--mcp-config` entries), so
// naming ANY of them, or `all`, drops the strict flag and the chat gets the user's full set.
// `chrome` is separate: claude-in-chrome is enabled by `--chrome` and survives the strict config.

import { capabilityAgentId, type AgentId } from './config'

/** The scope canvas-control launches use when the caller passes no `--mcp`. */
export const AGENT_DEFAULT_MCP = 'none'

const CONNECTORS = ['gmail', 'calendar', 'drive', 'docs', 'all']
const NAMES = ['none', 'chrome', ...CONNECTORS]

/** Normalize a `--mcp` value: comma list of known names, lowercased, deduped, sorted. */
export function normalizedAgentMcp(raw: string): { value: string } | { error: string } {
  const names = [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))].sort()
  if (!names.length) return { error: `--mcp needs a name: ${NAMES.join(', ')}` }
  const unknown = names.filter((n) => !NAMES.includes(n))
  if (unknown.length) return { error: `--mcp: unknown "${unknown.join(',')}" — known: ${NAMES.join(', ')}` }
  if (names.includes('none') && names.length > 1) return { error: '--mcp none cannot be combined with other names' }
  return { value: names.join(',') }
}

/** Append the MCP flags for a claude-base node. Undefined (UI-opened and older nodes) is a no-op. */
export function withAgentMcp(cmd: string, agentId: AgentId, mcp: string | undefined): string {
  if (!mcp || capabilityAgentId(agentId) !== 'claude') return cmd
  const parsed = normalizedAgentMcp(mcp)
  if (!('value' in parsed)) return cmd
  const names = parsed.value.split(',')
  const strict = !names.some((n) => CONNECTORS.includes(n))
  return [cmd, ...(strict ? ['--strict-mcp-config'] : []), ...(names.includes('chrome') ? ['--chrome'] : [])].join(' ')
}
