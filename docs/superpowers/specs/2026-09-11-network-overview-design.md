# Network Overview Design

Date: 2026-09-11. Branch: `feat/network-overview`. Status: approved by David (sections 1 to 6, questions 1 to 4 answered).

## Problem

A canvas with twenty agent nodes tells you where things are, not what they are for. The minimap
shows rectangles and status strokes; the sessions sidebar shows names and states. Nothing states
each node's ROLE, and nothing lists what should change: which node is idle, which is isolated,
which group runs without a lead, which node an orchestrator recommends closing.

The Hub (an Orchestrator in Hub mode, `nodeterm-orchestrator` skill) already reads every station
during its Collect loop and already knows those answers. Today it can only put them in a sticky
note or say them to David. This feature gives that knowledge a structured home on the node and a
view that renders it beside the network's edges and live status.

## Decisions taken (David, 2026-09-11)

1. Understanding comes from agents plus deterministic heuristics. Agents write a role and a
   recommendation per node through a new shim verb; the overview adds structural and status flags.
   No model calls inside nodeterm.
2. The verb is `annotate`, admitted for verified callers only, stamped with a byline. It is not
   named `tag`: `data.tags` is a retired field that the kanban label migration
   (`renderer/lib/kanban.ts` `migrateProjectTags`) strips from every node on every canvas load, so
   anything written there is deleted at the next hydrate.
3. The overview is a full-page overlay, a third project view beside canvas and kanban.
4. Annotations persist in `.nodeterm/project.json`, git-shared with the canvas.
5. Heuristic flags in v1: idle, isolated, group without a lead, and the verdicts a node already
   wears (dropped CLI, turn failed, stalled launch, paused).
6. Graph rendering is a second read-only React Flow instance.
7. v1 is read-only: no inline role editing, no dismissing findings.
8. The idle threshold reuses `settings.agentHibernationIdleMinutes` (default 30), so Eco and the
   overview agree on what idle means.

## 1. Data model

New optional field on `CanvasNodeState` (`src/shared/types.ts`), defined in a new zero-import leaf
`src/shared/node-annotation.ts` beside `node-icon.ts`:

```ts
export interface NodeAnnotation {
  /** One line, at most ANNOTATION_ROLE_MAX (80) characters. */
  role?: string
  /** One line, at most ANNOTATION_RECOMMEND_MAX (500) characters. */
  recommend?: string
  /** Node id of the verified caller that last wrote the record. Rendered as that node's title. */
  by: string
  /** Epoch ms of the last write. */
  at: number
}
```

Rules:

- It is CONTENT, like sticky text: `projectToFile` emits it, `fileToProject` reads it, the SSH
  mirror carries it. It is never machine-local.
- `normalizeNodeAnnotation(value: unknown): NodeAnnotation | undefined` is pure and runs at BOTH
  serializer seams, `nodeStatesToFlow` (file becoming live state) and `flowToNodeStates` (live
  state becoming the next reader's file), exactly where `normalizeNodeIcon` runs
  (`renderer/state/workspace.ts:1922`, `:2003`). A cloned `project.json` is hostile input, and
  live node data is reachable by a peer canvas mutation.
- Normalization: non-object returns `undefined`; `role` and `recommend` are kept only when
  strings, collapsed to one line (`oneLine`, the helper `rename` already uses), trimmed, and
  truncated to their caps; `by` must be a non-empty string else the record is dropped; `at` must
  be a finite number else the record is dropped; a record with neither `role` nor `recommend`
  after normalization is dropped whole.
- `applyNodeMutation`, `duplicateNode`, and `reopenNode` copy the field like any other data
  field. A duplicated node keeps the annotation (the role usually still applies; the user can
  clear it through the Hub).

## 2. Verb: `annotate`

```
annotate --node <id,id> [--role "…"] [--recommend "…"] [--clear]
```

Parsing (`src/core/canvas-control-core.ts`, `parseControlRequest`):

- `--node` required; comma list, deduplicated, at most `ANNOTATE_BULK_MAX` (50).
- At least one of `--role`, `--recommend`, `--clear` required, else `annotate: nothing to write`.
- `--clear` alone removes the annotation. `--clear` with `--role` clears the recommendation and
  sets the role. `--clear` with `--recommend` clears the role and sets the recommendation.
- Without `--clear`, a flag that is absent leaves that half untouched (a role written last week
  survives a new recommendation).
- Unknown flags are refused (`unsupportedFlags`, as the headless factory does).

Trust:

- Joins `requiresVerified` in `src/core/agents/hook-server.ts`. The byline is the accountability
  story, as for `sticky`; a bearer-holder naming someone else's node id must not be able to forge
  it. The verb is new, so fail-closed from day one strands nobody.
- `by` is stamped from the verified caller's node id in the hook server route, not read from the
  request body. `at` is `Date.now()` at the write.
- Not in `DESTRUCTIVE_VERBS`, not in `DRY_RUN_VERBS`: nothing reaches a PTY, and the write is
  visible and reversible.

Routing:

- Joins `STORE_ANSWERED_VERBS` (`renderer/lib/controlRouting.ts`). The renderer writes through
  `useProjects.applyNodeMutation` on the OWNING project and `writeDisk`; for the active project it
  goes through `setNodes` + `markDirty` so React Flow stays the live source of truth. Same split
  `sticky` uses. It never switches projects and never moves the camera.
- Bulk form validates the whole id list against the owning project's nodes first and refuses on
  any unknown id, naming it, matching bulk `close`. Every id must belong to the caller's own
  project (the store lookup by node id resolves the project; ids from two projects refuse).
- Reply: `annotated <n>: <id, id>` on success. Text reply for `Accept: text/plain`, JSON
  `{annotated: string[]}` otherwise.

Server Edition: `HeadlessNodeFactory.annotate` (`src/server/headless-node-factory.ts`), modeled on
`rename`: `unsupportedFlags`, creator-ownership check (`ownsMutation`), mutate
`source.project.nodes`, `workspaceStore.save`, `publish`. Wired in `src/server/canvas-control.ts`
beside `actions.rename`.

Relay tabs: refused like `sticky` (the stub answers `E_UNSUPPORTED`).

`list`: each row gains ` · role: <role>` when the node carries one, so the Hub reads back what
it wrote in the same call it already makes. Text and JSON (`role` field) forms both change.

Agent-facing text, same PR: one line in `buildCanvasSkillBody` and one in
`buildCanvasControlInstructions` (`canvas-control-core.ts`), pinned by
`src/main/canvas-control-core.test.ts` like every other verb. The `nodeterm-orchestrator` skill's
Collect section gains one sentence: after `list`, `annotate` every station with its role and any
recommendation. That skill lives outside this repo (`~/.claude/skills`), so it is a follow-up
note in the PR, not a file in this change.

## 3. Overview surface

View mode: `ProjectView` in `renderer/state/viewMode.ts` becomes `'canvas' | 'kanban' |
'overview'`. `parseViewMap` accepts the new value. Per project, machine-local, localStorage, as
today. `isOverlayViewOpen(projectId)` returns true for kanban or overview; the Canvas guards that
read `isKanbanOpen` for canvas-only shortcuts (undo, ⌘T, ⌘⇧C, Delete, zoom chords) move to it.
`focusNodeById` keeps its kanban branch and gains an overview branch: close the overview, then
frame the node.

Component: `renderer/components/overview/NetworkOverviewView.tsx`, mounted in `Canvas.tsx` beside
`KanbanView`, no portal, same z-order contract (overlay 25 < controls cluster 26 < top banners 27
< tabbar 30). The canvas stays mounted underneath: `display:none` would resize every terminal.

Layout, top to bottom and left to right:

- Title strip (`.overview-header`): project color dot, project name, "Network overview", close
  button (×, Escape also closes). Its height clears the floating controls cluster, as the kanban
  header does.
- Graph pane (flex 1): a second `<ReactFlow>` inside its own `<ReactFlowProvider>`, read-only
  (`nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={false}`),
  `panOnDrag`, `zoomOnScroll`, `fitView` on mount and on project change, `minZoom 0.05`.
- Findings sidebar (`.overview-findings`, 360 px, collapsible with a chevron; collapsed state is
  transient).

Graph data comes from the SERIALIZED project: Canvas calls `commitActiveToStore()` before the
overlay mounts (what `GlobalKanbanView` does), then the view reads `useProjects` for the active
project's `nodes`, `bridges`, `ropes`, and `useAgentStatus` for status. It subscribes to a
primitive signature over (node count, annotation `at` values, status states) so the whole overlay
does not re-render on every hook event.

Node types, both in `renderer/components/overview/`:

- `ovNode` for every non-group kind. Card: kind glyph, title, role line (italic; "no role" dimmed
  when absent), status chip using `sessionStatusKind` + `STATE_LABEL` from
  `renderer/lib/sessionList.ts`, plus the existing verdict chips the node header already renders
  (DROPPED, TURN FAILED, QUEUED with stalled ⚠, PAUSED, SLEEPING) rendered through the same
  small components where they exist as components, otherwise the same text. Unread dot. Left
  border in the node's color. Sticky cards show the first two lines of `text`. Cards are the
  node's persisted size, so the graph keeps the canvas's proportions.
- `ovGroup` for `group`: dashed frame in the group color, label pill, worktree branch when bound,
  and a "no lead" marker when flagged.
- `parentId` and `extent` carry over so nesting renders as on the canvas.

Edges: the existing `floating` edge type (`canvas/FloatingEdge.tsx`), one edge per bridge (solid,
source's agent color) and per rope (dashed with ⏳ while `ropeVisual` says waiting, solid once
launched). `hideFanout` is ignored here: the overview exists to show the network. Ephemeral
subagent and loop cards are not drawn.

Click: a node card or a finding row calls `onGoToNode(id)`, which Canvas wires to "set the view
back to canvas, then `focusNodeById(id)`". A group row frames the group the same way.

Positions are the canvas layout. No auto-layout in v1.

## 4. Findings engine

Pure module `renderer/lib/networkOverview.ts`, no React, no store imports:

```ts
export interface OverviewInput {
  nodes: CanvasNodeState[]
  bridges: BridgeLink[]
  ropes: BridgeLink[]
  statusById: Record<string, AgentNodeStatus | undefined>
  launchById: Record<string, 'stalled' | 'failed' | undefined>
  idleMs: number
  now: number
}
export interface Finding {
  id: string                      // `${kind}:${nodeId|groupId}`
  kind: 'recommend' | 'idle' | 'isolated' | 'group-no-lead'
      | 'dropped' | 'turn-failed' | 'stalled-launch' | 'paused'
  severity: 'info' | 'warn'
  nodeId?: string
  groupId?: string
  text: string
  source: 'agent' | 'heuristic'
  at?: number                     // recommend: annotation.at; verdicts: their own stamp
}
export function buildFindings(input: OverviewInput): Finding[]
```

Rules, each with a positive and a negative test:

- `recommend` (agent, info): every node whose annotation has `recommend`. Text verbatim; the row
  shows the byline (title of `by`, falling back to the id when that node is gone) and the age.
- `idle` (heuristic, warn): node with `agentId`, status `done`, `stateAt` older than `idleMs`,
  not `hibernated`, not `paused`. A missing `stateAt` (fresh app run) yields no flag: silence is
  never evidence. `idleMs` is `settings.agentHibernationIdleMinutes * 60_000`, read by the view,
  so Eco and the overview agree.
- `isolated` (heuristic, warn): node with `agentId` and no bridge or rope touching it in either
  direction. Plain terminals, stickies, files and browsers are never isolated.
- `group-no-lead` (heuristic, warn): a group with two or more members that have `agentId`
  (direct children; nested groups count their own members), none of whose `annotation.role`
  matches `/\b(lead|orchestrator|hub)\b/i`.
- `dropped`, `turn-failed`, `paused` (heuristic, warn/warn/info): carried from `agentStatus`
  (`dropped`, `lastTurnError`, `paused`). `stalled-launch` (warn) from `state/launchDelivery.ts`
  when the entry is `stalled` or `failed`, text naming which.

Order in the sidebar: agent recommendations newest first, then heuristic `warn` grouped by kind
in the order listed, then `info`. The total count is the badge on the minimap's expand button.
A node with several findings appears once per finding; the card itself shows a small count.

`buildOverviewGraph(nodes, bridges, ropes, colorOf)` in the same module produces the React Flow
`Node[]`/`Edge[]` for the view, so the mapping is testable without rendering.

## 5. Entry points

- Expand button (`.minimap-expand`, ⤢ glyph) placed over the minimap's top-left corner, a sibling
  of `<StatusAwareMiniMap>` inside `<ReactFlow>`, with the findings-count badge (hidden at zero).
  Hidden while the board is open. Tooltip "Network overview".
- Registry command `view.overviewToggle` ("Toggle network overview", group General, scope app),
  ships unbound, remappable; `ShortcutsPanel` derives its row automatically once bound.
- ⌘K entry "Network overview" in `Canvas.buildCommands`.
- The tab's board toggle and `view.kanbanToggle` open the board and close the overview; the
  overview toggle does the inverse. The view union makes them exclusive by construction.
- Escape closes the overview when it is the top layer.

## 6. Surfaces, errors, testing

Surfaces:

- Desktop: full.
- Server Edition: full. The verb is core (`parseControlRequest`, hook server, headless factory),
  the overlay is pure renderer, the settings read has a real bridge leg.
- Relay tabs: the overview renders from the project the tab already holds; `annotate` is refused
  with the same message as `sticky`.
- Mobile: N/A. The annotation is an additive `project.json` field the phone ignores. The iOS
  repo owes nothing; noted for @eneskirca in the PR.

Errors:

- A malformed annotation never reaches render: both seams normalize it.
- `annotate` with an unknown id refuses the whole request and names the id.
- `annotate` from an unverified caller is refused by the hook server with the messaging refusal
  sentence, before the renderer sees it.
- `buildFindings` with an empty status map returns only recommendations and structural flags.
- A node referenced by `by` that no longer exists renders its id as the byline.

Tests:

- `renderer/lib/networkOverview.test.ts`: every finding rule positive and negative, ordering,
  the graph mapping, nested group membership.
- `shared/node-annotation.test.ts`: normalization (caps, non-strings, missing `by`, missing
  `at`, empty record).
- `renderer/state/workspace.test.ts`: annotation round-trip through both seams, hostile input
  dropped at each seam independently (mutation-pinned, as for `icon`).
- `main/canvas-control-core.test.ts`: `annotate` parse (required flags, `--clear` combinations,
  bulk cap), both doc bodies contain the signature line.
- `core/agents/messaging-verified-only.test.ts` (or its sibling): `annotate` refused when
  unverified.
- `renderer/lib/controlRouting.test.ts`: `annotate` is store-answered.
- `server/headless-node-factory.test.ts`: annotate writes, refuses unowned, refuses unknown flag.
- `renderer/state/viewMode.test.ts`: `parseViewMap` accepts `overview`, `isOverlayViewOpen`.
- `renderer/components/overview/NetworkOverviewView.test.tsx`: smoke render with two agent
  nodes, one bridge, one group, one recommendation; click on a card calls `onGoToNode`.
- `git diff --check`, `npm run typecheck`, `npm test` before the PR.

## Out of scope for v1

- Auto-layout by dependency (dagre over ropes and bridges).
- Editing a role or dismissing a finding from the overview.
- Orphan tmux sessions with no node (the RAM panel's sweep already lists them).
- An all-projects (Omni) overview.
- Findings on the kanban card or the node header; the overview is the only consumer of the
  engine in v1, the `list` row and the minimap badge aside.
