// Which attached UI is the machine's OWNER. The canvas reflector lets a node's machine-local held
// launch (`pendingLaunch`) travel only owner→owner (core/canvas-sync.ts), so a relay-hosted guest
// must never be marked owner, and the cookie-authenticated browser socket must be.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { ServerPlatform } from './platform-server'

const sink = { sendText: () => {}, sendBinary: () => {}, bufferedAmount: () => 0 }
const src = (f: string): string => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

describe('ServerPlatform.isOwnerClient', () => {
  it('is true only for a connection attached as owner, and forgotten on detach', () => {
    const p = new ServerPlatform({ userDataDir: '/nonexistent', appVersion: '0' })
    const owner = p.attach(sink, { owner: true })
    const peer = p.attach(sink)
    expect(p.isOwnerClient(owner)).toBe(true)
    expect(p.isOwnerClient(peer)).toBe(false)
    expect(p.isOwnerClient(999)).toBe(false)
    p.detach(owner)
    expect(p.isOwnerClient(owner)).toBe(false)
  })
})

describe('wiring', () => {
  it('the authenticated browser WebSocket attaches as owner', () => {
    expect(src('src/server/ws.ts')).toMatch(/platform\.attach\([\s\S]{0,400}\{ owner: true \}\s*\)/)
  })
  it('this build has no relay-hosted peer attach: ws.ts is the only platform.attach caller', () => {
    // Fork: upstream's index.ts hosted-peer attach (which must stay owner-less) does not exist here.
    // A new attach site must decide the owner flag, so it should fail this test and be looked at.
    expect(src('src/server/index.ts')).not.toContain('platform.attach(')
    expect(src('src/server/ws.ts').match(/platform\.attach\(/g)).toHaveLength(1)
  })
  it('Electron: the main window is the owner, a relay peer never is', () => {
    expect(src('src/main/platform-electron.ts')).toContain(
      'isOwnerClient: (id) => !peerRegistry().has(id) && mainWindowClientIds().includes(id)'
    )
  })
  it('a relay tab drops the remote core\'s origin before applying its mutations', () => {
    const canvas = src('src/renderer/canvas/Canvas.tsx')
    expect(canvas).toContain("const relay = activeSession.source === 'relay'")
    expect(canvas).toContain('const mutation = relay ? withoutCoreOrigin(received) : received')
  })
})
