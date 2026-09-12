import { describe, it, expect, beforeEach } from 'vitest'
import { IPC } from '../shared/ipc'
import { fakePlatform } from './platform-fake'
import { RETIRE_CONTROL_REFUSAL } from './agents/node-identity-policy'
import {
  forgetPaneOwner,
  paneOwnerProject,
  recordFreshSpawnOwner,
  resetPaneOwnershipForTests
} from './agents/pane-ownership'
import {
  OpenerLedger,
  forgetOnClose,
  recordOpenReply,
  retireRefusal,
  withOpenerLedger,
  type ControlReply
} from './retire-verb'

/** A ledger in which `opener`'s verified open call created `ids`. */
function openedBy(opener: string, ids: string[], verb = 'open-claude'): OpenerLedger {
  const ledger = new OpenerLedger()
  recordOpenReply(ledger, { verb, nodeId: opener, args: {}, verified: true }, { ok: true, result: { ids } })
  return ledger
}

const retire = (
  ledger: OpenerLedger,
  successor: string | undefined,
  nodeId = 'caller',
  verified = true
): string | null =>
  retireRefusal(ledger, { nodeId, args: successor === undefined ? {} : { successor }, verified })

describe('retire --successor: the caller must have opened the successor this app run', () => {
  it('admits a verified caller whose own open call created the successor', () => {
    expect(retire(openedBy('caller', ['succ']), 'succ')).toBeNull()
  })

  it('refuses a successor the caller never opened, naming the ownership rule', () => {
    expect(retire(openedBy('caller', ['succ']), 'stranger')).toMatch(
      /stranger is not a session you opened during this app run/
    )
  })

  it('refuses a successor ANOTHER node opened', () => {
    expect(retire(openedBy('someone-else', ['succ']), 'succ')).toMatch(/not a session you opened/)
  })

  it('fails closed after a restart: a fresh ledger holds no proof', () => {
    expect(retire(new OpenerLedger(), 'succ')).toMatch(/not a session you opened/)
  })

  it('refuses an unverified caller with the strict sentence, even with proof on file', () => {
    expect(retire(openedBy('caller', ['succ']), 'succ', 'caller', false)).toBe(RETIRE_CONTROL_REFUSAL)
  })

  it('refuses a missing --successor, and a successor that is the caller itself', () => {
    const ledger = openedBy('caller', ['succ'])
    expect(retire(ledger, undefined)).toBe('retire requires --successor <id>')
    expect(retire(ledger, '  ')).toBe('retire requires --successor <id>')
    expect(retire(ledger, 'caller')).toMatch(/names you/)
  })
})

describe('what counts as proof: a verified open-* call that created the node', () => {
  it('records every id of an open-terminal / open-claude / open-agent reply', () => {
    for (const verb of ['open-terminal', 'open-claude', 'open-agent']) {
      const ledger = openedBy('caller', ['a', 'b'], verb)
      expect(ledger.opened('caller', 'a'), verb).toBe(true)
      expect(ledger.opened('caller', 'b'), verb).toBe(true)
    }
  })

  it('records nothing for an unverified caller, a failed open, a dry run, a malformed reply or another verb', () => {
    const ledger = new OpenerLedger()
    const ok = { ok: true, result: { ids: ['x'] } }
    const req = { verb: 'open-claude', nodeId: 'c', args: {}, verified: true }
    recordOpenReply(ledger, { ...req, verified: false }, ok)
    recordOpenReply(ledger, req, { ok: false, result: { ids: ['x'] } })
    recordOpenReply(ledger, { ...req, args: { 'dry-run': '' } }, ok)
    recordOpenReply(ledger, req, { ok: true, result: { ids: 'x' } })
    recordOpenReply(ledger, req, { ok: true })
    for (const verb of ['open-browser', 'show-web', 'spawn-team', 'retire', 'list']) {
      recordOpenReply(ledger, { ...req, verb }, ok)
    }
    expect(ledger.opened('c', 'x')).toBe(false)
  })
})

describe('the proof survives a park cycle and ends only with a real close', () => {
  beforeEach(() => resetPaneOwnershipForTests())

  it('the successor parked and re-mounted keeps its proof — retire still succeeds', () => {
    const platform = fakePlatform()
    const ledger = openedBy('caller', ['succ'])
    forgetOnClose(platform, ledger)
    // An off-screen park kills the PTY client (IPC.ptyKill — the tmux session survives, attached=0)
    // and the re-mount creates one again (IPC.ptyCreate, an attach). A restart recycles
    // (IPC.ptyRecycle). The ledger listens to none of them: only a real close ends the proof.
    expect(Object.keys(platform.listeners)).toEqual([IPC.ptyDestroy])
    expect(platform.senderListeners).toEqual({})
    expect(platform.handlers).toEqual({})
    // Nor may retire consult the pane registry, which a session end clears and an attach never
    // refills: with the successor's pane entry gone, retire must still succeed.
    recordFreshSpawnOwner('succ', 'project-1')
    forgetPaneOwner('succ')
    expect(paneOwnerProject('succ')).toBeUndefined()
    expect(retire(ledger, 'succ')).toBeNull()
  })

  it('a real close of the successor drops its proof, and only its', () => {
    const platform = fakePlatform()
    const ledger = openedBy('caller', ['succ', 'other'])
    forgetOnClose(platform, ledger)
    platform.listeners[IPC.ptyDestroy]('succ')
    expect(retire(ledger, 'succ')).toMatch(/not a session you opened/)
    expect(retire(ledger, 'other')).toBeNull()
  })

  it('a real close of the opener drops every proof it held', () => {
    const platform = fakePlatform()
    const ledger = openedBy('caller', ['succ'])
    forgetOnClose(platform, ledger)
    platform.listeners[IPC.ptyDestroy]('caller')
    expect(ledger.opened('caller', 'succ')).toBe(false)
  })
})

describe("main's wiring: the gate runs before the renderer round-trip, the record after it", () => {
  /** A stand-in for main's forward to the renderer, counting whether it ran. */
  function forwarding(reply: ControlReply): { ran: () => number; forward: () => Promise<ControlReply> } {
    let n = 0
    return {
      ran: () => n,
      forward: async () => {
        n++
        return reply
      }
    }
  }
  const req = (verb: string, args: Record<string, string>, verified = true) => ({
    verb,
    nodeId: 'caller',
    args,
    verified
  })

  it('never forwards a refused retire, so the renderer never moves or closes anything', async () => {
    const f = forwarding({ ok: true })
    const reply = await withOpenerLedger(new OpenerLedger(), req('retire', { successor: 'succ' }), f.forward)
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/not a session you opened/)
    expect(f.ran()).toBe(0)
  })

  it("records an open call on the way back, then forwards that caller's retire into it", async () => {
    const ledger = new OpenerLedger()
    await withOpenerLedger(ledger, req('open-agent', { agent: 'claude' }), async () => ({
      ok: true,
      result: { ids: ['succ'] }
    }))
    const f = forwarding({ ok: true, message: 'retired' })
    expect(await withOpenerLedger(ledger, req('retire', { successor: 'succ' }), f.forward)).toEqual({
      ok: true,
      message: 'retired'
    })
    expect(f.ran()).toBe(1)
  })

  it('forwards an unverified open, but it proves nothing', async () => {
    const ledger = new OpenerLedger()
    const open = forwarding({ ok: true, result: { ids: ['succ'] } })
    await withOpenerLedger(ledger, req('open-claude', {}, false), open.forward)
    expect(open.ran()).toBe(1)
    expect(ledger.opened('caller', 'succ')).toBe(false)
  })

  it('passes every other verb straight through', async () => {
    const f = forwarding({ ok: true, message: 'moved' })
    expect(await withOpenerLedger(new OpenerLedger(), req('move', { nodes: 'a' }), f.forward)).toEqual({
      ok: true,
      message: 'moved'
    })
    expect(f.ran()).toBe(1)
  })
})
