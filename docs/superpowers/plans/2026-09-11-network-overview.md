# Network Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents write a role and a recommendation per node through a verified-only `annotate` verb, and a full-page overview renders every node's role, live status, edges, groups and a findings sidebar.

**Architecture:** A new `annotation` field on `CanvasNodeState` (validated at both serializer seams, persisted in `.nodeterm/project.json`). One shared parse/apply helper feeds the renderer dispatch and the Server Edition headless factory. A pure findings engine (`renderer/lib/networkOverview.ts`) turns serialized nodes + status into React Flow nodes/edges plus a findings list. `NetworkOverviewView` is a third `ProjectView` rendered as a full-page overlay with its own read-only React Flow instance.

**Tech Stack:** TypeScript, React 18, `@xyflow/react` (React Flow 12), zustand, vitest (node by default; jsdom via per-file pragma for component tests).

**Spec:** `docs/superpowers/specs/2026-09-11-network-overview-design.md`

## Global Constraints

- `role` ≤ 80 chars, `recommend` ≤ 500 chars, both collapsed to one line with `oneLine` from `@shared/one-line`.
- `annotate` is verified-only (`requiresVerified`), not destructive, not dry-run, store-answered (never switches project or moves the camera).
- Bulk `--node a,b,c`: cap 50 ids; the WHOLE list is refused on one unknown id, naming it.
- Idle threshold = `settings.agentHibernationIdleMinutes * 60_000`. A missing `stateAt` never flags idle.
- `hideFanout` is ignored by the overview. Ephemeral `subagent`/`loop` cards are not drawn.
- Group without a lead = group with ≥ 2 direct-child agent nodes and no child whose role matches `/\b(lead|orchestrator|hub)\b/i`.
- The kanban tag migration (`renderer/lib/kanban.ts` `migrateProjectTags`) must keep touching only `tags`. Never write to `data.tags`.
- Every new test file for a component carries `// @vitest-environment jsdom` on line 1 (vitest default is `node`, `vitest.config.ts:15`).
- No `fitView` from anything automatic on the MAIN canvas (CLAUDE.md "Go to node"). The overview's own React Flow instance may `fitView` on mount because it is a separate instance.
- Commit after every task with the attribution lines from the session (`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01Rj19FEFudwjwGQAyCEbq7X`).
- Run `npm run typecheck` before each commit that touches TypeScript.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/node-annotation.ts` (new) | `NodeAnnotation` type, caps, `normalizeNodeAnnotation`, `applyAnnotation`, `parseAnnotateArgs` |
| `src/shared/node-annotation.test.ts` (new) | tests for the three pure functions |
| `src/shared/types.ts` | `CanvasNodeState.annotation?` |
| `src/renderer/state/workspace.ts` | both seams normalize `annotation` |
| `src/renderer/state/workspace.test.ts` | seam tests |
| `src/renderer/lib/reopenNode.ts` | `annotation` joins `COSMETIC_KEYS` |
| `src/core/canvas-control-core.ts` | verb union, VERBS, parse, shim positional list, both doc bodies |
| `src/main/canvas-control-core.test.ts` | parse + doc pins |
| `src/core/agents/hook-server.ts` | `requiresVerified` + refusal text |
| `src/core/agents/messaging-verified-only.test.ts` | set pin |
| `src/renderer/lib/controlRouting.ts` | `STORE_ANSWERED_VERBS`, `storedNodeListing` role |
| `src/renderer/lib/controlRouting.test.ts` | pins |
| `src/renderer/canvas/Canvas.tsx` | `case 'annotate'` (active + non-active), `list` role suffix, view wiring, minimap button |
| `src/server/control-unsupported.ts` | `SERVER_V1_VERBS`, interface, switch |
| `src/server/headless-node-factory.ts` | `annotate` method |
| `src/server/canvas-control.ts` | action wiring |
| `src/server/headless-node-factory.test.ts` | annotate tests |
| `src/renderer/lib/networkOverview.ts` (new) | `buildFindings`, `buildOverviewGraph`, `overviewSig` |
| `src/renderer/lib/networkOverview.test.ts` (new) | engine tests |
| `src/renderer/state/viewMode.ts` | `'overview'` view, `isOverviewOpen`, `isOverlayViewOpen`, `setView` |
| `src/renderer/state/viewMode.test.ts` | pins |
| `src/renderer/components/overview/NetworkOverviewView.tsx` (new) | overlay: header, graph, findings sidebar |
| `src/renderer/components/overview/OverviewNodes.tsx` (new) | `ovNode`, `ovGroup` node components |
| `src/renderer/components/overview/NetworkOverviewView.test.tsx` (new) | smoke render |
| `src/renderer/styles.css` | `.overview-*`, `.minimap-expand` |
| `src/shared/keybindings.ts` | `view.overviewToggle` |
| `CLAUDE.md` | two paragraphs |

---

### Task 1: `NodeAnnotation` type and pure helpers

**Files:**
- Create: `src/shared/node-annotation.ts`
- Create: `src/shared/node-annotation.test.ts`

**Interfaces:**
- Produces: `NodeAnnotation`, `ANNOTATION_ROLE_MAX = 80`, `ANNOTATION_RECOMMEND_MAX = 500`, `ANNOTATE_BULK_MAX = 50`, `normalizeNodeAnnotation(raw: unknown): NodeAnnotation | undefined`, `parseAnnotateArgs(args: Record<string, string | undefined>): AnnotateArgs | { error: string }`, `applyAnnotation(existing: NodeAnnotation | undefined, parsed: AnnotateArgs, by: string, now: number): NodeAnnotation | undefined`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/node-annotation.test.ts
import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_RECOMMEND_MAX,
  ANNOTATION_ROLE_MAX,
  applyAnnotation,
  normalizeNodeAnnotation,
  parseAnnotateArgs
} from './node-annotation'

describe('normalizeNodeAnnotation', () => {
  it('keeps a well-formed record', () => {
    expect(normalizeNodeAnnotation({ role: 'lead', recommend: 'close it', by: 'n1', at: 5 })).toEqual({
      role: 'lead',
      recommend: 'close it',
      by: 'n1',
      at: 5
    })
  })
  it('drops non-objects and records missing by/at', () => {
    expect(normalizeNodeAnnotation('lead')).toBeUndefined()
    expect(normalizeNodeAnnotation(null)).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', at: 5 })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: 'n1' })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: 'n1', at: 'now' })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: 'lead', by: '', at: 5 })).toBeUndefined()
  })
  it('drops a record with neither role nor recommend after cleaning', () => {
    expect(normalizeNodeAnnotation({ by: 'n1', at: 5 })).toBeUndefined()
    expect(normalizeNodeAnnotation({ role: '   ', recommend: 7, by: 'n1', at: 5 })).toBeUndefined()
  })
  it('collapses to one line and truncates to the caps', () => {
    const a = normalizeNodeAnnotation({
      role: ' a\nb '.padEnd(200, 'x'),
      recommend: 'r'.repeat(900),
      by: 'n1',
      at: 5
    })!
    expect(a.role).toHaveLength(ANNOTATION_ROLE_MAX)
    expect(a.role.startsWith('a b')).toBe(true)
    expect(a.recommend).toHaveLength(ANNOTATION_RECOMMEND_MAX)
  })
})

describe('parseAnnotateArgs', () => {
  it('requires --node and one of --role/--recommend/--clear', () => {
    expect(parseAnnotateArgs({})).toEqual({ error: 'annotate requires --node <id,id>' })
    expect(parseAnnotateArgs({ node: 'a' })).toEqual({ error: 'annotate: nothing to write (pass --role, --recommend or --clear)' })
  })
  it('splits, trims and dedupes ids and caps the list', () => {
    expect(parseAnnotateArgs({ node: ' a, b ,a', role: 'x' })).toEqual({
      ids: ['a', 'b'],
      role: 'x',
      recommend: undefined,
      clear: false
    })
    const many = Array.from({ length: 51 }, (_, i) => `n${i}`).join(',')
    expect(parseAnnotateArgs({ node: many, clear: '' })).toEqual({ error: 'annotate: at most 50 ids per call' })
  })
  it('reads --clear as a valueless flag', () => {
    expect(parseAnnotateArgs({ node: 'a', clear: '' })).toEqual({ ids: ['a'], role: undefined, recommend: undefined, clear: true })
    expect(parseAnnotateArgs({ node: 'a', clear: 'yes', role: 'r' })).toEqual({ ids: ['a'], role: 'r', recommend: undefined, clear: true })
  })
  it('refuses unknown flags', () => {
    expect(parseAnnotateArgs({ node: 'a', role: 'r', title: 't' })).toEqual({ error: 'annotate: unknown flag --title' })
  })
})

describe('applyAnnotation', () => {
  const now = 1000
  it('writes a fresh record with by/at', () => {
    expect(applyAnnotation(undefined, { ids: ['a'], role: 'lead', recommend: undefined, clear: false }, 'hub', now)).toEqual({
      role: 'lead',
      by: 'hub',
      at: now
    })
  })
  it('leaves an absent flag untouched without --clear', () => {
    const prev = { role: 'lead', recommend: 'old', by: 'x', at: 1 }
    expect(applyAnnotation(prev, { ids: ['a'], role: undefined, recommend: 'new', clear: false }, 'hub', now)).toEqual({
      role: 'lead',
      recommend: 'new',
      by: 'hub',
      at: now
    })
  })
  it('--clear alone removes; --clear with --role keeps only the role', () => {
    const prev = { role: 'lead', recommend: 'old', by: 'x', at: 1 }
    expect(applyAnnotation(prev, { ids: ['a'], role: undefined, recommend: undefined, clear: true }, 'hub', now)).toBeUndefined()
    expect(applyAnnotation(prev, { ids: ['a'], role: 'tests', recommend: undefined, clear: true }, 'hub', now)).toEqual({
      role: 'tests',
      by: 'hub',
      at: now
    })
  })
  it('normalizes what it writes (caps, one line)', () => {
    const a = applyAnnotation(undefined, { ids: ['a'], role: 'x\ny'.padEnd(100, 'z'), recommend: undefined, clear: false }, 'hub', now)!
    expect(a.role).toHaveLength(ANNOTATION_ROLE_MAX)
    expect(a.role.startsWith('x y')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/node-annotation.test.ts`
Expected: FAIL, "Cannot find module './node-annotation'".

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/node-annotation.ts
// A node's ROLE and a RECOMMENDATION about it, written by an agent through the `annotate` verb
// (spec: docs/superpowers/specs/2026-09-11-network-overview-design.md §1-2). CONTENT, like sticky
// text: it rides .nodeterm/project.json and is therefore hostile input on every read — normalize at
// both serializer seams, exactly as `normalizeNodeIcon` does. Zero-import leaf apart from oneLine.
import { oneLine } from './one-line'

export interface NodeAnnotation {
  /** One line, at most ANNOTATION_ROLE_MAX characters. */
  role?: string
  /** One line, at most ANNOTATION_RECOMMEND_MAX characters. */
  recommend?: string
  /** Node id of the verified caller that last wrote the record. */
  by: string
  /** Epoch ms of the last write. */
  at: number
}

export const ANNOTATION_ROLE_MAX = 80
export const ANNOTATION_RECOMMEND_MAX = 500
export const ANNOTATE_BULK_MAX = 50

function cleanLine(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = oneLine(raw).slice(0, max)
  return s ? s : undefined
}

/**
 * Validate an annotation read from a persisted (hostile) source. Returns the value to keep, or
 * undefined — no annotation, i.e. the pre-feature node. Never throws, never substitutes.
 */
export function normalizeNodeAnnotation(raw: unknown): NodeAnnotation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as { role?: unknown; recommend?: unknown; by?: unknown; at?: unknown }
  if (typeof v.by !== 'string' || !v.by) return undefined
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return undefined
  const role = cleanLine(v.role, ANNOTATION_ROLE_MAX)
  const recommend = cleanLine(v.recommend, ANNOTATION_RECOMMEND_MAX)
  if (!role && !recommend) return undefined
  return { ...(role ? { role } : {}), ...(recommend ? { recommend } : {}), by: v.by, at: v.at }
}

export interface AnnotateArgs {
  ids: string[]
  role: string | undefined
  recommend: string | undefined
  clear: boolean
}

const ANNOTATE_FLAGS: ReadonlySet<string> = new Set(['node', 'role', 'recommend', 'clear'])

/** Pure parse of the verb's flags. Shared by the renderer dispatch and the Server Edition factory. */
export function parseAnnotateArgs(
  args: Record<string, string | undefined>
): AnnotateArgs | { error: string } {
  const unknown = Object.keys(args).find((k) => !ANNOTATE_FLAGS.has(k))
  if (unknown) return { error: `annotate: unknown flag --${unknown}` }
  if (!args.node) return { error: 'annotate requires --node <id,id>' }
  const ids = [...new Set(args.node.split(',').map((s) => s.trim()).filter(Boolean))]
  if (!ids.length) return { error: 'annotate requires --node <id,id>' }
  if (ids.length > ANNOTATE_BULK_MAX) return { error: `annotate: at most ${ANNOTATE_BULK_MAX} ids per call` }
  const clear = args.clear !== undefined
  const role = args.role
  const recommend = args.recommend
  if (role === undefined && recommend === undefined && !clear) {
    return { error: 'annotate: nothing to write (pass --role, --recommend or --clear)' }
  }
  return { ids, role, recommend, clear }
}

/**
 * The write rule (spec §2): without --clear an absent flag leaves that half untouched; with
 * --clear only the flags given survive. Returns undefined when nothing is left, which removes the
 * annotation from the node.
 */
export function applyAnnotation(
  existing: NodeAnnotation | undefined,
  parsed: AnnotateArgs,
  by: string,
  now: number
): NodeAnnotation | undefined {
  const base = parsed.clear ? {} : { role: existing?.role, recommend: existing?.recommend }
  const role = parsed.role !== undefined ? parsed.role : base.role
  const recommend = parsed.recommend !== undefined ? parsed.recommend : base.recommend
  return normalizeNodeAnnotation({ role, recommend, by, at: now })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/node-annotation.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/node-annotation.ts src/shared/node-annotation.test.ts
git commit -m "feat(annotation): NodeAnnotation type with normalize/parse/apply helpers"
```

---

### Task 2: Persist `annotation` through both serializer seams

**Files:**
- Modify: `src/shared/types.ts:372-377` (beside `icon`)
- Modify: `src/renderer/state/workspace.ts:1922` and `:2003`
- Modify: `src/renderer/lib/reopenNode.ts:12-14`
- Test: `src/renderer/state/workspace.test.ts` (after the `node icon serialization` describe, ~line 690)

**Interfaces:**
- Consumes: `normalizeNodeAnnotation` (Task 1).
- Produces: `CanvasNodeState.annotation?: NodeAnnotation`; live node `data.annotation` on `CanvasNode`.

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/state/workspace.test.ts`, copying the icon harness shape:

```ts
describe('node annotation serialization', () => {
  const withAnnotation = (annotation: unknown): CanvasNode =>
    ({
      id: 't1',
      type: 'terminal',
      position: { x: 0, y: 0 },
      width: 320,
      height: 240,
      data: { title: 'T', color: '#888', group: null, annotation }
    }) as unknown as CanvasNode

  const stateWith = (annotation: unknown) => ({
    id: 't1',
    kind: 'terminal' as const,
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
    title: 'T',
    color: '#888',
    group: null,
    annotation
  })

  it('round-trips a well-formed annotation', () => {
    const a = { role: 'lead', recommend: 'close', by: 'hub', at: 5 }
    const states = flowToNodeStates([withAnnotation(a)])
    expect(states[0].annotation).toEqual(a)
    expect(nodeStatesToFlow(states)[0].data.annotation).toEqual(a)
  })

  it('leaves a node without one undefined', () => {
    expect(flowToNodeStates([withAnnotation(undefined)])[0].annotation).toBeUndefined()
    expect('annotation' in flowToNodeStates([withAnnotation(undefined)])[0]).toBe(true)
  })

  it('drops a hostile annotation on the way IN', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hydrate = (a: unknown) => nodeStatesToFlow([stateWith(a) as any])[0].data.annotation
    expect(hydrate('lead')).toBeUndefined()
    expect(hydrate({ role: 'lead' })).toBeUndefined()
    expect(hydrate({ role: 'x'.repeat(200), by: 'hub', at: 1 })).toEqual({ role: 'x'.repeat(80), by: 'hub', at: 1 })
  })

  it('drops a hostile annotation on the way OUT', () => {
    expect(flowToNodeStates([withAnnotation({ role: 'lead', at: 1 })])[0].annotation).toBeUndefined()
    expect(flowToNodeStates([withAnnotation({ by: 'hub', at: 1 })])[0].annotation).toBeUndefined()
  })
})
```

And in `src/renderer/lib/reopenNode.test.ts` (find the existing test that checks a cosmetic key like `color` survives reopen and add beside it):

```ts
  it('keeps the annotation on reopen', () => {
    const snap = snapshotOf({ type: 'terminal', data: { title: 'T', color: '#888', group: null, annotation: { role: 'lead', by: 'hub', at: 1 } } })
    expect(buildNodeFromSnapshot(snap)?.data.annotation).toEqual({ role: 'lead', by: 'hub', at: 1 })
  })
```
(Use the file's own snapshot-building helper name and reopen entry point; the two names above are placeholders for whatever that test file already calls them. Read `reopenNode.test.ts` first and match its harness.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/state/workspace.test.ts src/renderer/lib/reopenNode.test.ts`
Expected: FAIL: `annotation` is `undefined` on the way in and out; reopen test fails on `undefined`.

- [ ] **Step 3: Implement**

`src/shared/types.ts`, immediately after the `icon?` field (line ~377):

```ts
  /**
   * An agent-written role + recommendation (the `annotate` verb; spec 2026-09-11-network-overview).
   * CONTENT like `text`: git-shared, validated at both serializer seams. Absent = pre-feature node.
   */
  annotation?: import('./node-annotation').NodeAnnotation
```

`src/renderer/state/workspace.ts`: add the import beside the icon one (`import { normalizeNodeAnnotation } from '@shared/node-annotation'`), then in `nodeStatesToFlow` after `icon: normalizeNodeIcon(n.icon),`:

```ts
        annotation: normalizeNodeAnnotation(n.annotation),
```

and in `flowToNodeStates` after `icon: normalizeNodeIcon(n.data.icon),`:

```ts
        annotation: normalizeNodeAnnotation(n.data.annotation),
```

`src/renderer/lib/reopenNode.ts:12-14`: add `'annotation'` to `COSMETIC_KEYS`:

```ts
const COSMETIC_KEYS = [
  'title', 'titleAuto', 'color', 'group', 'tags', 'collapsed', 'expandedHeight', 'shell', 'agentModel', 'annotation'
] as const
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/state/workspace.test.ts src/renderer/lib/reopenNode.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/renderer/state/workspace.ts src/renderer/state/workspace.test.ts src/renderer/lib/reopenNode.ts src/renderer/lib/reopenNode.test.ts
git commit -m "feat(annotation): persist node annotation through both serializer seams"
```

---

### Task 3: Register the `annotate` verb in the control model

**Files:**
- Modify: `src/core/canvas-control-core.ts:99-130` (union), `:137-172` (VERBS), `:240-255` (parse), `:618` (shim positional list), doc lines near `:427` and `:928`
- Modify: `src/core/agents/hook-server.ts:223-251`
- Modify: `src/renderer/lib/controlRouting.ts:115-121`
- Test: `src/main/canvas-control-core.test.ts`, `src/core/agents/messaging-verified-only.test.ts:140-158`, `src/renderer/lib/controlRouting.test.ts`

**Interfaces:**
- Consumes: `parseAnnotateArgs` (Task 1).
- Produces: `'annotate'` in `ControlVerb`; `parseControlRequest('annotate', args)` returns `{verb:'annotate', args}` or `{error}`; `requiresVerified.has('annotate') === true`; `needsLiveCanvas('annotate') === false`; `ANNOTATE_CONTROL_REFUSAL = 'Annotation write refused.'`.

- [ ] **Step 1: Write the failing tests**

`src/main/canvas-control-core.test.ts`, beside the sticky tests:

```ts
  it('annotate requires --node plus one of --role/--recommend/--clear, and is not destructive', () => {
    expect(parseControlRequest('annotate', {})).toEqual({ error: 'annotate requires --node <id,id>' })
    expect(parseControlRequest('annotate', { node: 'n1' })).toEqual({
      error: 'annotate: nothing to write (pass --role, --recommend or --clear)'
    })
    expect(parseControlRequest('annotate', { node: 'n1,n2', role: 'lead' })).toEqual({
      verb: 'annotate',
      args: { node: 'n1,n2', role: 'lead' }
    })
    expect(parseControlRequest('annotate', { node: 'n1', clear: '' })).toEqual({
      verb: 'annotate',
      args: { node: 'n1', clear: '' }
    })
    expect(parseControlRequest('annotate', { node: 'n1', role: 'r', title: 't' })).toEqual({
      error: 'annotate: unknown flag --title'
    })
    expect(isDestructiveVerb('annotate')).toBe(false)
  })

  it('the shim maps a bare positional onto arg.node for annotate too', () => {
    expect(CONTROL_SHIM_SCRIPT).toContain('write|close|rename|color|branch|send|reply|sticky|annotate)')
  })

  it('both agent-facing texts document the annotate verb', () => {
    for (const body of [buildCanvasSkillBody('/x/shim.sh'), buildCanvasControlInstructions('/tmp/nodeterm.sh')]) {
      expect(body).toContain('`annotate --node <id,id> [--role "…"] [--recommend "…"] [--clear]`')
      expect(body).toContain('--clear')
    }
  })
```

`src/core/agents/messaging-verified-only.test.ts:140-158`: change the expected sorted list to

```ts
    expect([...requiresVerified].sort()).toEqual([
      'annotate',
      'notify',
      'open-project',
      'reply',
      'send',
      'sticky'
    ])
```

and add next to it:

```ts
  it('names the annotate refusal for what it refused', () => {
    expect(verifiedRefusalFor('annotate')).toBe('Annotation write refused.')
  })
```
(import `verifiedRefusalFor` from `./hook-server` if the file does not already.)

`src/renderer/lib/controlRouting.test.ts`, beside the sticky case:

```ts
  it('is false for annotate — a Hub tagging stations must never travel the camera', () => {
    expect(needsLiveCanvas('annotate')).toBe(false)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/canvas-control-core.test.ts src/core/agents/messaging-verified-only.test.ts src/renderer/lib/controlRouting.test.ts`
Expected: FAIL on `unknown verb` / set mismatch / `needsLiveCanvas('annotate') === true`.

- [ ] **Step 3: Implement**

`src/core/canvas-control-core.ts`:

1. Add `| 'annotate'` to the `ControlVerb` union after `'sticky'`, and `'annotate',` to `VERBS` after `'sticky',`.
2. Add the import at the top: `import { parseAnnotateArgs } from '../shared/node-annotation'`.
3. In `parseControlRequest`, after the sticky checks:

```ts
  if (v === 'annotate') {
    const parsed = parseAnnotateArgs(args)
    if ('error' in parsed) return { error: parsed.error }
  }
```

4. Shim positional list (line 618): change `write|close|rename|color|branch|send|reply|sticky)` to `write|close|rename|color|branch|send|reply|sticky|annotate)`. Also update the comment on line 574 to list `annotate`.
5. `buildCanvasControlInstructions`, after the `sticky` lines (~line 454):

```ts
    '- `annotate --node <id,id> [--role "…"] [--recommend "…"] [--clear]` — record what a node is',
    '  FOR and what should change about it (shows in the Network overview and on `list` rows as',
    '  `role:`). `--role` is one line ≤ 80 chars; `--recommend` ≤ 500 chars. Without `--clear` an',
    '  absent flag is left as it was; `--clear` alone removes the annotation, `--clear --role "x"`',
    '  keeps only the role. Up to 50 ids; one unknown id refuses the whole list. Verified callers',
    '  only; the record shows who wrote it and when. Annotate every station you run.',
```

6. `buildCanvasSkillBody`, after the `sticky` paragraph (~line 967):

```ts
- \`annotate --node <id,id> [--role "…"] [--recommend "…"] [--clear]\` — record what a node is FOR
  (\`--role\`, one line, ≤ 80 chars) and what should change about it (\`--recommend\`, ≤ 500 chars:
  "close — task done", "pause until PR #12 merges", "needs a lead"). The Network overview renders
  both beside live status and edges, and \`list\` rows print \`role:\`. Without \`--clear\` an absent
  flag is left as it was, so a role written earlier survives a new recommendation; \`--clear\` alone
  removes the annotation, \`--clear --role "x"\` keeps only the role. Up to 50 ids per call; one
  unknown id refuses the whole list and names it. Verified callers only — the record shows which
  node wrote it and when. As a Hub, annotate every station during Collect.
```

`src/core/agents/hook-server.ts`: add `'annotate'` to `requiresVerified`; add

```ts
/** Same posture for the verified-only annotate verb (network overview). */
export const ANNOTATE_CONTROL_REFUSAL = 'Annotation write refused.'
```

and in `verifiedRefusalFor`: `if (verb === 'annotate') return ANNOTATE_CONTROL_REFUSAL`.

`src/renderer/lib/controlRouting.ts`: add `'annotate'` to `STORE_ANSWERED_VERBS` with a one-line comment: `// annotate: writes node data through applyNodeMutation, same shape as sticky.`

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/main/canvas-control-core.test.ts src/core/agents/messaging-verified-only.test.ts src/renderer/lib/controlRouting.test.ts src/main/control-shim-parse.test.ts src/main/canvas-control-shim.test.ts && npm run typecheck`
Expected: PASS. (The shim tests run the real `sh`; the positional-list change must not break them.)

- [ ] **Step 5: Commit**

```bash
git add src/core/canvas-control-core.ts src/core/agents/hook-server.ts src/renderer/lib/controlRouting.ts src/main/canvas-control-core.test.ts src/core/agents/messaging-verified-only.test.ts src/renderer/lib/controlRouting.test.ts
git commit -m "feat(canvas-control): register the verified-only, store-answered annotate verb"
```

---

### Task 4: Renderer dispatch for `annotate`, and `role:` on `list`

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx` — non-active branch inside the `route.kind === 'switch' || route.kind === 'reopen'` block (~line 9490, before the `if (!needsLiveCanvas(verb))` list fallback at ~9582); live `case 'annotate'` beside `case 'sticky'` (~11276); `case 'list'` (~10181-10204)
- Modify: `src/renderer/lib/controlRouting.ts:296-300` (`storedNodeListing`)
- Test: `src/renderer/lib/controlRouting.test.ts`; `src/renderer/canvas/control-annotate.test.tsx` (new)

**Interfaces:**
- Consumes: `parseAnnotateArgs`, `applyAnnotation` (Task 1); `applyNodeMutation`, `writeDisk`, `setNodes`, `markDirty`, `routeControlSource`.
- Produces: a pure `annotateNodes(nodes, parsed, by, now)` helper in `src/renderer/lib/annotateNodes.ts` used by both branches.

- [ ] **Step 1: Write the failing tests**

`src/renderer/lib/annotateNodes.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest'
import { annotateNodes } from './annotateNodes'

const nodes = [
  { id: 'a', annotation: undefined },
  { id: 'b', annotation: { role: 'lead', by: 'x', at: 1 } }
]

describe('annotateNodes', () => {
  it('refuses the whole list on one unknown id, naming it', () => {
    expect(annotateNodes(nodes, { ids: ['a', 'zz'], role: 'r', recommend: undefined, clear: false }, 'hub', 5)).toEqual({
      error: 'annotate: no node with id zz'
    })
  })
  it('returns the next annotation per id', () => {
    expect(annotateNodes(nodes, { ids: ['a', 'b'], role: undefined, recommend: 'close', clear: false }, 'hub', 5)).toEqual({
      updates: [
        { id: 'a', annotation: { recommend: 'close', by: 'hub', at: 5 } },
        { id: 'b', annotation: { role: 'lead', recommend: 'close', by: 'hub', at: 5 } }
      ]
    })
  })
  it('--clear yields undefined so the field is removed', () => {
    expect(annotateNodes(nodes, { ids: ['b'], role: undefined, recommend: undefined, clear: true }, 'hub', 5)).toEqual({
      updates: [{ id: 'b', annotation: undefined }]
    })
  })
})
```

`src/renderer/lib/controlRouting.test.ts`:

```ts
  it('storedNodeListing carries the role when the node has one', () => {
    expect(storedNodeListing([{ id: 'a', kind: 'terminal', title: 'A', annotation: { role: 'lead', by: 'h', at: 1 } }])).toEqual([
      { id: 'a', kind: 'terminal', title: 'A', role: 'lead' }
    ])
    expect(storedNodeListing([{ id: 'b', kind: 'terminal', title: 'B' }])).toEqual([{ id: 'b', kind: 'terminal', title: 'B' }])
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/lib/annotateNodes.test.ts src/renderer/lib/controlRouting.test.ts`
Expected: FAIL (module missing; `role` absent).

- [ ] **Step 3: Implement the helper and the listing**

```ts
// src/renderer/lib/annotateNodes.ts
import { applyAnnotation, type AnnotateArgs, type NodeAnnotation } from '@shared/node-annotation'

export interface AnnotateUpdate {
  id: string
  annotation: NodeAnnotation | undefined
}

/**
 * Bulk rule (spec §2): validate every id first, refuse the whole list on the first unknown one.
 * Pure — the active canvas and the serialized-project paths both call it.
 */
export function annotateNodes(
  nodes: readonly { id: string; annotation?: NodeAnnotation }[],
  parsed: AnnotateArgs,
  by: string,
  now: number
): { updates: AnnotateUpdate[] } | { error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const id of parsed.ids) if (!byId.has(id)) return { error: `annotate: no node with id ${id}` }
  return {
    updates: parsed.ids.map((id) => ({ id, annotation: applyAnnotation(byId.get(id)!.annotation, parsed, by, now) }))
  }
}

export function annotateReply(updates: AnnotateUpdate[]): string {
  return `annotated ${updates.length}: ${updates.map((u) => u.id).join(', ')}`
}
```

`src/renderer/lib/controlRouting.ts` `storedNodeListing`: extend `StoredNode` with `annotation?: { role?: string }` and return

```ts
  return nodes.map((n) => ({
    id: n.id,
    kind: n.kind ?? 'terminal',
    title: n.title ?? '',
    ...(n.annotation?.role ? { role: n.annotation.role } : {})
  }))
```

- [ ] **Step 4: Wire Canvas.tsx**

(a) Live `case 'annotate'` right after `case 'sticky'`'s closing brace:

```ts
          case 'annotate': {
            const parsed = parseAnnotateArgs(args)
            if ('error' in parsed) {
              reply({ ok: false, error: parsed.error })
              return
            }
            const res = annotateNodes(
              nodesRef.current.map((nd) => ({ id: nd.id, annotation: nd.data.annotation as NodeAnnotation | undefined })),
              parsed,
              sourceNodeId,
              Date.now()
            )
            if ('error' in res) {
              reply({ ok: false, error: res.error })
              return
            }
            const next = new Map(res.updates.map((u) => [u.id, u.annotation]))
            setNodes((ns) => ns.map((nd) => (next.has(nd.id) ? { ...nd, data: { ...nd.data, annotation: next.get(nd.id) } } : nd)))
            markDirty()
            reply({ ok: true, result: { annotated: res.updates.map((u) => u.id) }, message: annotateReply(res.updates) })
            return
          }
```

(b) Non-active branch: inside the `if (route.kind === 'switch' || route.kind === 'reopen') {` block, directly after the `if (verb === 'sticky') { … }` block and BEFORE `if (!needsLiveCanvas(verb))`:

```ts
          if (verb === 'annotate') {
            const project = projects.find((p) => p.id === route.projectId)
            const parsed = parseAnnotateArgs(args)
            if ('error' in parsed) { reply({ ok: false, error: parsed.error }); return }
            const res = annotateNodes(project?.nodes ?? [], parsed, sourceNodeId, Date.now())
            if ('error' in res) { reply({ ok: false, error: res.error }); return }
            for (const u of res.updates) {
              const target = project!.nodes.find((n) => n.id === u.id)!
              const { annotation: _drop, ...rest } = target
              useProjects.getState().applyNodeMutation(route.projectId, {
                op: 'upsert',
                node: u.annotation ? { ...rest, annotation: u.annotation } : rest
              })
            }
            void writeDisk()
            reply({ ok: true, result: { annotated: res.updates.map((u) => u.id) }, message: annotateReply(res.updates) })
            return
          }
```

(c) `case 'list'`: add `role` to each row and the text suffix:

```ts
            const list = nodesRef.current.map((n) => ({
              id: n.id,
              kind: n.type,
              title: n.data.title as string,
              ...(st[n.id]?.lastTurnError ? { lastTurnErrored: true } : {}),
              ...((n.data.annotation as NodeAnnotation | undefined)?.role
                ? { role: (n.data.annotation as NodeAnnotation).role }
                : {})
            }))
            reply({
              ok: true,
              result: list,
              message: list
                .map(
                  (n) =>
                    `${n.id} [${n.kind}] ${n.title}` +
                    (n.role ? ` · role: ${n.role}` : '') +
                    (n.lastTurnErrored ? ' — LAST TURN ERRORED' : '')
                )
                .join('\n')
            })
```

and the non-active list fallback (`!needsLiveCanvas` branch) message: `rows.map((n) => \`${n.id} [${n.kind}] ${n.title}\` + (n.role ? \` · role: ${n.role}\` : '')).join('\n')`.

Imports at the top of Canvas.tsx: `import { parseAnnotateArgs, type NodeAnnotation } from '@shared/node-annotation'` and `import { annotateNodes, annotateReply } from '../lib/annotateNodes'`.

- [ ] **Step 5: Run and typecheck**

Run: `npx vitest run src/renderer/lib/annotateNodes.test.ts src/renderer/lib/controlRouting.test.ts src/renderer/lib/control-destructive.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/annotateNodes.ts src/renderer/lib/annotateNodes.test.ts src/renderer/lib/controlRouting.ts src/renderer/lib/controlRouting.test.ts src/renderer/canvas/Canvas.tsx
git commit -m "feat(canvas-control): annotate dispatch on the live and serialized paths; role on list rows"
```

---

### Task 5: Server Edition `annotate`

**Files:**
- Modify: `src/server/control-unsupported.ts:66-120` (interface, `SERVER_V1_VERBS`), `:173-178` (switch)
- Modify: `src/server/headless-node-factory.ts` (new method after `rename`, ~line 1011)
- Modify: `src/server/canvas-control.ts:209-224`
- Test: `src/server/headless-node-factory.test.ts` (beside the rename test, ~line 804)

**Interfaces:**
- Consumes: `parseAnnotateArgs`, `applyAnnotation` (Task 1). Cannot import `renderer/lib/annotateNodes` (server must not import renderer); re-implement the 6-line bulk loop inline.
- Produces: `HeadlessNodeFactory.annotate(sourceNodeId, args): Promise<ServerControlReply>`.

- [ ] **Step 1: Write the failing test**

```ts
  it('annotates owned nodes durably, refuses one unknown id for the whole list, and never types', async () => {
    published.length = 0
    await expect(
      factory.annotate('term-source', { node: 'term-owned', role: 'tests', recommend: 'close when green' })
    ).resolves.toMatchObject({ ok: true, message: 'annotated 1: term-owned' })
    const project = (await new WorkspaceStore().load({ sideline: false })).projects[0]
    expect(project.nodes.find((n) => n.id === 'term-owned')?.annotation).toMatchObject({
      role: 'tests',
      recommend: 'close when green',
      by: 'term-source'
    })
    await expect(
      factory.annotate('term-source', { node: 'term-owned,nope', role: 'x' })
    ).resolves.toMatchObject({ ok: false, error: 'annotate: no node with id nope' })
    await expect(factory.annotate('term-source', { node: 'term-owned', clear: '' })).resolves.toMatchObject({ ok: true })
    const after = (await new WorkspaceStore().load({ sideline: false })).projects[0]
    expect(after.nodes.find((n) => n.id === 'term-owned')?.annotation).toBeUndefined()
    expect(pty.sends).toEqual([])
    expect(published.map((n) => n.id)).toEqual(['term-owned', 'term-owned'])
  })

  it('annotate refuses an unowned target and an unknown flag', async () => {
    await expect(factory.annotate('term-source', { node: 'term-upstream', role: 'x' })).resolves.toMatchObject({ ok: false })
    await expect(factory.annotate('term-source', { node: 'term-owned', title: 'x' })).resolves.toMatchObject({
      ok: false,
      error: 'annotate: unknown flag --title'
    })
  })
```
(`term-owned` is a node the harness's `term-source` created this run; `term-upstream` is not. Match the fixture names the existing rename test uses.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/server/headless-node-factory.test.ts -t annotate`
Expected: FAIL, `factory.annotate is not a function`.

- [ ] **Step 3: Implement**

`src/server/control-unsupported.ts`: add to the interface after `sticky`:

```ts
  annotate(sourceNodeId: string, args: Record<string, string>): Promise<ServerControlReply>
```
add `'annotate'` to `SERVER_V1_VERBS`; add to the switch:

```ts
      case 'annotate':
        return actions.annotate(nodeId, command.args)
```

`src/server/headless-node-factory.ts`, after `rename`:

```ts
  annotate(sourceNodeId: string, args: Record<string, string>): Promise<ServerControlReply> {
    return this.runExclusive(async () => {
      const parsed = parseAnnotateArgs(args)
      if ('error' in parsed) return { ok: false, error: parsed.error }
      const workspace = await this.deps.workspaceStore.load({ sideline: false })
      const source = sourceProject(workspace, sourceNodeId)
      if (!source) return { ok: false, error: 'source node is not in exactly one saved project' }
      if (!sourceCanControl(source.node, this.deps.agentIdOf)) {
        return { ok: false, error: 'source node is not a control-capable agent' }
      }
      // Whole-list validation before any write (spec §2): an unknown id refuses everything.
      for (const id of parsed.ids) {
        if (!source.project.nodes.some((n) => n.id === id)) return { ok: false, error: `annotate: no node with id ${id}` }
      }
      const unowned = this.unownedMutation(sourceNodeId, parsed.ids)
      if (unowned) return this.ownershipRefusal('annotate', sourceNodeId, unowned)
      const now = Date.now()
      const changed: CanvasNodeState[] = []
      source.project.nodes = source.project.nodes.map((node) => {
        if (!parsed.ids.includes(node.id)) return node
        const annotation = applyAnnotation(node.annotation, parsed, sourceNodeId, now)
        const { annotation: _drop, ...rest } = node
        const next = annotation ? { ...rest, annotation } : rest
        changed.push(next)
        return next
      })
      await this.deps.workspaceStore.save(workspace)
      this.publish(source.project, changed)
      return {
        ok: true,
        result: { annotated: parsed.ids },
        message: `annotated ${parsed.ids.length}: ${parsed.ids.join(', ')}`
      }
    })
  }
```
Import `parseAnnotateArgs, applyAnnotation` from `../shared/node-annotation`.

`src/server/canvas-control.ts`: `annotate: (sourceNodeId, args) => factory.annotate(sourceNodeId, args),` after `sticky`.

- [ ] **Step 4: Run and typecheck**

Run: `npx vitest run src/server && npm run typecheck`
Expected: PASS (including `control-unsupported.test.ts`, which enumerates supported verbs).

- [ ] **Step 5: Commit**

```bash
git add src/server/control-unsupported.ts src/server/headless-node-factory.ts src/server/canvas-control.ts src/server/headless-node-factory.test.ts
git commit -m "feat(server): annotate verb in the headless canvas-control factory"
```

---

### Task 6: Findings engine and graph builder

**Files:**
- Create: `src/renderer/lib/networkOverview.ts`
- Create: `src/renderer/lib/networkOverview.test.ts`

**Interfaces:**
- Consumes: `CanvasNodeState`, `BridgeLink`, `AgentNodeStatus`, `LaunchDelivery`, `ropeVisual`/`ropeInfoOf` (`lib/edgeModel.ts`), `sessionStatusKind`/`STATE_LABEL` (`lib/sessionList.ts`), `relativeTime` (`lib/relativeTime.ts`), `nodeStatesToFlow` (`state/workspace.ts`).
- Produces:

```ts
export type FindingKind = 'recommend' | 'idle' | 'isolated' | 'group-no-lead' | 'dropped' | 'turn-failed' | 'stalled-launch' | 'paused'
export interface Finding { id: string; kind: FindingKind; severity: 'info' | 'warn'; nodeId?: string; groupId?: string; text: string; source: 'agent' | 'heuristic'; at?: number; byTitle?: string }
export interface OverviewInput { nodes: CanvasNodeState[]; bridges: BridgeLink[]; ropes: BridgeLink[]; statusById: Record<string, AgentNodeStatus | undefined>; launchById: Record<string, LaunchDelivery | undefined>; idleMs: number; now: number }
export function buildFindings(input: OverviewInput): Finding[]
export interface OverviewNodeData { title: string; kind: string; agentId?: string; color: string; role?: string; recommendCount: number; statusLabel?: string; statusKind: 'working' | 'attention' | 'done' | 'unknown'; ageLabel?: string; chips: string[]; unread: boolean; textPreview?: string; findingCount: number; worktreeBranch?: string; noLead: boolean }
export function buildOverviewGraph(input: OverviewInput, colorOf: (agentId: string) => string | undefined, findings: Finding[]): { nodes: Node<OverviewNodeData>[]; edges: Edge[] }
export function overviewSig(nodes: readonly CanvasNodeState[], statusById: Record<string, AgentNodeStatus | undefined>): string
export const LEAD_ROLE_RE = /\b(lead|orchestrator|hub)\b/i
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/lib/networkOverview.test.ts
import { describe, expect, it } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { buildFindings, buildOverviewGraph, overviewSig, type OverviewInput } from './networkOverview'

const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 300, height: 200 },
  title: id.toUpperCase(),
  color: '#888',
  group: null,
  ...extra
})
const agent = (id: string, extra: Partial<CanvasNodeState> = {}) => node(id, { agentId: 'claude', ...extra })
const base = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  nodes: [],
  bridges: [],
  ropes: [],
  statusById: {},
  launchById: {},
  idleMs: 30 * 60_000,
  now: 1_000_000,
  ...over
})

describe('buildFindings', () => {
  it('lists agent recommendations verbatim, newest first, with the byline title', () => {
    const f = buildFindings(base({
      nodes: [
        agent('hub'),
        agent('a', { annotation: { recommend: 'close a', by: 'hub', at: 10 } }),
        agent('b', { annotation: { recommend: 'pause b', by: 'gone', at: 20 } })
      ],
      bridges: [{ id: 'l1', source: 'hub', target: 'a' }, { id: 'l2', source: 'hub', target: 'b' }]
    }))
    const rec = f.filter((x) => x.kind === 'recommend')
    expect(rec.map((x) => [x.nodeId, x.text, x.byTitle, x.at])).toEqual([
      ['b', 'pause b', 'gone', 20],
      ['a', 'close a', 'HUB', 10]
    ])
    expect(rec.every((x) => x.source === 'agent' && x.severity === 'info')).toBe(true)
  })

  it('idle: done + stateAt older than idleMs; never without stateAt; never hibernated/paused', () => {
    const now = 10_000_000
    const old = now - 31 * 60_000
    const f = buildFindings(base({
      now,
      nodes: [agent('a'), agent('b'), agent('c'), agent('d'), agent('e')],
      bridges: [{ id: 'x', source: 'a', target: 'b' }, { id: 'y', source: 'c', target: 'd' }, { id: 'z', source: 'd', target: 'e' }],
      statusById: {
        a: { unread: false, state: 'done', stateAt: old },
        b: { unread: false, state: 'done' },
        c: { unread: false, state: 'done', stateAt: old, hibernated: true },
        d: { unread: false, state: 'done', stateAt: old, paused: true },
        e: { unread: false, state: 'working', stateAt: old }
      }
    }))
    expect(f.filter((x) => x.kind === 'idle').map((x) => x.nodeId)).toEqual(['a'])
    expect(f.find((x) => x.kind === 'idle')!.text).toBe('A idle for 31m')
  })

  it('isolated: agent nodes with no bridge or rope in either direction; never a plain terminal or sticky', () => {
    const f = buildFindings(base({
      nodes: [agent('a'), agent('b'), agent('c'), node('t'), node('s', { kind: 'sticky' })],
      bridges: [{ id: 'x', source: 'a', target: 'b' }]
    }))
    expect(f.filter((x) => x.kind === 'isolated').map((x) => x.nodeId)).toEqual(['c'])
  })

  it('group-no-lead: two or more direct agent children and none with a lead-ish role', () => {
    const f = buildFindings(base({
      nodes: [
        node('g1', { kind: 'group', title: 'Wave 1' }),
        agent('a', { parentId: 'g1', annotation: { role: 'Lead reviewer', by: 'h', at: 1 } }),
        agent('b', { parentId: 'g1' }),
        node('g2', { kind: 'group', title: 'Wave 2' }),
        agent('c', { parentId: 'g2' }),
        agent('d', { parentId: 'g2', annotation: { role: 'tests', by: 'h', at: 1 } }),
        node('g3', { kind: 'group' }),
        agent('e', { parentId: 'g3' })
      ],
      bridges: [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'c', target: 'd' }, { id: '3', source: 'a', target: 'e' }]
    }))
    const g = f.filter((x) => x.kind === 'group-no-lead')
    expect(g.map((x) => x.groupId)).toEqual(['g2'])
    expect(g[0].text).toBe('Wave 2 has no lead')
  })

  it('carries dropped, turn-failed, paused and stalled/failed launches', () => {
    const f = buildFindings(base({
      nodes: [agent('a'), agent('b'), agent('c'), agent('d')],
      bridges: [{ id: '1', source: 'a', target: 'b' }, { id: '2', source: 'b', target: 'c' }, { id: '3', source: 'c', target: 'd' }],
      statusById: {
        a: { unread: false, dropped: true },
        b: { unread: false, lastTurnError: { at: 7 } },
        c: { unread: false, paused: true }
      },
      launchById: { d: { kind: 'stalled', since: 3 } }
    }))
    expect(f.map((x) => [x.kind, x.nodeId])).toEqual([
      ['dropped', 'a'],
      ['turn-failed', 'b'],
      ['stalled-launch', 'd'],
      ['paused', 'c']
    ])
    expect(f.find((x) => x.kind === 'turn-failed')!.at).toBe(7)
  })

  it('orders agent recommendations first, then warn kinds in declared order, then info', () => {
    const f = buildFindings(base({
      nodes: [agent('a', { annotation: { recommend: 'r', by: 'a', at: 1 } }), agent('b')],
      statusById: { b: { unread: false, paused: true } }
    }))
    expect(f.map((x) => x.kind)).toEqual(['recommend', 'isolated', 'isolated', 'paused'])
  })

  it('an empty status map yields only recommendations and structural flags', () => {
    const f = buildFindings(base({ nodes: [agent('a')] }))
    expect(f.map((x) => x.kind)).toEqual(['isolated'])
  })
})

describe('buildOverviewGraph', () => {
  it('maps nodes with precomputed data, groups first, ropes dashed while waiting', () => {
    const input = base({
      nodes: [
        agent('a', { parentId: 'g', annotation: { role: 'lead', by: 'a', at: 1 } }),
        node('g', { kind: 'group', title: 'G' }),
        agent('b', { pendingLaunch: { after: ['a'], command: 'x' } }),
        node('s', { kind: 'sticky', text: 'line one\nline two\nline three' })
      ],
      bridges: [{ id: 'l', source: 'a', target: 'b' }],
      ropes: [{ id: 'r', source: 'a', target: 'b' }],
      statusById: { a: { unread: true, state: 'working', stateAt: 999_000 } }
    })
    const { nodes, edges } = buildOverviewGraph(input, () => '#d97757', buildFindings(input))
    expect(nodes.map((n) => n.id)).toEqual(['g', 'a', 'b', 's'])
    expect(nodes[0].type).toBe('ovGroup')
    expect(nodes[1]).toMatchObject({ type: 'ovNode', parentId: 'g', extent: 'parent' })
    expect(nodes[1].data).toMatchObject({ role: 'lead', statusKind: 'working', statusLabel: 'Running', unread: true, chips: [] })
    expect(nodes[2].data.chips).toEqual(['QUEUED'])
    expect(nodes[3].data.textPreview).toBe('line one\nline two')
    const rope = edges.find((e) => e.id === 'r')!
    expect(rope.style).toMatchObject({ strokeDasharray: '6 4', stroke: '#d97757' })
    expect(rope.label).toBe('⏳ waits for')
    expect(edges.find((e) => e.id === 'l')!.data).toEqual({ anchor: 'horizontal' })
  })

  it('draws every edge even when a node hides its fan-out', () => {
    const input = base({ nodes: [agent('a', { hideFanout: true }), agent('b')], bridges: [{ id: 'l', source: 'a', target: 'b' }] })
    expect(buildOverviewGraph(input, () => undefined, []).edges).toHaveLength(1)
  })
})

describe('overviewSig', () => {
  it('changes with node count, annotation stamps and states, not with positions', () => {
    const a = overviewSig([agent('a', { annotation: { role: 'x', by: 'a', at: 1 } })], { a: { unread: false, state: 'done' } })
    const b = overviewSig([agent('a', { annotation: { role: 'x', by: 'a', at: 2 } })], { a: { unread: false, state: 'done' } })
    const c = overviewSig([agent('a', { position: { x: 9, y: 9 }, annotation: { role: 'x', by: 'a', at: 1 } })], { a: { unread: false, state: 'done' } })
    expect(a).not.toBe(b)
    expect(a).toBe(c)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/lib/networkOverview.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/renderer/lib/networkOverview.ts
// Pure engine behind the Network overview (spec: docs/superpowers/specs/2026-09-11-network-overview-
// design.md §4). No React, no store imports: Canvas hands in serialized nodes + the status maps.
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { BridgeLink, CanvasNodeState } from '@shared/types'
import type { AgentNodeStatus } from '../state/agentStatus'
import type { LaunchDelivery } from './pendingLaunch'
import { ROPE_NEUTRAL, WAIT_LABEL, ropeInfoOf, ropeVisual } from './edgeModel'
import { STATE_LABEL, sessionStatusKind, type StatusKind } from './sessionList'
import { relativeTime } from './relativeTime'
import { nodeStatesToFlow } from '../state/workspace'

export const LEAD_ROLE_RE = /\b(lead|orchestrator|hub)\b/i

export type FindingKind =
  | 'recommend' | 'idle' | 'isolated' | 'group-no-lead'
  | 'dropped' | 'turn-failed' | 'stalled-launch' | 'paused'

export interface Finding {
  id: string
  kind: FindingKind
  severity: 'info' | 'warn'
  nodeId?: string
  groupId?: string
  text: string
  source: 'agent' | 'heuristic'
  at?: number
  /** Title of the node named by `annotation.by`, or its id when that node is gone. */
  byTitle?: string
}

export interface OverviewInput {
  nodes: CanvasNodeState[]
  bridges: BridgeLink[]
  ropes: BridgeLink[]
  statusById: Record<string, AgentNodeStatus | undefined>
  launchById: Record<string, LaunchDelivery | undefined>
  idleMs: number
  now: number
}

/** Sidebar order: recommendations, then warn kinds in this order, then info. */
const KIND_ORDER: FindingKind[] = ['recommend', 'idle', 'isolated', 'group-no-lead', 'dropped', 'turn-failed', 'stalled-launch', 'paused']

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)}m`
}

export function buildFindings(input: OverviewInput): Finding[] {
  const { nodes, bridges, ropes, statusById, launchById, idleMs, now } = input
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const titleOf = (id: string) => byId.get(id)?.title || id
  const linked = new Set<string>()
  for (const e of [...bridges, ...ropes]) { linked.add(e.source); linked.add(e.target) }
  const out: Finding[] = []

  const recs = nodes.filter((n) => n.annotation?.recommend).sort((a, b) => (b.annotation!.at) - (a.annotation!.at))
  for (const n of recs) {
    const a = n.annotation!
    out.push({ id: `recommend:${n.id}`, kind: 'recommend', severity: 'info', nodeId: n.id, text: a.recommend!, source: 'agent', at: a.at, byTitle: titleOf(a.by) })
  }
  for (const n of nodes) {
    if (!n.agentId) continue
    const st = statusById[n.id]
    if (st?.state === 'done' && st.stateAt !== undefined && !st.hibernated && !st.paused && now - st.stateAt > idleMs) {
      out.push({ id: `idle:${n.id}`, kind: 'idle', severity: 'warn', nodeId: n.id, text: `${n.title} idle for ${minutes(now - st.stateAt)}`, source: 'heuristic', at: st.stateAt })
    }
  }
  for (const n of nodes) {
    if (n.agentId && !linked.has(n.id)) {
      out.push({ id: `isolated:${n.id}`, kind: 'isolated', severity: 'warn', nodeId: n.id, text: `${n.title} has no links`, source: 'heuristic' })
    }
  }
  for (const g of nodes) {
    if (g.kind !== 'group') continue
    const members = nodes.filter((n) => n.parentId === g.id && n.agentId)
    if (members.length < 2) continue
    if (members.some((m) => m.annotation?.role && LEAD_ROLE_RE.test(m.annotation.role))) continue
    out.push({ id: `group-no-lead:${g.id}`, kind: 'group-no-lead', severity: 'warn', groupId: g.id, text: `${g.title || 'Group'} has no lead`, source: 'heuristic' })
  }
  for (const n of nodes) {
    const st = statusById[n.id]
    if (st?.dropped) out.push({ id: `dropped:${n.id}`, kind: 'dropped', severity: 'warn', nodeId: n.id, text: `${n.title}: its CLI is gone`, source: 'heuristic' })
  }
  for (const n of nodes) {
    const st = statusById[n.id]
    if (st?.lastTurnError) out.push({ id: `turn-failed:${n.id}`, kind: 'turn-failed', severity: 'warn', nodeId: n.id, text: `${n.title}: last turn errored`, source: 'heuristic', at: st.lastTurnError.at })
  }
  for (const n of nodes) {
    const l = launchById[n.id]
    if (!l) continue
    const text = l.kind === 'stalled' ? `${n.title}: launch held, no terminal yet` : `${n.title}: launch failed after ${l.attempts} attempts`
    out.push({ id: `stalled-launch:${n.id}`, kind: 'stalled-launch', severity: 'warn', nodeId: n.id, text, source: 'heuristic', at: l.kind === 'stalled' ? l.since : l.at })
  }
  for (const n of nodes) {
    if (statusById[n.id]?.paused) out.push({ id: `paused:${n.id}`, kind: 'paused', severity: 'info', nodeId: n.id, text: `${n.title} is paused`, source: 'heuristic' })
  }
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

export interface OverviewNodeData extends Record<string, unknown> {
  title: string
  kind: string
  agentId?: string
  color: string
  role?: string
  recommendCount: number
  statusKind: StatusKind
  statusLabel?: string
  ageLabel?: string
  chips: string[]
  unread: boolean
  textPreview?: string
  findingCount: number
  worktreeBranch?: string
  noLead: boolean
}

function chipsFor(n: CanvasNodeState, st: AgentNodeStatus | undefined, l: LaunchDelivery | undefined): string[] {
  const chips: string[] = []
  if (st?.dropped) chips.push('DROPPED')
  if (st?.lastTurnError) chips.push('TURN FAILED')
  if (st?.paused) chips.push('PAUSED')
  else if (st?.hibernated) chips.push('SLEEPING')
  if (n.pendingLaunch) chips.push(l ? 'QUEUED ⚠' : 'QUEUED')
  return chips
}

export function buildOverviewGraph(
  input: OverviewInput,
  colorOf: (agentId: string) => string | undefined,
  findings: Finding[]
): { nodes: Node<OverviewNodeData>[]; edges: Edge[] } {
  const { nodes: states, bridges, ropes, statusById, launchById, now } = input
  const findingCount = new Map<string, number>()
  const noLead = new Set<string>()
  for (const f of findings) {
    const key = f.nodeId ?? f.groupId
    if (key) findingCount.set(key, (findingCount.get(key) ?? 0) + 1)
    if (f.kind === 'group-no-lead' && f.groupId) noLead.add(f.groupId)
  }
  const byId = new Map(states.map((n) => [n.id, n]))
  // nodeStatesToFlow gives parent-first order and parentId/extent — the same shape the canvas uses.
  const flow = nodeStatesToFlow(states)
  const nodes: Node<OverviewNodeData>[] = flow.map((fn) => {
    const n = byId.get(fn.id)!
    const st = statusById[n.id]
    const kind = n.agentId ? sessionStatusKind(st?.state) : 'unknown'
    const data: OverviewNodeData = {
      title: n.title,
      kind: n.kind,
      agentId: n.agentId,
      color: n.color,
      role: n.annotation?.role,
      recommendCount: n.annotation?.recommend ? 1 : 0,
      statusKind: kind,
      statusLabel: n.agentId ? STATE_LABEL[kind] : undefined,
      ageLabel: st?.stateAt !== undefined ? relativeTime(st.stateAt, now) : undefined,
      chips: chipsFor(n, st, launchById[n.id]),
      unread: !!st?.unread,
      textPreview: n.kind === 'sticky' && n.text ? n.text.split('\n').slice(0, 2).join('\n') : undefined,
      findingCount: findingCount.get(n.id) ?? 0,
      worktreeBranch: n.worktree?.branch,
      noLead: noLead.has(n.id)
    }
    return {
      id: n.id,
      type: n.kind === 'group' ? 'ovGroup' : 'ovNode',
      position: fn.position,
      parentId: fn.parentId,
      extent: fn.parentId ? ('parent' as const) : undefined,
      width: n.size.width,
      height: n.size.height,
      draggable: false,
      selectable: false,
      connectable: false,
      data
    }
  })
  const info = ropeInfoOf(flow, colorOf)
  const arrow = (color: string) => ({ type: MarkerType.ArrowClosed, color, width: 14, height: 14 })
  const edges: Edge[] = [
    ...bridges.map((b) => {
      const stroke = colorOf(byId.get(b.source)?.agentId ?? '') ?? ROPE_NEUTRAL
      return { id: b.id, source: b.source, target: b.target, type: 'floating', data: { anchor: 'horizontal' }, style: { stroke, strokeWidth: 2 }, markerEnd: arrow(stroke), markerStart: arrow(stroke) }
    }),
    ...ropes.map((r) => {
      const v = ropeVisual(r, info)
      return {
        id: r.id, source: r.source, target: r.target, type: 'floating',
        style: { stroke: v.color, strokeWidth: 2, ...(v.waiting ? { strokeDasharray: '6 4' } : {}) },
        ...(v.waiting ? { label: WAIT_LABEL, labelStyle: { fill: v.color, fontSize: 11, fontWeight: 600 } } : {}),
        markerEnd: arrow(v.color)
      }
    })
  ]
  return { nodes, edges }
}

/** Primitive re-render key: node count, annotation stamps, agent states — never positions. */
export function overviewSig(nodes: readonly CanvasNodeState[], statusById: Record<string, AgentNodeStatus | undefined>): string {
  return nodes.map((n) => `${n.id}:${n.annotation?.at ?? ''}:${statusById[n.id]?.state ?? ''}:${statusById[n.id]?.unread ? 1 : 0}`).join('|')
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/lib/networkOverview.test.ts && npm run typecheck`
Expected: PASS. If `nodeStatesToFlow` names `extent` differently, match it in the test; the assertion is that a child carries `parentId` and a parent-bounded extent.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/networkOverview.ts src/renderer/lib/networkOverview.test.ts
git commit -m "feat(overview): pure findings engine and overview graph builder"
```

---

### Task 7: Third view in `viewMode`

**Files:**
- Modify: `src/renderer/state/viewMode.ts:15-28, 38-62, 100-125`
- Test: `src/renderer/state/viewMode.test.ts`

**Interfaces:**
- Produces: `ProjectView = 'canvas' | 'kanban' | 'overview'`; `toggleOverview(projectId)`; `isOverviewOpen(projectId): boolean`; `isAnyKanbanOpen(projectId): boolean` (per-project OR global board); `isOverlayViewOpen(projectId): boolean` (any board OR overview).
- `toggle(projectId)` keeps its contract for kanban: from `overview` it goes to `kanban` (the board toggle opens the board and closes the overview).
- Also add `isAnyKanbanOpen(projectId)` = per-project OR global board, for the one `focusNodeById` branch that opens a card instead of framing.

- [ ] **Step 1: Write the failing tests**

```ts
  it('parses and stores the overview view', () => {
    expect(parseViewMap(JSON.stringify({ a: 'overview', b: 'nope' }))).toEqual({ a: 'overview' })
  })

  it('toggleOverview flips overview <-> canvas; toggle (kanban) closes the overview', () => {
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(true)
    expect(isOverlayViewOpen('p')).toBe(true)
    expect(isKanbanOpen('p')).toBe(false)
    useViewMode.getState().toggle('p')
    expect(isKanbanOpen('p')).toBe(true)
    expect(isOverviewOpen('p')).toBe(false)
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(true)
    useViewMode.getState().toggleOverview('p')
    expect(isOverviewOpen('p')).toBe(false)
    expect(isOverlayViewOpen('p')).toBe(false)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/renderer/state/viewMode.test.ts`
Expected: FAIL (`'overview'` dropped by parse; `toggleOverview` undefined).

- [ ] **Step 3: Implement**

```ts
export type ProjectView = 'canvas' | 'kanban' | 'overview'
```
`parseViewMap` guard: `if (v === 'kanban' || v === 'canvas' || v === 'overview') out[id] = v`.

Interface additions:

```ts
  /** Network overview (third view). From any view → overview; from overview → canvas. */
  toggleOverview(projectId: string): void
```

Store additions (after `toggle`):

```ts
  toggleOverview: (projectId) =>
    set((s) => {
      const cur = s.viewByProject[projectId] ?? s.defaultView
      const next: Record<string, ProjectView> = { ...s.viewByProject, [projectId]: cur === 'overview' ? 'canvas' : 'overview' }
      save(next)
      return { viewByProject: next, requestedCardNodeId: null }
    })
```

`toggle` keeps `cur === 'kanban' ? 'canvas' : 'kanban'` (so `overview` → `kanban`).

Helpers:

```ts
export function isOverviewOpen(projectId: string): boolean {
  return !!projectId && viewFor(useViewMode.getState(), projectId) === 'overview'
}

/** The board in either form (per-project or global) — the branch that opens a CARD on "go to". */
export function isAnyKanbanOpen(projectId: string): boolean {
  return isGlobalKanbanOpen() || isKanbanOpen(projectId)
}

/** Any full-page overlay over the canvas: the board (per-project or global) or the overview. */
export function isOverlayViewOpen(projectId: string): boolean {
  return isGlobalKanbanOpen() || isKanbanOpen(projectId) || isOverviewOpen(projectId)
}
```
(`isGlobalKanbanOpen` is defined below `isKanbanOpen` in the same file; function declarations hoist, so order is fine.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/renderer/state/viewMode.test.ts && npm run typecheck`
Expected: PASS. Typecheck may flag `ProjectView` consumers that switch exhaustively on `'canvas' | 'kanban'` (Settings "Default view"); add an `overview` case only where TypeScript demands it, otherwise leave.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/state/viewMode.ts src/renderer/state/viewMode.test.ts
git commit -m "feat(view): overview as a third per-project view"
```

---

### Task 8: `NetworkOverviewView` component and styles

**Files:**
- Create: `src/renderer/components/overview/OverviewNodes.tsx`
- Create: `src/renderer/components/overview/NetworkOverviewView.tsx`
- Create: `src/renderer/components/overview/NetworkOverviewView.test.tsx`
- Modify: `src/renderer/styles.css` (append after the `.kanban-header` block, ~line 8987)

**Interfaces:**
- Consumes: `buildFindings`, `buildOverviewGraph`, `OverviewInput`, `Finding` (Task 6); `FloatingEdge` (`canvas/FloatingEdge.tsx`); `agentConfig` from `@shared/agents/config`.
- Produces:

```ts
export interface NetworkOverviewViewProps {
  projectName: string
  projectColor: string
  input: OverviewInput
  onClose(): void
  onGoToNode(id: string): void
}
export const NetworkOverviewView: React.FC<NetworkOverviewViewProps>
```

- [ ] **Step 1: Write the failing smoke test**

```tsx
// src/renderer/components/overview/NetworkOverviewView.test.tsx
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeState } from '@shared/types'
import { NetworkOverviewView } from './NetworkOverviewView'

const node = (id: string, extra: Partial<CanvasNodeState> = {}): CanvasNodeState => ({
  id, kind: 'terminal', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, title: id, color: '#888', group: null, ...extra
})

describe('NetworkOverviewView', () => {
  let root: ReturnType<typeof createRoot> | undefined
  let el: HTMLDivElement | undefined
  afterEach(() => { act(() => root?.unmount()); el?.remove() })

  it('renders header, node cards, the findings list, and jumps on click', () => {
    const onGoToNode = vi.fn()
    const onClose = vi.fn()
    el = document.createElement('div'); document.body.appendChild(el)
    root = createRoot(el)
    act(() => root!.render(
      <NetworkOverviewView
        projectName="Research"
        projectColor="#0a84ff"
        onClose={onClose}
        onGoToNode={onGoToNode}
        input={{
          nodes: [
            node('g', { kind: 'group', title: 'Wave 1' }),
            node('hub', { agentId: 'claude', parentId: 'g', annotation: { role: 'lead', by: 'hub', at: 1 } }),
            node('a', { agentId: 'claude', parentId: 'g', annotation: { recommend: 'close a', by: 'hub', at: 2 } })
          ],
          bridges: [{ id: 'l', source: 'hub', target: 'a' }],
          ropes: [],
          statusById: { a: { unread: false, state: 'done', stateAt: 0 } },
          launchById: {},
          idleMs: 30 * 60_000,
          now: 60 * 60_000
        }}
      />
    ))
    expect(el.querySelector('.overview-header__name')!.textContent).toBe('Research')
    expect(el.textContent).toContain('lead')
    expect(el.textContent).toContain('close a')
    expect(el.textContent).toContain('a idle for 60m')
    const row = [...el.querySelectorAll('.overview-finding')].find((r) => r.textContent?.includes('close a')) as HTMLButtonElement
    act(() => row.click())
    expect(onGoToNode).toHaveBeenCalledWith('a')
    act(() => (el!.querySelector('.overview-header__close') as HTMLButtonElement).click())
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/components/overview/NetworkOverviewView.test.tsx`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the node components**

```tsx
// src/renderer/components/overview/OverviewNodes.tsx
import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { OverviewNodeData } from '../../lib/networkOverview'

const KIND_GLYPH: Record<string, string> = {
  terminal: '▣', sticky: '🗒', editor: '✎', diff: '±', video: '▶', web: '⌂', browser: '◎', files: '🗂', dino: '🦖', trigger: '⏰'
}

export const OverviewNode = memo(function OverviewNode({ id, data }: NodeProps & { data: OverviewNodeData }) {
  return (
    <div
      className={`ov-node ov-node--${data.statusKind}${data.unread ? ' ov-node--unread' : ''}`}
      style={{ borderLeftColor: data.color }}
      data-node-id={id}
      title={data.title}
    >
      <div className="ov-node__head">
        <span className="ov-node__glyph">{KIND_GLYPH[data.kind] ?? '▣'}</span>
        <span className="ov-node__title">{data.title || 'Untitled'}</span>
        {data.unread && <span className="ov-node__unread" aria-label="unread" />}
        {data.findingCount > 0 && <span className="ov-node__count">{data.findingCount}</span>}
      </div>
      <div className={`ov-node__role${data.role ? '' : ' ov-node__role--none'}`}>{data.role ?? 'no role'}</div>
      {data.textPreview && <pre className="ov-node__text">{data.textPreview}</pre>}
      {(data.statusLabel || data.chips.length > 0) && (
        <div className="ov-node__chips">
          {data.statusLabel && (
            <span className={`ov-chip ov-chip--${data.statusKind}`}>
              {data.statusLabel}{data.ageLabel ? ` · ${data.ageLabel}` : ''}
            </span>
          )}
          {data.chips.map((c) => <span key={c} className="ov-chip ov-chip--verdict">{c}</span>)}
        </div>
      )}
    </div>
  )
})

export const OverviewGroup = memo(function OverviewGroup({ data }: NodeProps & { data: OverviewNodeData }) {
  return (
    <div className="ov-group" style={{ borderColor: data.color }}>
      <span className="ov-group__label" style={{ borderColor: data.color }}>
        <span className="ov-group__dot" style={{ background: data.color }} />
        {data.title || 'Group'}
        {data.worktreeBranch && <span className="ov-group__branch">⎇ {data.worktreeBranch}</span>}
        {data.noLead && <span className="ov-group__nolead">no lead</span>}
      </span>
    </div>
  )
})

export const overviewNodeTypes = { ovNode: OverviewNode, ovGroup: OverviewGroup }
```

- [ ] **Step 4: Implement the view**

```tsx
// src/renderer/components/overview/NetworkOverviewView.tsx
// Full-page overlay: the project's node network at a glance (spec §3). Its OWN React Flow instance,
// read-only — nothing here parks, releases or spawns a PTY, and the main canvas stays mounted under it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Background, ReactFlow, ReactFlowProvider, type NodeMouseHandler } from '@xyflow/react'
import { agentConfig } from '@shared/agents/config'
import type { AgentId } from '@shared/agents/config'
import { FloatingEdge } from '../../canvas/FloatingEdge'
import { buildFindings, buildOverviewGraph, type Finding, type OverviewInput } from '../../lib/networkOverview'
import { relativeTime } from '../../lib/relativeTime'
import { overviewNodeTypes } from './OverviewNodes'

export interface NetworkOverviewViewProps {
  projectName: string
  projectColor: string
  input: OverviewInput
  onClose(): void
  onGoToNode(id: string): void
}

const edgeTypes = { floating: FloatingEdge }
const colorOf = (agentId: string) => agentConfig(agentId as AgentId)?.color

function FindingRow({ f, now, onGo }: { f: Finding; now: number; onGo(id: string): void }) {
  const target = f.nodeId ?? f.groupId
  return (
    <button
      type="button"
      className={`overview-finding overview-finding--${f.severity} overview-finding--${f.source}`}
      onClick={() => target && onGo(target)}
    >
      <span className="overview-finding__kind">{f.kind.replace(/-/g, ' ')}</span>
      <span className="overview-finding__text">{f.text}</span>
      {(f.byTitle || f.at !== undefined) && (
        <span className="overview-finding__meta">
          {f.byTitle ? `↻ ${f.byTitle}` : ''}
          {f.byTitle && f.at !== undefined ? ' · ' : ''}
          {f.at !== undefined ? relativeTime(f.at, now) : ''}
        </span>
      )}
    </button>
  )
}

export function NetworkOverviewView(props: NetworkOverviewViewProps) {
  const { projectName, projectColor, input, onClose, onGoToNode } = props
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const findings = useMemo(() => buildFindings(input), [input])
  const graph = useMemo(() => buildOverviewGraph(input, colorOf, findings), [input, findings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onNodeClick: NodeMouseHandler = useCallback((_e, n) => onGoToNode(n.id), [onGoToNode])

  return (
    <div className="overview-overlay" role="dialog" aria-label="Network overview">
      <div className="overview-header">
        <span className="overview-header__dot" style={{ background: projectColor }} />
        <span className="overview-header__name">{projectName}</span>
        <span className="overview-header__title">Network overview</span>
        <span className="overview-header__spacer" />
        <button type="button" className="overview-header__toggle" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle findings">
          {sidebarOpen ? '⟩' : '⟨'} {findings.length}
        </button>
        <button type="button" className="overview-header__close" onClick={onClose} aria-label="Close overview">×</button>
      </div>
      <div className="overview-body">
        <div className="overview-graph">
          <ReactFlowProvider>
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={overviewNodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.05}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll
              onNodeClick={onNodeClick}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} size={1} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        {sidebarOpen && (
          <aside className="overview-findings">
            <div className="overview-findings__head">Findings · {findings.length}</div>
            {findings.length === 0 && <div className="overview-findings__empty">Nothing to flag. Roles and recommendations arrive from agents through <code>annotate</code>.</div>}
            {findings.map((f) => <FindingRow key={f.id} f={f} now={input.now} onGo={onGoToNode} />)}
          </aside>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Styles** — append to `src/renderer/styles.css` after `.kanban-header`:

```css
/* ---- Network overview (full-page, third project view; own read-only React Flow) ---- */
.overview-overlay { position: fixed; top: 44px; left: 0; right: 0; bottom: 0; z-index: 25; background: var(--canvas-bg); display: flex; flex-direction: column; overflow: hidden; }
.overview-header { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 18px; padding-right: 300px; border-bottom: 1px solid rgba(var(--tint-rgb), 0.08); }
.overview-header__dot { width: 10px; height: 10px; border-radius: 50%; }
.overview-header__name { font-weight: 600; }
.overview-header__title { opacity: 0.6; }
.overview-header__spacer { flex: 1; }
.overview-header__toggle, .overview-header__close { background: none; border: 1px solid rgba(var(--tint-rgb), 0.15); color: inherit; border-radius: 6px; padding: 2px 8px; cursor: pointer; }
.overview-body { flex: 1; display: flex; min-height: 0; }
.overview-graph { flex: 1; min-width: 0; }
.overview-findings { flex: 0 0 360px; border-left: 1px solid rgba(var(--tint-rgb), 0.08); overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.overview-findings__head { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; padding: 4px 6px; }
.overview-findings__empty { opacity: 0.6; font-size: 13px; padding: 6px; }
.overview-finding { text-align: left; background: rgba(var(--tint-rgb), 0.04); border: 1px solid rgba(var(--tint-rgb), 0.08); border-left-width: 3px; border-radius: 8px; padding: 8px 10px; color: inherit; cursor: pointer; display: grid; gap: 2px; }
.overview-finding--agent { border-left-color: #d97757; }
.overview-finding--warn.overview-finding--heuristic { border-left-color: #ffd60a; }
.overview-finding--info.overview-finding--heuristic { border-left-color: var(--accent); }
.overview-finding__kind { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }
.overview-finding__text { font-size: 13px; }
.overview-finding__meta { font-size: 11px; opacity: 0.6; }
.ov-node { width: 100%; height: 100%; box-sizing: border-box; background: rgba(28, 28, 30, 0.92); border: 1px solid rgba(255, 255, 255, 0.12); border-left: 4px solid #0a84ff; border-radius: 8px; padding: 8px 10px; color: #f2f2f7; display: flex; flex-direction: column; gap: 4px; overflow: hidden; cursor: pointer; }
.ov-node--working { box-shadow: 0 0 0 2px rgba(255, 214, 10, 0.5); }
.ov-node--attention { box-shadow: 0 0 0 2px rgba(255, 69, 58, 0.6); }
.ov-node__head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ov-node__title { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-node__unread { width: 7px; height: 7px; border-radius: 50%; background: #d97757; }
.ov-node__count { margin-left: auto; font-size: 10px; background: rgba(255, 214, 10, 0.2); border-radius: 999px; padding: 0 6px; }
.ov-node__role { font-size: 12px; font-style: italic; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-node__role--none { opacity: 0.4; }
.ov-node__text { margin: 0; font: 11px/1.3 ui-monospace, Menlo, monospace; opacity: 0.8; white-space: pre-wrap; }
.ov-node__chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; }
.ov-chip { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.08); }
.ov-chip--working { color: #ffd60a; }
.ov-chip--attention { color: #ff453a; }
.ov-chip--verdict { color: #ff9f0a; }
.ov-group { width: 100%; height: 100%; box-sizing: border-box; border: 1.5px dashed; border-radius: 12px; position: relative; opacity: 0.9; }
.ov-group__label { position: absolute; top: -12px; left: 12px; background: var(--canvas-bg); border: 1px solid; border-radius: 999px; padding: 1px 8px; font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
.ov-group__dot { width: 8px; height: 8px; border-radius: 50%; }
.ov-group__branch { opacity: 0.7; }
.ov-group__nolead { color: #ffd60a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.overview-graph .react-flow__node { pointer-events: all; }
```

Add `.overview-overlay` to the `-webkit-app-region: no-drag` list at `styles.css:3930` beside `.kanban-overlay`.

- [ ] **Step 6: Run the smoke test and typecheck**

Run: `npx vitest run src/renderer/components/overview/NetworkOverviewView.test.tsx && npm run typecheck`
Expected: PASS. If React Flow needs `ResizeObserver` under jsdom, add at the top of the test: `globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never` (check `browser-partition-parity.test.tsx` for the project's existing shim first and reuse it).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/overview src/renderer/styles.css
git commit -m "feat(overview): NetworkOverviewView with read-only React Flow graph and findings sidebar"
```

---

### Task 9: Wire the overview into Canvas: mount, guards, entry points, minimap button

**Files:**
- Modify: `src/renderer/canvas/Canvas.tsx` — view flags (~2622-2624), pre-mount commit (~2731-2733), toggle function (~2740-2756), keydown handler map (~7500), `focusNodeById` (~8741), mount JSX (~13676-13692), `buildCommands` (~13407-13418), minimap mount (~13919), the `isKanbanOpen`/`isGlobalKanbanOpen` guards listed below
- Modify: `src/shared/keybindings.ts:45, 107-110`
- Test: `src/shared/keybindings.test.ts` (registry pin, if one enumerates ids), `src/renderer/canvas/canvas-wiring.test.tsx` (add a source-level pin)

**Interfaces:**
- Consumes: `NetworkOverviewView` (Task 8), `overviewSig`, `buildFindings` (Task 6), `isOverviewOpen`, `isOverlayViewOpen`, `toggleOverview` (Task 7).
- Produces: registry command `view.overviewToggle`; `performOverviewToggle()`.

- [ ] **Step 1: Write the failing pins**

`src/shared/keybindings.test.ts` (append near an existing registry-shape test):

```ts
  it('ships view.overviewToggle unbound and remappable', () => {
    const def = COMMAND_DEFINITIONS.find((d) => d.id === 'view.overviewToggle')!
    expect(def).toMatchObject({ title: 'Toggle network overview', group: 'General', scope: 'app' })
    expect(def.defaultBindings.mac).toEqual([])
  })
```

`src/renderer/canvas/canvas-wiring.test.tsx` (source-level pin, same style as the `fitView(` pin there):

```ts
  it('every board-only guard also stands down under the overview', () => {
    const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    // The overlay guards ask ONE predicate. A bare kanban check that ignores the overview would
    // fire undo/⌘T/Delete on the canvas hidden under it.
    expect(src.match(/isGlobalKanbanOpen\(\) \|\| isKanbanOpen\(/g) ?? []).toHaveLength(0)
    expect(src).toContain('<NetworkOverviewView')
    expect(src).toContain("'view.overviewToggle': () => performOverviewToggle()")
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/shared/keybindings.test.ts src/renderer/canvas/canvas-wiring.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Registry command**

`src/shared/keybindings.ts`: add `| 'view.overviewToggle'` after `'view.globalKanbanToggle'` in the union, and after line 110:

```ts
  { id: 'view.overviewToggle', title: 'Toggle network overview', group: 'General', scope: 'app',
    defaultBindings: both(), allowInTerminal: true },
```

- [ ] **Step 4: Canvas flags, toggle, guards**

(a) Beside `perProjectKanbanOpen` (~2622):

```ts
  const overviewOpen = useViewMode((s) => !!activeProjectId && viewFor(s, activeProjectId) === 'overview')
```
and extend the pills' prop: `overBoard={kanbanOpen || overviewOpen}` at the three `overBoard={kanbanOpen}` sites (13939, 13948, 13998).

(b) Pre-mount commit, beside the global-kanban effect (~2731):

```ts
  // The overview reads SERIALIZED nodes (like the global board); commit the live canvas first.
  useEffect(() => {
    if (overviewOpen) commitActiveToStore()
  }, [overviewOpen, commitActiveToStore])
```

(c) Toggle, after `performGlobalKanbanToggle`:

```ts
  const performOverviewToggle = useCallback(() => {
    const id = useProjects.getState().activeProjectId
    if (!id) return false
    if (isGlobalKanbanOpen()) useViewMode.getState().toggleGlobalKanban()
    commitActiveToStore()
    useViewMode.getState().toggleOverview(id)
    return true
  }, [commitActiveToStore])
```

(d) Handler map (~7500): add `'view.overviewToggle': () => performOverviewToggle(),`.

(e) Replace every `isGlobalKanbanOpen() || isKanbanOpen(X)` with `isOverlayViewOpen(X)` — at lines 2570, 4890, 6802, 7004, 7271, 7486, 8741 (import `isOverlayViewOpen` from `../state/viewMode`). Line 6936 (`!activeId || isGlobalKanbanOpen() || isKanbanOpen(activeId)`) becomes `!activeId || isOverlayViewOpen(activeId)`. Line 2555 (`!isKanbanOpen(project.id)`, the resume-card gate) becomes `!isOverlayViewOpen(project.id)`. Lines 4680-4681 (Escape closes the board) gain a third branch: `else if (isOverviewOpen(pid)) useViewMode.getState().toggleOverview(pid)` — keep it BEFORE the kanban branch order is irrelevant since the views are exclusive. Line 7648 (`boardOpen:`) stays as is (it feeds board-specific UI).

(f) `focusNodeById` (~8741): the branch becomes

```ts
        const pid = useProjects.getState().activeProjectId
        if (isOverviewOpen(pid)) {
          // The overview is an overlay too, but "go to" there means LEAVE it and frame the node.
          useViewMode.getState().toggleOverview(pid)
        } else if (isAnyKanbanOpen(pid)) {
          useViewMode.getState().requestCard(nodeId)
          useAgentStatus.getState().setActive(nodeId, true)
          useAgentStatus.getState().clearUnread(nodeId)
          return
        }
```
(`isAnyKanbanOpen` comes from Task 7, so the wiring pin's "zero bare kanban pairs" holds.)

(g) Mount, beside the kanban mount (~13676):

```tsx
      {overviewOpen && activeProject && (
        <NetworkOverviewView
          projectName={activeProject.name}
          projectColor={activeProject.color}
          input={overviewInput}
          onClose={() => performOverviewToggle()}
          onGoToNode={(id) => { performOverviewToggle(); focusNodeById(id) }}
        />
      )}
```
with, above the return:

```ts
  const overviewStatusSig = useAgentStatus((s) => overviewOpen ? overviewSig(activeProject?.nodes ?? [], s.byId) : '')
  const overviewLaunchById = useLaunchDelivery((s) => s.byId)
  const idleMinutes = useSettings((s) => s.settings.agentHibernationIdleMinutes)
  const overviewInput = useMemo<OverviewInput>(() => ({
    nodes: activeProject?.nodes ?? [],
    bridges: activeProject?.bridges ?? [],
    ropes: activeProject?.ropes ?? [],
    statusById: useAgentStatus.getState().byId,
    launchById: overviewLaunchById,
    idleMs: Math.max(1, idleMinutes) * 60_000,
    now: Date.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [overviewOpen, activeProject, overviewStatusSig, overviewLaunchById, idleMinutes])
```
(`activeProject` is the serialized project from `useProjects`; use whatever local name Canvas already holds for it, e.g. the one that feeds `projectKanban`.)

(h) ⌘K, beside `toggle-kanban`:

```ts
      const ov = isOverviewOpen(kanbanId)
      cmds.push({
        id: 'toggle-overview',
        label: ov ? 'Canvas view' : 'Network overview',
        hint: chipFor('view.overviewToggle') || undefined,
        group: 'View',
        icon: ov ? <IconCanvasView /> : <IconKanban />,
        run: () => performOverviewToggle()
      })
```

(i) Minimap expand button, right after `<StatusAwareMiniMap onNodeDoubleClick={goToNode} />`:

```tsx
          {!kanbanOpen && <OverviewExpandButton onOpen={performOverviewToggle} />}
```
with a small component next to `StatusAwareMiniMap`:

```tsx
function OverviewExpandButton({ onOpen }: { onOpen(): void }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const sig = useAgentStatus((s) => overviewSig(project?.nodes ?? [], s.byId))
  const launchById = useLaunchDelivery((s) => s.byId)
  const idleMinutes = useSettings((s) => s.settings.agentHibernationIdleMinutes)
  const count = useMemo(
    () => project ? buildFindings({
      nodes: project.nodes, bridges: project.bridges ?? [], ropes: project.ropes ?? [],
      statusById: useAgentStatus.getState().byId, launchById, idleMs: Math.max(1, idleMinutes) * 60_000, now: Date.now()
    }).length : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, sig, launchById, idleMinutes]
  )
  return (
    <Panel position="bottom-right" className="minimap-expand-panel">
      <button type="button" className="minimap-expand" title="Network overview" aria-label="Network overview" onClick={onOpen}>
        ⤢{count > 0 && <span className="minimap-expand__badge">{count}</span>}
      </button>
    </Panel>
  )
}
```
CSS (append to styles.css):

```css
/* Expand affordance over the minimap's top-left corner (MiniMap default 200×150 + --float-gap). */
.minimap-expand-panel { margin: var(--float-gap); margin-bottom: calc(var(--float-gap) + 150px - 26px); margin-right: calc(var(--float-gap) + 200px - 26px); pointer-events: none; }
.minimap-expand { pointer-events: all; width: 22px; height: 22px; border-radius: 6px; border: 1px solid rgba(var(--tint-rgb), 0.2); background: var(--panel-bg, rgba(28, 28, 30, 0.9)); color: inherit; font-size: 12px; cursor: pointer; position: relative; }
.minimap-expand__badge { position: absolute; top: -6px; right: -6px; min-width: 14px; height: 14px; border-radius: 7px; background: #ffd60a; color: #1c1c1e; font-size: 9px; line-height: 14px; padding: 0 3px; }
```
Import `Panel` from `@xyflow/react`, `NetworkOverviewView`, `buildFindings`, `overviewSig`, `type OverviewInput`, `useLaunchDelivery`, `isOverviewOpen`, `isAnyKanbanOpen`, `isOverlayViewOpen`.

- [ ] **Step 5: Run the pins, the wiring suite and typecheck**

Run: `npx vitest run src/shared/keybindings.test.ts src/renderer/canvas/canvas-wiring.test.tsx src/renderer/state/viewMode.test.ts src/renderer/components/ShortcutsPanel.test.tsx src/main/keydown-intercept.test.ts && npm run typecheck`
Expected: PASS. `ShortcutsPanel.test.tsx` binds every registry command and asserts a row per title, so the new command must render there.

- [ ] **Step 6: Manual check in the app**

Run: `npm run dev`. Open a project with agent nodes. Click ⤢ on the minimap; expect the overlay with cards, edges, the findings sidebar; click a finding → overlay closes and the canvas frames the node; Escape closes; ⌘⇧B from the overview opens the board (overview gone). Run from a Claude node: `nodeterm annotate --node <id> --role "lead" --recommend "close after merge"`, then `nodeterm list` shows `· role: lead`; reopen the overview and see both.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/canvas/Canvas.tsx src/shared/keybindings.ts src/shared/keybindings.test.ts src/renderer/canvas/canvas-wiring.test.tsx src/renderer/styles.css
git commit -m "feat(overview): third project view wired into Canvas, ⌘K, registry command and the minimap"
```

---

### Task 10: Docs, full suite, PR

**Files:**
- Modify: `CLAUDE.md` — (a) under **Canvas control**, after the `sticky` sentence in the verb list paragraph, one sentence for `annotate` (verified-only, store-answered, `annotation` field, never `tags`); (b) under **Canvas interaction & panels**, one bullet **Network overview** naming the three views, `isOverlayViewOpen`, the engine module, and the idle threshold rule.
- Modify: `CONTRIBUTING.md` — one line under house rules: "`data.tags` is retired (migrated into kanban labels on load); never write node metadata there. Structured node facts get their own validated field (see `annotation`)."

- [ ] **Step 1: Write the docs**

CLAUDE.md, Canvas control verb paragraph, after the `sticky` sentence:

```
`annotate --node <id,id> [--role "…"] [--recommend "…"] [--clear]` (2026-09-11) writes
`CanvasNodeState.annotation` ({role ≤ 80, recommend ≤ 500, by, at}) — NOT `data.tags`, which
`migrateProjectTags` strips on every load. Verified-only (`requiresVerified`, byline like `sticky`),
store-answered (`STORE_ANSWERED_VERBS`: never a project switch or camera move), bulk list refused
whole on one unknown id; `list` rows print `· role:`. Pure helpers in `shared/node-annotation.ts`,
validated at both serializer seams like `icon`.
```

CLAUDE.md, Canvas interaction & panels, new bullet after Kanban view:

```
- **Network overview** (`components/overview/NetworkOverviewView.tsx`, ⤢ on the minimap / ⌘K /
  `view.overviewToggle` unbound): the third `ProjectView` (`'overview'`), a full-page overlay with
  its OWN read-only React Flow instance over the SERIALIZED project (commit-before-mount like the
  global board). Every canvas-only guard asks `isOverlayViewOpen`, never a bare kanban check
  (pinned in `canvas-wiring.test.tsx`). The engine is the pure `lib/networkOverview.ts`
  (`buildFindings` / `buildOverviewGraph`): agent recommendations first, then idle (threshold =
  `agentHibernationIdleMinutes`, no `stateAt` ⇒ no flag), isolated (agent with no edge),
  group-no-lead (≥ 2 agent children, none with a lead/orchestrator/hub role), then carried
  verdicts. `hideFanout` is ignored here on purpose. Desktop + Server Edition identical; mobile N/A.
```

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm test && git diff --check`
Expected: all green. Paste the summary line of `npm test` into the PR.

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md CONTRIBUTING.md
git commit -m "docs: network overview and the annotate verb"
```
PR title: `feat: network overview with agent-written roles (annotate verb)`. Body per the `pr-writing` skill: what changed and why, how it was checked (paste outputs), risks: `list` row shape gains `· role:`; `ProjectView` widened; the orchestrator skill (`~/.claude/skills/nodeterm-orchestrator`, outside this repo) owes one sentence in Collect: "annotate every station with its role and any recommendation". Mobile: N/A, additive field; mention @eneskirca.

---

## Self-review

- **Spec coverage.** §1 → Tasks 1-2. §2 → Tasks 3-5 (verb, trust, routing, bulk rule, `list` role, both shells, docs). §3 → Tasks 7-9 (view, overlay, graph, click-to-jump, escape, exclusivity). §4 → Task 6 (all eight kinds, order, `idleMs` from the setting via Task 9). §5 → Task 9 (minimap ⤢ with badge, registry command, ⌘K, board/overview exclusivity, Escape). §6 → tests in every task; relay tabs get `sticky`'s refusal path by construction (Task 3's `requiresVerified` and the relay stub); mobile N/A noted in Task 10.
- **Placeholders.** Task 2's reopen test names two harness helpers as placeholders and says so explicitly; the implementer reads `reopenNode.test.ts` first. Nothing else defers.
- **Type consistency.** `parseAnnotateArgs`/`applyAnnotation`/`NodeAnnotation` (Task 1) are the names used in Tasks 3, 4, 5. `annotateNodes`/`annotateReply` (Task 4) are renderer-only. `buildFindings`/`buildOverviewGraph`/`overviewSig`/`OverviewInput` (Task 6) are the names used in Tasks 8-9. `isOverviewOpen`/`isOverlayViewOpen`/`toggleOverview` (Task 7) are the names used in Task 9. `LaunchDelivery` entries are `{kind:'stalled', since}` / `{kind:'failed', attempts, at}` per `state/launchDelivery.ts`.
