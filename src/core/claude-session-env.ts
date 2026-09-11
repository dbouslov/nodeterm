// Environment a Claude Code session hands to the processes IT spawns — never passed on to a pane.
//
// A pane starts its own agent session. When nodeterm itself was launched from inside a Claude Code
// session (an `open` or `npm run dev` run from a Claude Code tool shell — how the app was relaunched
// on 2026-09-11), its process.env carries that session's identity, and pty-manager builds every
// pane's environment from process.env. Every agent spawned afterwards then took itself for a CHILD
// of the launcher: Claude Code printed "Transcript saving is off, inherited CLAUDE_CODE_CHILD_SESSION
// marker" and wrote no transcript (so context links read "no conversation transcript yet"), and each
// pane held the launcher's messaging socket and token.
//
// Measured on Claude Code 2.1.268: these are exactly the names a Bash-tool subprocess has that its
// `claude` process was not started with. Two groups, because they are not the same kind of fact.

/** One session's identity. Never valid in a new session, so always dropped. */
export const CLAUDE_SESSION_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_PID'
] as const

/** Settings Claude Code applies to its non-interactive tool shells (`GIT_EDITOR=true` makes a
 *  human's `git commit` in a pane exit without ever opening an editor). A user may set these names
 *  on purpose, so they are dropped only when the environment is evidently a Claude Code tool shell. */
export const CLAUDE_TOOL_SHELL_ENV = [
  'CLAUDE_EFFORT',
  'AI_AGENT',
  'GIT_EDITOR',
  'COREPACK_ENABLE_AUTO_PIN',
  'NoDefaultCurrentDirectoryInExePath'
] as const

/** Remove both groups from `env` in place — the tool-shell group only when `CLAUDECODE` is set. */
export function stripClaudeSessionEnv(env: Record<string, string | undefined>): void {
  const insideClaudeCode = env.CLAUDECODE !== undefined
  for (const k of CLAUDE_SESSION_ENV) delete env[k]
  if (insideClaudeCode) for (const k of CLAUDE_TOOL_SHELL_ENV) delete env[k]
}
