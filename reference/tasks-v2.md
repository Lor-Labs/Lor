# Tasks v2 — emergent tasks, plain thread anchors, scope-keyed sandboxes

Rework of the task model ahead of browser use. Planned 2026-09-11 from a three-way blast-radius map (server, UI, sandbox). Execute step-by-step: each step is ≤ ~400–500 LOC, leaves `check` + `check-types` green, and is reviewed and committed by Jacob before the next starts. Nothing is pushed until all steps land.

## Why

The v1 task welds four concepts together: a routing-time prediction (the placement router's third judgment), a UI container (`task_card` as thread root), a lifecycle, and a resource grant (task tools + `task-{id}` sandbox). Consequences: users cannot predict when a task appears, a conversation cannot become a task once underway, and the placement prompt has accumulated "never a task" carve-outs (code changes, loops) because an upfront classifier keeps misfiring. Browser use lands next and must be visible without a task existing.

## Target model

- **Placement** decides channel vs thread only.
- **A task is a commitment Merlin declares mid-run**: `start_task` in a thread creates it (title + plan + status + deliverables, anchored to the thread root). User-facing rule: *when Merlin posts a plan, it's a task; no plan, it's just an answer.*
- **The computer is orthogonal.** Any thread gets warm sandbox continuity keyed on the run's `scopeKey`; activity is visible whenever tools run, task or not. Browser sessions later join the same activity surface.

## Locked decisions

1. **Anchor = `task.threadRootId`** (notNull, unique, FK `message.id` cascade). One task per thread. The task↔run join becomes `task.threadRootId = agent_run.scopeKey`.
2. **`task.cardMessageId` becomes nullable** (FK `set null` on delete). The card is a projection: always posted at task creation as a channel-level `task_card` message, no longer required to be the thread root. Clicking the card opens `task.threadRootId`.
3. **Spawned tasks keep card-as-root.** `createMerlinTask` (triggered/loop `create_task`) has no human root message; it keeps `threadRootId = cardMessageId = card.id`. Valid under the new schema; no rewrite.
4. **New tool `start_task({title, goal, plan})` adopts the current thread.** Bound on thread-scope runs only. `set_plan` / `complete_task` / `request_approval` are also bound on all thread-scope runs; they return a "no task yet — call start_task" error until one exists. `start_task` joins `SIDE_EFFECT_TOOLS` and `RESERVED_TOOL_NAMES` (replay safety; the existing `create_task` shows why). `set_plan` stays update-only.
5. **Placement goes two-way** (`channel` | `thread`); `taskTitle` deleted. The prompt biases clear delegations toward `thread` so `start_task` has a thread to adopt. All "never a task" carve-outs die with the judgment.
6. **Persistent workbench sandbox keyed on the run's real `scopeKey`, thread scope only.** Channel-scope answers stay ephemeral (do NOT copy code-session's `?? channelId` fallback — that silently persists channel scope). `scopeKey` is threaded from the run row into `RespondContext`, never re-derived from `threadRootId` (they diverge when a channel mention is ducked into a fresh thread; fixing this also fixes the latent code-session drift). `/workspace/out` is cleared at session start when there is no task — without this, a warm sandbox re-harvests unchanged files into duplicate artifact rows on every call (non-task artifacts have no identity; `resolveArtifact` blind-inserts on null taskId).
7. **Artifact scope identity is a recorded follow-up, not this refactor.** Real reseed + versioning for non-task artifacts needs a `scopeKey` column on `artifact` + partial unique index + `resolveArtifact`/seed changes (~60–100 LOC + semantic change for every consumer). Ship the out-dir clear now; do scope identity when non-task deliverable iteration proves needed.
8. **No separate human todo primitive.** The task plan is the checklist.
9. **Activity surface: docked wins.** The thread panel's docked strip generalizes; Plan/Files chips stay task-only (Files until decision 7's follow-up); a new Activity chip mirrors the live run's work log. The per-message `MerlinActivity` collapsible stays as the in-timeline historical record. It is already task-blind, so "watch Merlin's computer" works for plain answers today — browser events later stream into the same `merlin:tool` machinery.

## Hazards (from the map — verify each step against these)

- **`settleTask` captures `task` as a `const`** (`apps/worker/src/jobs/merlin-respond.ts:110`). A task created at step 4 of a run is invisible to all 8 settle sites → stuck `running` forever, and `settleAbandonedRunTask`'s fallback can't rescue it (requires `activeRunId IS NULL`). Mutable holder + set `activeRunId` at creation are both mandatory.
- **Tool contexts resolve eagerly** (`packages/merlin/src/index.ts:2007–2026` task tools; `:1998–2004` create_artifacts; `:2511` fileParkedApproval). `taskId` is baked in before the run starts. All four consumers must read from a shared mutable task ref that `start_task` writes into.
- **Replay safety**: `start_task` must be in `SIDE_EFFECT_TOOLS` (`tool-guard.ts:29`) and `RESERVED_TOOL_NAMES` (`custom-tools.ts:46`) or a recovered step double-creates the task.
- **`serializeTaskSession` becomes load-bearing** (`packages/merlin/src/artifacts/tool.ts:38–55`). Parallel non-task `create_artifacts` calls are safe today only because each gets its own ephemeral sandbox. Once a thread shares a persistent sandbox, the serializer MUST be rekeyed to the sandbox key (it duplicates `code-actions.ts:57–74 serializeScopeSession` — extract one helper).
- **Duplicate-artifact explosion** without the out-dir clear (decision 6). Fails silently: N calls in a warm non-task thread = N duplicate artifact rows + R2 uploads per file, because `seedDigests` is populated only from task seeds.
- **`AgentRunContextTask` snapshot**: a task created mid-run is absent from the run's step-0 context; compaction/recovery degrade to "no task state in prompt tail." Accepted — the row is authoritative and the next run in the scope picks it up.
- **Auto-trigger** (`isMerlinThread`): still works for mid-run tasks because the thread-scope run's placeholder is already a Merlin-authored reply in the thread. No disjunct needed; re-verify live in Step 3.

## Steps

### Step 1 — Re-anchor: schema + server + wire types (~120 LOC) — [ ] built [ ] committed

No behavior change: routing still creates card-as-root tasks; both columns are set to the card id. This step only makes `threadRootId` the join key everywhere on the server.

- `packages/db/src/schemas/tasks.ts` — add `threadRootId` (notNull, unique `task_threadRootId_uidx`, FK cascade); relax `cardMessageId` to nullable, FK `set null`, unique → partial unique (`where card_message_id is not null`); update header comment + relations.
- `packages/merlin/src/tasks.ts:23-38` — `toRealtimeTask` emits `threadRootId` + nullable `cardMessageId` (the `Exact<>` wire guard forces this); `:74-82` `settleAbandonedRunTask` linkage → `threadRootId`.
- `packages/realtime-types/src/events.ts:681-695` — `RealtimeTask` adds `threadRootId: string`, `cardMessageId: string | null`.
- `apps/api/src/routes/v1/tasks/schema.ts:40` — mirror the shape; `apps/api/src/routes/v1/loops/schema.ts:81,136` + `loops/handlers.ts:530-541` — return `threadRootId` alongside (client switches in Step 2).
- Lookup sites → `threadRootId`: `apps/worker/src/jobs/merlin-respond.ts:109-117` (the task-run detector), `apps/api/src/lib/scope-runs.ts:466-490` (`startTaskContinuationRun` scopeKey/threadRootId), `apps/api/src/routes/v1/approvals/handlers.ts:134-136` (fallback scope), `apps/api/src/routes/v1/channels/handlers.ts:1028-1040` (participant join), `packages/messaging/src/index.ts:83-89` (thread notification context).
- Writers set both columns: `apps/realtime/src/services/merlin.ts:118-168` (`createTaskWithCard`), `apps/worker/src/lib/merlin-task.ts` (`createMerlinTask`).
- Web/mobile keep compiling: `cardMessageId` going nullable touches `useTaskForCard` matchers — if the type break leaks into the apps, patch minimally here (null-guards only); the real UI move is Step 2.

**db:push owed (Jacob runs).** Non-empty `task` table: backfill first — `UPDATE task SET thread_root_id = card_message_id;` — or truncate (pre-launch). Regenerate `packages/api-client` after the API schema change.

Verify: `pnpm run check`, `pnpm run check-types`; live: channel delegation still produces a card-rooted task, approval deep link still opens the thread.

### Step 2 — Re-anchor: web + mobile UI (~180 LOC) — [ ] built [ ] committed

Type-driven mechanical move. Add `useTaskForThread(channelId, threadRootId)` beside `useTaskForCard` in both apps.

- Web re-skin predicate: `apps/web/src/components/sidebar/right-panel/thread-panel.tsx:282-283` — `isTask = rootMessage?.type === "task_card"` → `!!useTaskForThread(...)`; header strip prop at `:733-739` becomes thread-anchored.
- Mobile mirror: `apps/mobile/src/app/channel/[channelId]/thread/[threadRootId].tsx:137` (same predicate), `:285-291` (header props).
- Card click targets open `task.threadRootId`, not the card's own id: web `task-card.tsx:34-35,44,80`; mobile `task-card.tsx:36-41` (callback takes a Message — change signature to accept an id or look up the root).
- `apps/web/src/components/sidebar/right-panel/loop-panel.tsx:288-296,399-403` — deep-link via `threadRootId`; drop the `!cardMessageId` disabled guard.
- `task-thread-header.tsx` web + mobile — prop rename (`cardMessageId` → `threadRootId`) + lookup swap.
- Hooks: `apps/web/src/hooks/use-channel-tasks.ts:75-81`, `apps/mobile/src/hooks/use-tasks.ts:64-70`.
- While in here (pre-existing divergences, both ~3 LOC): mobile `doneCount` missing web's `completed → all done` case; mobile deliverables filter on `create_artifacts` where web takes `files` off every top-level call — align mobile to web.

Verify: type-check both apps; live: open task card → correct thread; task panel re-skins; loop panel history links work.

### Step 3 — Emergent tasks: `start_task` + mutable task plumbing (~300 LOC) — [ ] built [ ] committed

The highest-risk step. Both creation paths coexist after it (routing-time cards still work), so it is independently verifiable.

- `packages/merlin/src/tasks.ts` — new `start_task` tool (title, goal, initial plan; adopts the current thread; errors if a task already exists for the scope). Task tool contexts move from static `taskId` to a shared mutable ref (`getTask()` / setter) so `set_plan`/`complete_task`/`request_approval` see a task created earlier in the same run; they error politely when the ref is empty.
- `packages/merlin/src/index.ts:1855` — binding gate: `ctx.task ? taskTools : {}` → bind task tools on all thread-scope runs (`ctx.threadRootId` present); `:2007-2026` context wiring through the ref; `:1998-2004` `create_artifacts` and `:2511-2519` `fileParkedApproval` read the ref too; `:2167` `taskRulesSection` appended for all thread-scope runs (cached-prefix note: this changes prompt cache keys once, acceptable) with new `start_task` guidance ("when you commit to multi-step deliverable work, start a task and post a plan").
- `packages/merlin/src/tool-guard.ts:29` + `packages/merlin/src/custom-tools.ts:46` — register `start_task`.
- `apps/worker/src/jobs/merlin-respond.ts` — `task` becomes a mutable `let` visible to all 8 `settleTask` sites; inject a `createTask` callback that (one tx) inserts the task row (`threadRootId = scopeKey`, `activeRunId = runId`, `status: running`), posts the projected `task_card` channel message (sets `cardMessageId`), emits `task:updated` + `message:created`. Reuse `createMerlinTask`'s message-posting internals where possible.
- Renaming of `WorkbenchTaskContinuity` etc. stays out of this step (Step 5).

Verify: live in a plain thread, ask Merlin for multi-step deliverable work → `start_task` fires mid-run, card appears in channel, thread panel re-skins live, plan updates stream, task parks `waiting_for_input`/`completed` correctly at run end; kill the worker mid-run and confirm recovery does not duplicate the task.

### Step 4 — Delete the placement "task" judgment (~120 LOC, mostly removals) — [ ] built [ ] committed

- `packages/merlin/src/placement.ts` — union → `"channel" | "thread"`; delete the task bullet, both carve-outs, and `taskTitle`; add one line biasing clear delegations to `thread`. `PlacementDecision` collapses.
- `apps/realtime/src/index.ts:806-861` — delete the `placement === "task"` arm (826-851) + imports; `apps/realtime/src/services/merlin.ts:118-168` — delete `createTaskWithCard` (+ `stripMerlinMention` if it dies unused; check first).
- `packages/merlin/src/eval/harness.ts` — compiles as-is; confirm no fixture expects `task`.
- `createMerlinTask` untouched (decision 3).

Verify: channel delegation now lands as a thread reply where Merlin calls `start_task`; loops/triggered runs still spawn card-rooted tasks.

### Step 5 — Sandbox rekey to scopeKey (~120 LOC) — [ ] built [ ] committed

- Thread the run's real `scopeKey` into `RespondContext`: `apps/worker/src/jobs/merlin-respond.ts` (~5) + `packages/merlin/src/index.ts` (~10). Point code-session's `sandboxKey` at it too (fixes the `contextThreadRootId` drift).
- `packages/merlin/src/sandbox/blaxel.ts:257-266` — `withTaskSandbox` → `withWorkbenchSandbox(sandboxKey)` + exported name builder (mirror `codeSandboxName`); update `blaxel.test.ts` expectations (existing file only — no new tests).
- `packages/merlin/src/sandbox/workbench.ts` — `WorkbenchTaskContinuity` → `WorkbenchContinuity { sandboxKey, sessionId, outSeed }`; decision point `:323-326` keys on continuity (thread scope) not task; `:306` failure-harvest guard follows; Pi session id `:240` → `continuity.sessionId` (scopeKey is a uuid, passes `SESSION_ID` regex raw).
- `packages/merlin/src/artifacts/tool.ts` — context gains `sandboxKey`; rekey `serializeTaskSession` → per-sandbox-key serializer, extracted to one helper shared with `code-actions.ts`'s duplicate; task runs keep `loadTaskOutSeed(taskId)` reseed (task→scope is 1:1); non-task sessions clear `/workspace/out` at start (decision 6).
- `investigate_code`, smoke: untouched (ephemeral).

Verify: live — two runs in one plain thread reuse the warm sandbox (second run sees files from the first outside `/out`); channel-scope answer stays ephemeral; a task thread still reseeds deliverables; no duplicate artifact rows after repeated `create_artifacts` in a non-task thread.

### Step 6 — Live-upgrade UX + docked Activity surface, web (~250 LOC) — [ ] built [ ] committed

- Upgrade transitions: `use-channel-tasks.ts` invalidates the channel-messages cache when a task arrives with a newly projected card (so the card materializes); `task-card.tsx` null-task fallback polish (now a hot path for a beat after projection); `thread-panel.tsx:677-697` header flip — check the `border-b-0` toggle for layout jump; decide the card's reply-count affordance (root's `threadSummary`, ~10 LOC, optional).
- Docked strip generalization (`task-thread-header.tsx` → rename to a thread work header): renders for any thread with an active run; Plan chip only when a task exists; new **Activity** chip whose popover reuses `MerlinActivityGroup` content for the newest run's work log; approval card stays always-visible outside any popover. Per-message `MerlinActivity` untouched.
- Copy-as-Markdown heading sanity re-check (root is now the human ask, an improvement).

Verify: live upgrade of a Q&A thread into a task with the panel open; strip appears on a non-task thread while Merlin works.

### Step 7 — Mobile parity (~200 LOC, may trail) — [ ] built [ ] committed

- Screen-level `task:updated` subscription (mobile has none — the cold-cache patch at `use-tasks.ts:38-45` is a no-op when no card is mounted; mirror web's route-level `useChannelTasks`).
- Upgrade transitions on the thread screen; strip prop/lookup already moved in Step 2.
- Activity-panel parity (mobile never got commit `3f8dadbc6` — flat segment map, no work/answer split): port `MerlinActivity`/grouping. Track in `reference/mobile-parity-todo.md` if deferred.

## Deferred (recorded; don't re-litigate mid-build)

- **Artifact scope identity** (decision 7) — the unlock for non-task deliverable iteration + a Files chip on plain threads.
- **Workspace browser profile** (persistent cookie/login state; per-run sessions; frames into `merlin:tool` activity) — design doc when browser use starts; this refactor only guarantees it needs no task to be visible.
- **Pi session growth** in long-lived warm threads (session file accumulates every `create_artifacts` conversation; no cap today). Watch; cap later if real.
- **`fileParkedApproval` / approvals UX for non-task threads** — approvals already key on runId/taskId and degrade fine; revisit presentation only if confusing live.

## Deviations log

(record deviations from the plan here as steps land)
