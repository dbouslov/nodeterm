import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import { WorkspaceStore } from './workspace-store'
import { IPC } from '../shared/ipc'
import type { CanvasNodeState, PendingLaunch, Project, Workspace } from '../shared/types'

/**
 * `pendingLaunch` is machine-local (@shared/node-exec). Through the REAL store:
 *  - an armed node (a cold open into a project nobody is looking at) survives an app restart on
 *    this machine — it lives in workspace.json's `localExec`;
 *  - `.nodeterm/project.json` never carries it;
 *  - a project.json that DOES carry one (a cloned repo, or one written by an older build) is
 *    ignored, including by the one-time legacy migration.
 */

let userData: string
let projRoot: string

const launch: PendingLaunch = { after: ['dep-1'], command: 'claude "the brief"', awaitSetupGroup: 'g1' }
const armedNode: CanvasNodeState = {
  id: 'term-1', kind: 'terminal', position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
  title: 't', color: '#fff', group: null, pendingLaunch: launch
}
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'foo', color: '#7aa2f7', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [armedNode], ...over
})
const ws = (projects: Project[]): Workspace => ({ version: 2, activeProjectId: projects[0].id, projects })
const projectFile = (): Promise<string> => fs.readFile(path.join(projRoot, '.nodeterm/project.json'), 'utf-8')

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ws-pl-'))
  projRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-proj-pl-'))
  initPlatform(fakePlatform({ userDataDir: userData }))
})
afterEach(async () => {
  resetPlatformForTests()
  await fs.rm(userData, { recursive: true, force: true })
  await fs.rm(projRoot, { recursive: true, force: true })
})

describe('an armed node survives an app restart on this machine', () => {
  it('folder project: project.json carries no launch; a FRESH store loads it back', async () => {
    await new WorkspaceStore().save(ws([project({ cwd: projRoot })]))
    const file = await projectFile()
    expect(file).not.toContain('pendingLaunch')
    expect(file).not.toContain('the brief')
    const loaded = await new WorkspaceStore().load()
    expect(loaded.projects[0].nodes[0].pendingLaunch).toEqual(launch)
  })

  it('cwd-less project: same, through its local data file', async () => {
    await new WorkspaceStore().save(ws([project()]))
    const loaded = await new WorkspaceStore().load()
    expect(loaded.projects[0].nodes[0].pendingLaunch).toEqual(launch)
  })

  it('a delivered (cleared) launch stays cleared after the restart', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    await store.save(ws([project({ cwd: projRoot, nodes: [{ ...armedNode, pendingLaunch: undefined }] })]))
    const loaded = await new WorkspaceStore().load()
    expect(loaded.projects[0].nodes[0].pendingLaunch).toBeUndefined()
  })
})

describe('a project.json that carries pendingLaunch is ignored', () => {
  async function writeFileWithLaunch(entryExtra: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.join(projRoot, '.nodeterm'), { recursive: true })
    await fs.writeFile(
      path.join(projRoot, '.nodeterm/project.json'),
      JSON.stringify({
        version: 1, rev: 1, savedAt: new Date(0).toISOString(), id: 'x', name: 'foo', color: '#fff',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [{ ...armedNode, pendingLaunch: { after: [], command: 'touch /tmp/pwned' } }]
      })
    )
    await fs.writeFile(
      path.join(userData, 'workspace.json'),
      JSON.stringify({ version: 3, activeProjectId: 'p1', entries: [{ id: 'p1', name: 'foo', color: '#fff', cwd: projRoot, ...entryExtra }] })
    )
  }

  it('an already-migrated entry (the normal case after this upgrade) does not adopt it', async () => {
    await writeFileWithLaunch({ execMigrated: true })
    const loaded = await new WorkspaceStore().load()
    expect(loaded.projects[0].nodes[0].pendingLaunch).toBeUndefined()
  })

  it('an unmigrated entry (the one-time legacy hoist) does not adopt it either — fail closed', async () => {
    await writeFileWithLaunch({})
    const store = new WorkspaceStore()
    const loaded = await store.load()
    expect(loaded.projects[0].nodes[0].pendingLaunch).toBeUndefined()
    // …and the next save neither blesses it into the local index nor writes it back to the file.
    await store.save(loaded)
    const index = JSON.parse(await fs.readFile(path.join(userData, 'workspace.json'), 'utf-8'))
    expect(JSON.stringify(index)).not.toContain('pwned')
    expect(await projectFile()).not.toContain('pwned')
  })
})

describe('a relay peer\'s workspace:save cannot arm, replace or clear a held launch', () => {
  const OWNER = 1
  const PEER = 1_000_001
  const pwned: PendingLaunch = { after: [], command: 'touch /tmp/pwned' }
  let saveIpc: (senderId: number, ws: Workspace) => Promise<void>

  beforeEach(() => {
    const p = fakePlatform({ userDataDir: userData, isOwnerClient: (id) => id === OWNER })
    initPlatform(p)
    new WorkspaceStore().registerIpc()
    saveIpc = p.handlers[IPC.workspaceSave] as typeof saveIpc
  })

  const loadNode = async (): Promise<CanvasNodeState> => (await new WorkspaceStore().load()).projects[0].nodes[0]
  const plain: CanvasNodeState = { ...armedNode, pendingLaunch: undefined }

  it('a peer-shaped save carrying pendingLaunch does not survive into the loaded node', async () => {
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [{ ...plain, pendingLaunch: pwned }] })]))
    expect((await loadNode()).pendingLaunch).toBeUndefined()
    const index = await fs.readFile(path.join(userData, 'workspace.json'), 'utf-8')
    expect(index).not.toContain('pwned')
  })

  it('cwd-less project: same', async () => {
    await saveIpc(PEER, ws([project({ nodes: [{ ...plain, pendingLaunch: pwned }] })]))
    expect((await loadNode()).pendingLaunch).toBeUndefined()
  })

  it('the owner\'s armed launch is carried across a peer save that replaces or omits it', async () => {
    await saveIpc(OWNER, ws([project({ cwd: projRoot })]))
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [{ ...plain, pendingLaunch: pwned }] })]))
    expect((await loadNode()).pendingLaunch).toEqual(launch)
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [plain] })]))
    expect((await loadNode()).pendingLaunch).toEqual(launch)
  })

  it('the owner\'s own saves still set and clear it', async () => {
    await saveIpc(OWNER, ws([project({ cwd: projRoot })]))
    expect((await loadNode()).pendingLaunch).toEqual(launch)
    await saveIpc(OWNER, ws([project({ cwd: projRoot, nodes: [plain] })]))
    expect((await loadNode()).pendingLaunch).toBeUndefined()
  })

  it('nor can it plant the other exec fields: a shell, or ssh args it marks execTrusted', async () => {
    const ssh = { host: 'h', user: 'u', extraArgs: '-o ProxyCommand=touch /tmp/pwned', execTrusted: true }
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [{ ...plain, shell: '/bin/zsh', ssh }] })]))
    const n = await loadNode()
    expect(n.shell).toBeUndefined()
    expect(n.ssh?.extraArgs).toBeUndefined()
    expect(await fs.readFile(path.join(userData, 'workspace.json'), 'utf-8')).not.toContain('pwned')
    // The owner's own values still persist and survive a peer save.
    await saveIpc(OWNER, ws([project({ cwd: projRoot, nodes: [{ ...plain, shell: '/bin/zsh', ssh }] })]))
    // A peer's copy of an ssh node arrives with the args stripped (and may name another shell).
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [{ ...plain, shell: '/bin/sh', ssh: { host: 'h', user: 'u' } }] })]))
    const kept = await loadNode()
    expect(kept.shell).toBe('/bin/zsh')
    expect(kept.ssh?.extraArgs).toBe(ssh.extraArgs)
  })

  it('a peer save that lands before the store read the index (a restart) keeps the owner\'s launch', async () => {
    await new WorkspaceStore().save(ws([project({ cwd: projRoot })]))
    // `saveIpc` belongs to a store that has neither loaded nor saved: the restarted app.
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [plain] })]))
    expect((await loadNode()).pendingLaunch).toEqual(launch)
  })

  it('an unreadable index refuses that peer save rather than assume there is nothing to carry', async () => {
    await new WorkspaceStore().save(ws([project({ cwd: projRoot })]))
    const indexPath = path.join(userData, 'workspace.json')
    const before = await fs.readFile(indexPath, 'utf-8')
    await fs.writeFile(indexPath, '{ not json')
    await saveIpc(PEER, ws([project({ cwd: projRoot, nodes: [plain] })]))
    expect(await fs.readFile(indexPath, 'utf-8')).toBe('{ not json')
    await fs.writeFile(indexPath, before)
    expect((await loadNode()).pendingLaunch).toEqual(launch)
  })

  it('a pre-file inline entry: the launch is carried from its verbatim `project` copy', async () => {
    // No dataFile: the entry keeps its exec values inside `project`, not `localExec`.
    await fs.writeFile(path.join(userData, 'workspace.json'), JSON.stringify({
      version: 3, activeProjectId: 'p1',
      entries: [{ id: 'p1', name: 'foo', color: '#fff', project: project() }]
    }))
    const store = new WorkspaceStore()
    const p = fakePlatform({ userDataDir: userData, isOwnerClient: (id) => id === OWNER })
    initPlatform(p)
    store.registerIpc()
    await store.load()
    await (p.handlers[IPC.workspaceSave] as typeof saveIpc)(
      PEER, ws([project({ nodes: [{ ...plain, pendingLaunch: pwned }] })]))
    expect((await loadNode()).pendingLaunch).toEqual(launch)
  })
})

describe('a platform that does not know owners (no isOwnerClient)', () => {
  it('treats every workspace:save as untrusted', async () => {
    const p = fakePlatform({ userDataDir: userData })
    initPlatform(p)
    new WorkspaceStore().registerIpc()
    const saveIpc = p.handlers[IPC.workspaceSave] as (senderId: number, ws: Workspace) => Promise<void>
    await saveIpc(1, ws([project({ cwd: projRoot })]))
    expect((await new WorkspaceStore().load()).projects[0].nodes[0].pendingLaunch).toBeUndefined()
    expect(await fs.readFile(path.join(userData, 'workspace.json'), 'utf-8')).not.toContain('the brief')
  })
})
