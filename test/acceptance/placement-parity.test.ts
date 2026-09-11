import { describe, it, expect } from 'vitest'
import { livePlaceOpened } from '../../src/renderer/lib/livePlacement'
import { coldPlaceBelow, type ColdNode } from '../../src/renderer/lib/coldOpen'
import type { CanvasNode } from '../../src/renderer/state/workspace'
import { placeNode } from '../../src/server/headless-node-factory'
import type { CanvasNodeState, Project } from '../../src/shared/types'

/**
 * PLACEMENT PARITY (spec §9): the three paths that place a node an agent OPENS resolve the same
 * ROOT-space top-left for the same canvas — the live control dispatch (`livePlaceOpened`), the
 * cold open into a project that is not on screen (`coldPlaceBelow`), and the Server Edition's
 * headless factory (`placeNode`). This is the test that stops the three copies from coming back:
 * they already drifted once, when the live path left the source's own frame out of the obstacles
 * and the other two did not, so a framed source's child landed inside the frame on one path and
 * below it on two.
 *
 * It lives in test/acceptance, not src/renderer/lib as the spec wrote it, because it imports
 * renderer AND server code, which production layering forbids inside src/ (vitest.config.ts).
 */

/** One canvas, described once and rendered into each path's own node shape. */
interface Spec {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  parentId?: string
  group?: boolean
}

const liveNodes = (scene: Spec[]): CanvasNode[] =>
  scene.map(
    (n) =>
      ({
        id: n.id,
        type: n.group ? 'group' : 'terminal',
        position: { x: n.x, y: n.y },
        width: n.w ?? 600,
        height: n.h ?? 400,
        ...(n.parentId ? { parentId: n.parentId, extent: 'parent' } : {}),
        data: { title: n.id, color: '#fff', group: null }
      }) as CanvasNode
  )

const coldNodes = (scene: Spec[]): ColdNode[] =>
  scene.map((n) => ({
    id: n.id,
    kind: n.group ? 'group' : 'terminal',
    position: { x: n.x, y: n.y },
    size: { width: n.w ?? 600, height: n.h ?? 400 },
    ...(n.parentId ? { parentId: n.parentId } : {})
  }))

const storedProject = (scene: Spec[]): Project =>
  ({
    id: 'p',
    name: 'P',
    color: '#0a84ff',
    cwd: '/tmp',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: scene.map(
      (n) =>
        ({
          id: n.id,
          kind: n.group ? 'group' : 'terminal',
          position: { x: n.x, y: n.y },
          size: { width: n.w ?? 600, height: n.h ?? 400 },
          title: n.id,
          color: '#fff',
          group: null,
          tags: [],
          ...(n.parentId ? { parentId: n.parentId } : {})
        }) as CanvasNodeState
    ),
    bridges: [],
    ropes: []
  }) as unknown as Project

const SIZE = { w: 600, h: 400 }

/** The same open — node `index` 0 from `source`, waiting on `after` — through all three paths. */
function allThree(scene: Spec[], source: string, after: string[] = []) {
  const live = liveNodes(scene)
  const cold = coldNodes(scene)
  const project = storedProject(scene)
  const center = coldPlaceBelow(cold, cold.find((n) => n.id === source)!, 0, {
    size: SIZE,
    deps: cold.filter((n) => after.includes(n.id))
  })
  return {
    live: livePlaceOpened(live, live.find((n) => n.id === source)!, after, SIZE, 0),
    cold: { x: center.x - SIZE.w / 2, y: center.y - SIZE.h / 2 },
    headless: placeNode(
      project,
      project.nodes.find((n) => n.id === source)!,
      { width: SIZE.w, height: SIZE.h },
      [],
      project.nodes.filter((n) => after.includes(n.id) && n.id !== source)
    )
  }
}

describe('placement parity — live, cold and headless place an opened node identically', () => {
  it.each([
    {
      name: 'a top-level source whose first slot is taken',
      scene: [{ id: 'src', x: 100, y: 100 }, { id: 'busy', x: 100, y: 580 }],
      // below the source (100 + 400 + ROW_GAP 80), one node + PLACEMENT_GAP right of `busy`
      expect: { x: 740, y: 580 }
    },
    {
      name: 'a source inside a frame: the frame is no obstacle, its other children are',
      scene: [
        { id: 'g', x: 1000, y: 1000, w: 1400, h: 1200, group: true },
        { id: 'src', x: 24, y: 56, parentId: 'g' }, // root (1024, 1056)
        { id: 'sib', x: 24, y: 536, parentId: 'g' } // root (1024, 1536): the first slot
      ],
      expect: { x: 1664, y: 1536 }
    },
    {
      name: 'a source two frames deep: every frame up the chain is skipped',
      scene: [
        { id: 'outer', x: 0, y: 0, w: 3000, h: 3000, group: true },
        { id: 'inner', x: 1000, y: 1000, w: 1400, h: 1200, group: true, parentId: 'outer' },
        { id: 'src', x: 24, y: 56, parentId: 'inner' }
      ],
      expect: { x: 1024, y: 1536 }
    }
  ])('$name', ({ scene, expect: at }) => {
    const r = allThree(scene, 'src')
    expect(r.live).toEqual(at)
    expect(r.cold).toEqual(at)
    expect(r.headless).toEqual(at)
  })

  it('an --after dependent: right of its dep on all three paths, from a framed source too', () => {
    const scene: Spec[] = [
      { id: 'g', x: 0, y: 0, w: 1400, h: 1200, group: true },
      { id: 'src', x: 24, y: 56, parentId: 'g' },
      { id: 'dep', x: 3000, y: 200 }
    ]
    const r = allThree(scene, 'src', ['dep'])
    const at = { x: 3000 + 600 + 40, y: 200 }
    expect(r.live).toEqual(at)
    expect(r.cold).toEqual(at)
    expect(r.headless).toEqual(at)
  })
})
