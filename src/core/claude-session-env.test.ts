import { describe, it, expect } from 'vitest'
import { CLAUDE_SESSION_ENV, CLAUDE_TOOL_SHELL_ENV, stripClaudeSessionEnv } from './claude-session-env'

/** What a Claude Code 2.1.268 tool shell carries on top of its claude process's own environment
 *  (measured: the names in a Bash-tool subprocess minus the names `claude` was started with), plus
 *  CLAUDE_CODE_SESSION_ATTENDED, which 2.1.269 added. */
const TOOL_SHELL: Record<string, string> = {
  CLAUDECODE: '1',
  CLAUDE_CODE_CHILD_SESSION: '1',
  CLAUDE_CODE_SESSION_ID: '1d8b4eeb-3ef5-461b-8045-fc2f3d889b67',
  CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_0192',
  CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-sock',
  CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_EXECPATH: '/Users/u/.local/share/claude/versions/2.1.268',
  CLAUDE_PID: '19105',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
  CLAUDE_EFFORT: 'xhigh',
  AI_AGENT: 'claude-code',
  GIT_EDITOR: 'true',
  COREPACK_ENABLE_AUTO_PIN: '0',
  NoDefaultCurrentDirectoryInExePath: '1'
}

describe('stripClaudeSessionEnv', () => {
  it('drops everything a Claude Code tool shell adds when the app was launched from one', () => {
    // The field bug: nodeterm relaunched with `open` from inside a Claude Code session inherited
    // that session's environment, and every agent it then spawned started with "Transcript saving
    // is off, inherited CLAUDE_CODE_CHILD_SESSION marker" — and held the launcher's messaging token.
    const env: Record<string, string | undefined> = { ...TOOL_SHELL, PATH: '/usr/bin', HOME: '/Users/u' }
    stripClaudeSessionEnv(env)
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/u' })
  })

  it('drops the per-session identity even without CLAUDECODE (a partial inherit is still wrong)', () => {
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_PID: '1'
    }
    stripClaudeSessionEnv(env)
    expect(env).toEqual({})
  })

  it('keeps a user\'s own generic settings when the app is NOT running inside Claude Code', () => {
    const env: Record<string, string | undefined> = {
      GIT_EDITOR: 'nvim',
      AI_AGENT: 'mine',
      CLAUDE_EFFORT: 'high',
      COREPACK_ENABLE_AUTO_PIN: '1',
      NoDefaultCurrentDirectoryInExePath: '1'
    }
    stripClaudeSessionEnv(env)
    expect(env).toEqual({
      GIT_EDITOR: 'nvim',
      AI_AGENT: 'mine',
      CLAUDE_EFFORT: 'high',
      COREPACK_ENABLE_AUTO_PIN: '1',
      NoDefaultCurrentDirectoryInExePath: '1'
    })
  })

  it('never touches Claude configuration a user sets on purpose', () => {
    const config = {
      CLAUDE_CONFIG_DIR: '/Users/u/.claude-2',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      ANTHROPIC_BASE_URL: 'https://gw.example'
    }
    const env: Record<string, string | undefined> = { ...config, CLAUDECODE: '1' }
    stripClaudeSessionEnv(env)
    expect(env).toEqual(config)
  })

  it('the two lists cover the measured tool-shell set exactly, with no overlap', () => {
    const all = [...CLAUDE_SESSION_ENV, ...CLAUDE_TOOL_SHELL_ENV]
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(Object.keys(TOOL_SHELL).sort())
    expect(CLAUDE_SESSION_ENV).toContain('CLAUDE_CODE_CHILD_SESSION')
  })
})
