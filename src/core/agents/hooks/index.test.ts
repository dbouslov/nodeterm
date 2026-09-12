// The $GROK_HOME probe is WIRED, not merely available.
//
// grok-paths.test.ts proves the probe resolves. This proves somebody asks it at install time — the
// distinction that matters, because the probe is exactly the kind of code the typecheck validates
// and nothing exercises: delete the call and every other test stays green while the user whose
// `export GROK_HOME=…` lives in `.zshrc` gets the hook file written where grok will never look, with
// no badge, no notification and no diagnostic, forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { installManagedAgentHooks } from './index'
import { _resetGrokHomeProbeForTests, ensureGrokHomeProbed, grokHomeDir } from '../grok-paths'
import { GROK_HOOK_FILE } from '../grok-paths'
import { fakePlatform } from '../../platform-fake'
import { initPlatform, resetPlatformForTests } from '../../platform'

// The probe's own source is mocked, not the probe: `installManagedAgentHooks` calls
// `ensureGrokHomeProbed()` with NO argument, so the only way to exercise the real wiring is to
// control what the login shell appears to say. Injecting a second `ask` from the test would resolve
// after the install's own call and prove nothing.
let shellAnswer: string | null = null
vi.mock('../../exec-path', async (orig) => ({
  ...((await orig()) as object),
  resolveShellEnvVar: async () => shellAnswer
}))

let home: string
let realHome: string | undefined
let realProfile: string | undefined
// Each of these wins over HOME where an installer resolves its config dir (grok-paths.ts,
// hooks/copilot.ts, hooks/opencode.ts): with them exported, this suite wrote the grok, Copilot and
// opencode hooks into those dirs (measured 2026-09-11). Cleared for each test, restored after.
const HOME_OVERRIDES = ['GROK_HOME', 'COPILOT_HOME', 'XDG_CONFIG_HOME'] as const
let realOverrides: Record<string, string | undefined> = {}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-probe-'))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  // The spy reaches only `os.homedir()` callers. The installers that write per-machine files —
  // `install-helper.ts`'s `~/.nodeterm/agent-hooks`, the claude/gemini/codex settings — import
  // `{ homedir }` by name, which the spy never sees, so this suite rewrote the developer's live hook
  // scripts with its own temp dir embedded (measured 2026-09-11). `homedir()` honours $HOME on POSIX
  // and USERPROFILE on Windows, so both point at the fixture.
  realHome = process.env.HOME
  realProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  realOverrides = {}
  for (const k of HOME_OVERRIDES) {
    realOverrides[k] = process.env[k]
    delete process.env[k]
  }
  initPlatform(fakePlatform({ userDataDir: home }))
  _resetGrokHomeProbeForTests()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  if (realProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = realProfile
  for (const k of HOME_OVERRIDES) {
    if (realOverrides[k] === undefined) delete process.env[k]
    else process.env[k] = realOverrides[k]
  }
  _resetGrokHomeProbeForTests()
  resetPlatformForTests()
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('installManagedAgentHooks — the $GROK_HOME probe (§8.9)', () => {
  it("writes grok's hook where the LOGIN SHELL says grok lives, not only under ~/.grok", async () => {
    const elsewhere = path.join(home, 'relocated-grok')
    shellAnswer = elsewhere
    // Nothing is pre-resolved: the synchronous install runs first and writes at the OLD home, then
    // the probe lands and the re-install puts the file where grok will actually look. That is the
    // real boot sequence, and it is what makes deleting the re-install a red test instead of a
    // silent regression.
    expect(grokHomeDir()).not.toBe(elsewhere)

    installManagedAgentHooks()
    await new Promise((r) => setTimeout(r, 50))

    expect(grokHomeDir()).toBe(elsewhere)
    expect(fs.existsSync(path.join(elsewhere, 'hooks', GROK_HOOK_FILE))).toBe(true)
  })

  it('writes it at the default home when the shell knows nothing — behaviour unchanged', async () => {
    // Asserted against `grokHomeDir()` rather than a hand-built `~/.grok`: this module resolves the
    // home through its own imported `homedir`, so hard-coding the path here would test the test's
    // idea of the default instead of the code's.
    shellAnswer = null
    const target = grokHomeDir()
    installManagedAgentHooks()
    await new Promise((r) => setTimeout(r, 20))
    expect(fs.existsSync(path.join(target, 'hooks', GROK_HOOK_FILE))).toBe(true)
  })
})
