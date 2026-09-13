import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import { WorkspaceStore } from './workspace-store'
import { createPersistTrace } from './persist-trace'
import type { Project, Workspace } from '../shared/types'

let userData: string
let projRoot: string

const project = (cwd: string): Project => ({
  id: 'p1',
  name: 'foo',
  color: '#7aa2f7',
  cwd,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: 'term-1',
      kind: 'terminal',
      position: { x: 0, y: 0 },
      size: { width: 1, height: 1 },
      title: 't',
      color: '#fff',
      group: null
    }
  ]
})
const ws = (projects: Project[]): Workspace => ({ version: 2, activeProjectId: 'p1', projects })

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ws-'))
  projRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-proj-'))
  initPlatform(fakePlatform({ userDataDir: userData }))
})
afterEach(async () => {
  resetPlatformForTests()
  await fs.rm(userData, { recursive: true, force: true })
  await fs.rm(projRoot, { recursive: true, force: true })
})

/** A store whose save decisions go to a real trace file, read back as records. */
async function tracedStore(): Promise<{
  store: WorkspaceStore
  records: () => Promise<Record<string, unknown>[]>
}> {
  const store = new WorkspaceStore()
  await store.load()
  const file = path.join(userData, 'persist-trace.log')
  const trace = createPersistTrace({ file })
  store.onTrace = (ev, fields) => trace.record({ side: 'main', ev, ...fields })
  return {
    store,
    records: async () => {
      await trace.flushed()
      return (await fs.readFile(file, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line.slice(line.indexOf(' ') + 1)) as Record<string, unknown>)
    }
  }
}

describe('the workspace store traces every save decision', () => {
  it('says it received a save before doing anything with it', async () => {
    const { store, records } = await tracedStore()
    await store.save(ws([project(projRoot)]))
    const first = (await records())[0]
    expect(first).toMatchObject({ side: 'main', ev: 'save-received', active: 'p1', projects: 1 })
  })

  it('names a project it skipped as unchanged, and one it wrote', async () => {
    const { store, records } = await tracedStore()
    await store.save(ws([project(projRoot)]))
    await store.save(ws([project(projRoot)]))
    const saves = (await records()).filter((r) => r.ev === 'save')
    expect(saves).toHaveLength(2)
    expect(saves[0]).toMatchObject({ wrote: ['p1'], unchanged: [] })
    expect(saves[1]).toMatchObject({ wrote: [], unchanged: ['p1'] })
  })

  // The one failure that used to leave no trace at all: the folder write is swallowed on purpose
  // (an unmounted disk must not fail the whole save), so the save still resolves — but now says so.
  it('names a project file it could not write, and the save still resolves', async () => {
    await fs.writeFile(path.join(projRoot, '.nodeterm'), 'a file where the folder should be')
    const { store, records } = await tracedStore()
    await expect(store.save(ws([project(projRoot)]))).resolves.toBeUndefined()
    const all = await records()
    const failed = all.find((r) => r.ev === 'file-error')
    expect(failed).toMatchObject({ project: 'p1' })
    expect(String(failed?.code)).toMatch(/^E[A-Z]+$/)
    expect(all.find((r) => r.ev === 'save')).toMatchObject({ wrote: [], unchanged: [] })
  })

  it('knows how long ago it last wrote or read a project canvas', async () => {
    const { store } = await tracedStore()
    await store.save(ws([project(projRoot)]))
    const age = store.persistedAgeMs('p1')
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(60_000)
    expect(store.persistedAgeMs('no-such-project')).toBeUndefined()
  })
})
