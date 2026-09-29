import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initPlatform, resetPlatformForTests } from '../../src/core/platform'
import { fakePlatform } from '../../src/core/platform-fake'
import { WorkspaceStore } from '../../src/core/workspace-store'
import { useProjects } from '../../src/renderer/state/projects'
import { armForColdOpen } from '../../src/renderer/lib/projectOpen'
import { planStoredRetire } from '../../src/renderer/lib/retire'
import { launchesToFire } from '../../src/renderer/lib/pendingLaunch'
import { flowToNodeStates, nodeStatesToFlow } from '../../src/renderer/state/workspace'
import type { CanvasNodeState, Project, Workspace } from '../../src/shared/types'

/**
 * Fork backport of upstream 2d3e54cb, end to end: disk → core store → renderer → the launch
 * decision Canvas makes when a project is shown (`launchesToFire`).
 *
 *  - A crafted `.nodeterm/project.json` (a cloned repo) that carries a `pendingLaunch` must not
 *    reach `launchesToFire`, through either way a folder becomes a project: adopting a new folder
 *    (`probeFolder`) and loading one the index already references (`load`).
 *  - The fork's own launch paths must still fire after an app restart: an `open-claude` cold open
 *    (`armForColdOpen`), an `--after` hold, and a `retire --successor` swap that moves an armed
 *    successor in a background project.
 */

let userData: string
let repo: string

const term = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id, kind: 'terminal', position: { x: 0, y: 0 }, size: { width: 600, height: 400 },
  title: id, color: '#fff', group: null, ...extra
})
/** What Canvas's launch effect would type, for a project hydrated as a project load does. */
const fires = (p: Project, status = {}): string[] => {
  const flow = nodeStatesToFlow(p.nodes)
  return launchesToFire(flow as never, status, new Set(flow.map((n) => n.id))).map((l) => l.command)
}
const snapshot = (): Workspace => {
  const st = useProjects.getState()
  return { version: 2, activeProjectId: st.activeProjectId, projects: st.projects }
}

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-plt-ud-'))
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-plt-repo-'))
  initPlatform(fakePlatform({ userDataDir: userData }))
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})
afterEach(async () => {
  resetPlatformForTests()
  await fs.rm(userData, { recursive: true, force: true })
  await fs.rm(repo, { recursive: true, force: true })
})

describe('a cloned repo\'s project.json cannot arm a launch', () => {
  async function plantHostileFile(): Promise<void> {
    await fs.mkdir(path.join(repo, '.nodeterm'), { recursive: true })
    await fs.writeFile(
      path.join(repo, '.nodeterm/project.json'),
      JSON.stringify({
        version: 1, rev: 1, savedAt: new Date(0).toISOString(), id: 'x', name: 'cloned', color: '#fff',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [term('term-evil', { pendingLaunch: { after: [], command: 'touch /tmp/pwned' } })]
      })
    )
  }

  it('adopting the folder (Open Folder on a fresh clone): nothing fires', async () => {
    await plantHostileFile()
    const p = await new WorkspaceStore().probeFolder(repo)
    expect(p?.nodes.map((n) => n.id)).toEqual(['term-evil']) // the node itself still loads
    expect(fires(p!)).toEqual([])
  })

  it('a referenced folder after `git pull` brought the field in: nothing fires', async () => {
    await plantHostileFile()
    await fs.writeFile(
      path.join(userData, 'workspace.json'),
      JSON.stringify({
        version: 3, activeProjectId: 'p1',
        entries: [{ id: 'p1', name: 'cloned', color: '#fff', cwd: repo, execMigrated: true }]
      })
    )
    const loaded = await new WorkspaceStore().load()
    expect(fires(loaded.projects[0])).toEqual([])
  })
})

describe('the fork\'s own launch paths still fire after a restart', () => {
  it('open-claude cold open into a background project', async () => {
    const st = useProjects.getState()
    const bg = st.addProject('bg', repo)
    // A fresh agent node as the factory builds it: the launch rides `initialCommand` until armed.
    const fresh = nodeStatesToFlow([term('term-claude')])[0]
    const built = { ...fresh, data: { ...fresh.data, initialCommand: 'claude "brief"' } }
    st.applyOwnNodeMutation(bg.id, { op: 'upsert', node: flowToNodeStates([armForColdOpen(built)])[0] })
    await new WorkspaceStore().save(snapshot())
    expect(await fs.readFile(path.join(repo, '.nodeterm/project.json'), 'utf-8')).not.toContain('brief')
    const loaded = await new WorkspaceStore().load()
    expect(fires(loaded.projects.find((p) => p.cwd === repo)!)).toEqual(['claude "brief"'])
  })

  it('an --after hold waits for its dep, then fires', async () => {
    const st = useProjects.getState()
    const bg = st.addProject('bg', repo)
    st.applyOwnNodeMutation(bg.id, { op: 'upsert', node: term('term-dep') })
    st.applyOwnNodeMutation(bg.id, {
      op: 'upsert',
      node: term('term-next', { pendingLaunch: { after: ['term-dep'], command: 'claude "next"' } })
    })
    await new WorkspaceStore().save(snapshot())
    const p = (await new WorkspaceStore().load()).projects.find((x) => x.cwd === repo)!
    expect(fires(p, { 'term-dep': { state: 'working' } })).toEqual([])
    expect(fires(p, { 'term-dep': { state: 'done' } })).toEqual(['claude "next"'])
  })

  it('retire --successor in a background project keeps the armed successor\'s launch', async () => {
    const st = useProjects.getState()
    const bg = st.addProject('bg', repo)
    st.applyOwnNodeMutation(bg.id, { op: 'upsert', node: term('term-old', { position: { x: 0, y: 0 } }) })
    st.applyOwnNodeMutation(bg.id, {
      op: 'upsert',
      node: term('term-succ', {
        position: { x: 900, y: 0 },
        pendingLaunch: { after: ['term-dep'], command: 'claude "successor"' }
      })
    })
    const plan = planStoredRetire({
      callerId: 'term-old', successorId: 'term-succ', successorElsewhere: false, kanban: undefined, grid: 20,
      stored: st.getProject(bg.id)!.nodes
    })
    if ('error' in plan) throw new Error(plan.error)
    // Canvas's off-screen retire writes the swap through this exact call (Canvas.tsx, retire verb).
    for (const node of plan.upserts) st.applyNodeMutation(bg.id, { op: 'upsert', node })
    st.applyNodeMutation(bg.id, { op: 'remove', id: 'term-old' })
    const moved = useProjects.getState().getProject(bg.id)!.nodes.find((n) => n.id === 'term-succ')!
    expect(moved.position).toEqual({ x: 0, y: 0 }) // it took the caller's seat
    await new WorkspaceStore().save(snapshot())
    const p = (await new WorkspaceStore().load()).projects.find((x) => x.cwd === repo)!
    expect(fires(p)).toEqual(['claude "successor"']) // term-dep is gone, so the hold is over
  })
})
