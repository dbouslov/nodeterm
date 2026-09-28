/**
 * `pin --set dock` (the one-time Dock mark, T8) requires a VERIFIED caller, decided on the verdict
 * like `requiresVerified`, but argument-aware: plain `pin --set on|off` keeps its old routing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform } from '../platform-fake'
import { hookServer, DOCK_MARK_CONTROL_REFUSAL } from './hook-server'
import { nodeAuthToken } from './node-auth-token'

const SECRET = Buffer.alloc(32, 5)
const FOREIGN_SECRET = Buffer.alloc(32, 9)
let dir = ''
let handled: string[] = []

function pin(set: string, token?: string) {
  const headers: Record<string, string> = {
    'X-Nodeterm-Hook-Token': hookServer.getToken(),
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json'
  }
  if (token) headers['X-Nodeterm-Node-Token'] = token
  return fetch(`http://127.0.0.1:${hookServer.getPort()}/control/pin`, {
    method: 'POST',
    headers,
    body: `nodeId=n-src&arg.node=f1&arg.set=${set}`
  })
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-dock-verified-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  await hookServer.start()
  hookServer.setNodeAuthSecret(SECRET)
  hookServer.setControlHandler(async ({ args }) => {
    handled.push(args.set)
    return { ok: true, message: 'handled' }
  })
})
afterAll(() => {
  hookServer.setIdentityStrictOverride(() => undefined)
  hookServer.clearNodeAuthSecretForTests()
  hookServer.stop()
  resetPlatformForTests()
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  handled = []
})

describe('pin --set dock requires a verified caller', () => {
  it('refuses legacy and foreign-kid callers under every strict value, before the handler', async () => {
    for (const strict of [true, false, undefined]) {
      hookServer.setIdentityStrictOverride(() => strict)
      for (const token of [undefined, nodeAuthToken(FOREIGN_SECRET, 'n-src')]) {
        const res = await pin('dock', token)
        expect(res.status).toBe(403)
        expect(((await res.json()) as { error: string }).error).toBe(DOCK_MARK_CONTROL_REFUSAL)
      }
      const own = await pin('dock', nodeAuthToken(SECRET, 'n-src'))
      expect(own.status).not.toBe(403)
    }
    expect(handled).toEqual(['dock', 'dock', 'dock'])
  })

  it('plain pin --set on|off keeps its routing: a legacy caller in warn mode still reaches the handler', async () => {
    hookServer.setIdentityStrictOverride(() => false)
    for (const set of ['on', 'off']) expect((await pin(set)).status).not.toBe(403)
    expect(handled).toEqual(['on', 'off'])
  })
})
