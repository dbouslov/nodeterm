// `pendingLaunch` across the live canvas (applyMutationToFlow), the background-project store
// (applyNodeMutation / applyOwnNodeMutation), and two Server Edition tabs sharing one core.
//
// The launch is machine-local (@shared/node-exec): a peer or relay guest may never set, replace or
// clear it. Two OWNER tabs, though, must still agree on who claimed a launch, or both would type it
// — so the core forwards an owner's copy to the other owners with `origin: 'core'`, and that copy
// is authoritative. These tests pin both halves, including exactly-once.
import { describe, it, expect, beforeEach } from 'vitest'
import { applyMutationToFlow, nodeStatesToFlow, flowToNodeStates, type CanvasNode } from './workspace'
import { useProjects } from './projects'
import { sanitizeInboundMutation, stripCastNodeExec } from '@shared/node-exec'
import { launchesToFire } from '../lib/pendingLaunch'
import type { CanvasMutation, CanvasNodeState, PendingLaunch } from '@shared/types'

const armed: PendingLaunch = { after: [], command: 'claude "brief"' }
const state = (over: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id: 'n1',
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 480, height: 320 },
  title: 'n1',
  color: '#fff',
  group: null,
  ...over
})
const flow = (s: CanvasNodeState): CanvasNode[] => nodeStatesToFlow([s])

describe('applyMutationToFlow (live canvas)', () => {
  it('a peer upsert carrying a launch neither arms a node nor replaces ours', () => {
    const fresh = applyMutationToFlow([], { op: 'upsert', node: state({ pendingLaunch: { after: [], command: 'evil' } }) })
    expect(fresh[0].data.pendingLaunch).toBeUndefined()
    const mine = flow(state({ pendingLaunch: armed }))
    const moved = applyMutationToFlow(mine, { op: 'upsert', node: state({ position: { x: 9, y: 9 } }) })
    expect(moved[0].data.pendingLaunch).toEqual(armed)
    expect(moved[0].position).toEqual({ x: 9, y: 9 })
  })
  it('a relay guest keeps its own launch through the host\'s stripped echo', () => {
    // The host strips the guest's launch before reflecting; the guest's own live copy survives.
    const guest = flow(state({ pendingLaunch: armed }))
    const echo = applyMutationToFlow(guest, { op: 'upsert', node: state(), seq: 4 })
    expect(echo[0].data.pendingLaunch).toEqual(armed)
  })
  it('a core-vouched copy sets and clears', () => {
    const mine = flow(state({ pendingLaunch: armed }))
    const cleared = applyMutationToFlow(mine, { op: 'upsert', node: state(), origin: 'core' })
    expect(cleared[0].data.pendingLaunch).toBeUndefined()
  })
})

describe('projects store (a project not on screen)', () => {
  beforeEach(() => useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] }))
  it('patchStored(..., undefined) through applyOwnNodeMutation CLEARS the launch', () => {
    const p = useProjects.getState().addProject('p', '/tmp/p')
    useProjects.getState().commitCanvas(p.id, [state({ pendingLaunch: armed })], { x: 0, y: 0, zoom: 1 })
    const stored = useProjects.getState().getProject(p.id)!.nodes[0]
    expect(useProjects.getState().applyOwnNodeMutation(p.id, { op: 'upsert', node: { ...stored, pendingLaunch: undefined } })).toBe(true)
    expect(useProjects.getState().getProject(p.id)!.nodes[0].pendingLaunch).toBeUndefined()
  })
  it('a cold open through applyOwnNodeMutation keeps the launch it moved into pendingLaunch', () => {
    const p = useProjects.getState().addProject('p', '/tmp/p')
    useProjects.getState().applyOwnNodeMutation(p.id, { op: 'upsert', node: state({ pendingLaunch: armed }) })
    expect(useProjects.getState().getProject(p.id)!.nodes[0].pendingLaunch).toEqual(armed)
  })
  it('the peer path (applyNodeMutation) can neither plant nor clear one', () => {
    const p = useProjects.getState().addProject('p', '/tmp/p')
    useProjects.getState().applyNodeMutation(p.id, { op: 'upsert', node: state({ id: 'x', pendingLaunch: armed }) })
    expect(useProjects.getState().getProject(p.id)!.nodes[0].pendingLaunch).toBeUndefined()
    useProjects.getState().applyOwnNodeMutation(p.id, { op: 'upsert', node: state({ pendingLaunch: armed }) })
    useProjects.getState().applyNodeMutation(p.id, { op: 'upsert', node: state() })
    expect(useProjects.getState().getProject(p.id)!.nodes.find((n) => n.id === 'n1')!.pendingLaunch).toEqual(armed)
  })
})

describe('two owner tabs on one Server Edition core: a launch is typed exactly once', () => {
  /** Tab A delivers the launch and clears it (this build has no write-ahead `attempted`/`manualOnly`
   *  claim; the clear is the claim) and casts it; the core fans it out; tab B applies what it
   *  received. Returns B's canvas afterwards. */
  function claimReachesB(bIsOwner: boolean): CanvasNode[] {
    const tabB = flow(state({ pendingLaunch: armed }))
    const claimed = stripCastNodeExec(flowToNodeStates(flow(state({}))))[0]
    // What the core's reflector sends tab B (pinned in core/canvas-sync.pending-launch.test.ts):
    // an owner recipient gets the owner's copy vouched with origin 'core'; anyone else gets it
    // stripped of the launch.
    const cast: CanvasMutation = { op: 'upsert', node: claimed, src: 'cv-a', seq: 1 }
    const delivered: CanvasMutation[] = [bIsOwner ? { ...cast, origin: 'core' } : sanitizeInboundMutation(cast)]
    return applyMutationToFlow(tabB, delivered[0])
  }
  it('an owner tab B sees A\'s claim and does not fire', () => {
    const b = claimReachesB(true)
    expect(b[0].data.pendingLaunch).toBeUndefined()
    expect(launchesToFire(b as never, {}, new Set(['n1']))).toEqual([])
  })
  it('control: a tab that did NOT receive the claim would fire it a second time', () => {
    const b = claimReachesB(false)
    expect(launchesToFire(b as never, {}, new Set(['n1'])).map((l) => l.id)).toEqual(['n1'])
  })
})
