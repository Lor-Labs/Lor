# Loops — scheduled headless Merlin runs (execution runbook)

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as phases land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

## What a Loop is

> A scheduled, headless Merlin invocation living in a channel, with its own
> card and run history, that can act directly (post messages, call connector
> tools, do sandbox/file work) or spawn a tracked Task — repeating on a cron
> schedule until an end condition is met, it's paused, or completed.

Loops are a first-class automation primitive next to Act triggers
(`reference/automation-primitives.md`) — *time-driven* where triggers are
*event-driven*. They deliberately ride the same rails: `respond()` with the
`triggered` context, `agent_run` rows, run-event trails, budgets, recovery.

Demo storyboard target (`/demo` route, `LoopScene`): user asks Merlin
conversationally → Merlin replies with a Loop card (name, "Every weekday at
9:00 AM · until the mobile app ships", tool badges, **Create Loop** button) →
card flips Active.

UI reference (ChatGPT scheduled tasks — inspiration, not pixel spec):
- Inline **suggestion pill** in chat after a relevant answer ("⏱ Track Bay
  Area rents weekly") — our `propose_loop` card.
- Compact **status pill** ("Paused · Bay Area Rent Tracker").
- Tapping opens an **editor sheet**: name field, editable instructions
  textarea, Repeat (frequency), Time, End repeat. Our schema carries all of
  it: name, instructions, schedule+timezone, endCondition, status.

## Locked decisions (do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Source of truth | Postgres (`loop` table). No per-loop BullMQ schedulers — Redis is never a second source of truth. |
| Tick | One shared `sweep-due-loops` job on the existing maintenance queue, `upsertJobScheduler`, every 60s. |
| Claim | CAS: `UPDATE loop SET next_run_at=<next-from-now>, last_run_at=now() WHERE id=? AND status='active' AND next_run_at<=now() RETURNING …`. Winner creates the run + enqueues. |
| Next-fire computation | `croner` (cron expr + IANA tz), computed only at activate/edit/resume/claim. Catch-up: fire once, next from *now* — never backlog missed slots. |
| Queue | Dedicated `LOOP_RUN_QUEUE` + own worker (fairness isolation from Act webhook bursts; enables split scaling later). Same worker process for now. |
| Executor | Extract the shared unattended-run body out of `createTriggeredRunProcessor` (apps/worker/src/jobs/triggered-run.ts); Act and Loop processors are thin wrappers over it. |
| Run scope | `agent_run.scopeKey = loop.id` → the existing unique active-scope index gives overlap protection (skip tick if previous run in flight) AND the per-scope closing-note chain gives run-to-run memory. |
| Capabilities | Full `respond()` toolset — connector tools per channel capabilities, brain writes, `post_channel_message`, `create_task`, and DIRECT `create_artifacts` / code actions (artifacts are NOT task-gated; `artifact.taskId` is nullable). Heavy iterative deliverables should still go through a spawned task (plan/thread/approvals/versioned artifacts). |
| Sandbox scope | New optional `sandboxKey` on `RespondContext`, resolved `ctx.sandboxKey ?? ctx.threadRootId ?? ctx.channelId`; loop runs pass `loop.id` so co-channel loops/triggers never share a warm checkout. |
| End condition | Free text on the loop; injected into the prompt; model calls `complete_loop` (new triggered tool, bound only when executor present, listed in `SIDE_EFFECT_TOOLS`). |
| Failure accounting | At RUN SETTLEMENT, not BullMQ events (the triggered processor catches errors, transitions the run to `failed`, and returns without rethrowing — BullMQ sees success). Terminal `failed` (incl. `out_of_credits`) → increment `consecutiveFailures`; clean finish → reset to 0; `stopped` → no change. Count only terminal settlement, never per recovery attempt. |
| Auto-pause | At 5 consecutive failures: `status='paused'`, `pausedReason='failures'` (or `out_of_credits`), post a Merlin channel note, emit `loop:updated`. |
| Credits | Loop runs ARE credit-gated (unlike project archive). Out-of-credits counts toward auto-pause. |
| Pause semantics | Kill-switch re-read at process time (cancels queued runs) AND in-flight stop: set `agent_run.stopRequestedAt` + publish runId on `AGENT_RUN_STOP_CHANNEL` (same as user stop). Look up the active run via `scopeKey = loop.id`. |
| Cadence | Hard floor 5 min. Validation samples the next ~20 fires via croner and rejects if ANY gap < 5 min (uneven crons like `0,2 * * * *` beat a two-fire check). Any gap < 1 hour → activation requires `confirmHighFrequency: true` (server returns a `requires_confirmation` error otherwise); persist `highFrequencyConfirmedAt/By`. |
| Delete | None in v0. Pause/complete only — completed loops are cheap audit rows. |
| Realtime | `loop:updated` emitted to the CHANNEL room (channel-room membership already implies access — unlike project events, no audience math). |
| Provenance | `agent_run.loopId` + `agent_run.scheduledFor`; `task.originRunId`; `artifact.originRunId`. Loop history = `agent_run WHERE loop_id=? ORDER BY scheduled_for DESC` (executions only; skipped ticks leave no row — accepted). |
| History retention | Run rows/counters/closing notes persist forever; full tool trails only within `RUN_EVENT_RETENTION_MS` (7 days, prune-run-events.ts). `agent_run_tool_result` durably holds posted-message ids past that. |

## Phases

Each phase is independently executable and leaves the tree green
(`pnpm run validate`). Don't start a phase until its predecessor is checked.

---

### [x] L1.1 — Schema (packages/db, packages/realtime-types)

New file `packages/db/src/schemas/loops.ts` (relative imports only — this
package is uncompiled):

- `loopStatusEnum`: `draft | active | paused | completed`
  (`draft` = proposed via card, not yet activated)
- `loopPausedReasonEnum`: `manual | failures | out_of_credits`
- `loop` table:
  - `id`, `createdAt`, `updatedAt` (mirror `task` table idioms)
  - `workspaceId`, `channelId` — cascade FKs
  - `creatorId` — set-null FK to user
  - `cardMessageId` — set-null FK to message, UNIQUE index (mirrors
    `task.cardMessageId` lookup pattern; nullable: L2 sets it)
  - `name` text notNull, `instructions` text notNull
  - `schedule` text notNull (cron expr), `timezone` text NULLABLE (IANA;
    null on drafts = "not pinned yet", activation pins it — see the
    2026-08-23 L2.1 revision in the deviations log)
  - `endCondition` text nullable
  - `status` default `draft`
  - `pausedReason` nullable
  - `nextRunAt`, `lastRunAt` timestamps nullable
  - `consecutiveFailures` integer notNull default 0
  - `completedNote` text nullable (set by `complete_loop`)
  - `highFrequencyConfirmedAt` timestamp nullable,
    `highFrequencyConfirmedBy` set-null FK to user
  - Indexes: partial `(nextRunAt) WHERE status = 'active'` (the sweep probe —
    use `sql` template for the where), `(channelId, status)`,
    `(workspaceId, createdAt)`
- Relations block mirroring `tasks.ts`.

Edits to existing schemas:
- `agent-runs.ts`: `loopId` set-null FK to loop + comment (mirror `triggerId`
  provenance comment); `scheduledFor` timestamp nullable ("when the schedule
  meant this run to fire; createdAt is when it was claimed"). Index
  `(loopId, createdAt)` for the daily-cap / history queries. Beware
  import cycles: loops.ts references agentRun? It does NOT — only agent-runs
  references loop. Keep it one-directional.
- `tasks.ts`: `originRunId` set-null FK to `agentRun` (which run's
  `create_task` spawned it; null for human/conversational creation) + index.
- `artifacts.ts`: `originRunId` set-null FK to `agentRun` + index (loop run
  UI lists direct files per run).
- `messages.ts`: `message_type` enum += `loop_card` (comment: the loop's
  card message — row looked up by `loop.cardMessageId`, mirrors `task_card`).
- Export loops schema from the schema barrel (see how `tasks.ts` is exported).

`packages/realtime-types/src/events.ts`: `RealtimeMessageType` += `loop_card`.
Check message-type switch/render sites that will now see the new type — web
`message-item.tsx`, mobile `message-row.tsx` fall back to default rendering
until L2; make sure nothing throws on unknown-but-typed values.

**DB PUSH: NEVER run `pnpm db:push` or any variant — the user runs it
themselves. Flag prominently in the final message that a push is pending**
(new table + 3 enum additions + 4 columns).

Validation: `pnpm run validate`.

---

### [x] L1.2 — Queue types + schedule helpers

`packages/realtime-types/src/queues.ts`:
```ts
export const LOOP_RUN_QUEUE = "loop-run"
export const LOOP_RUN_JOB = "loop"
export type LoopRunJobData = {
  runId: string
  loopId: string
}
```
(No payload/label like `TriggeredRunJobData` — the processor loads the loop
row fresh for kill-switch + prompt inputs anyway.)

`packages/realtime-types/src/events.ts`: add `loop:updated` server→client
event carrying a full `RealtimeLoop` snapshot (mirrors `task:updated` /
`RealtimeTask` — the card renders from the event, no refetch).

New `packages/merlin/src/loop-schedule.ts`, exported as
`@repo/merlin/loop-schedule` (add to merlin package.json exports; api +
worker + realtime all already depend on @repo/merlin). Add `croner` to
packages/merlin dependencies (pick the current stable major; it's
dependency-free). Functions:

- `nextLoopRunAt(schedule: string, timezone: string, from?: Date): Date | null`
  — croner `nextRun(from ?? new Date())`; null when the cron never fires
  again. Invalid tz/expr must throw a typed error, not crash the sweep.
- `validateLoopSchedule(schedule, timezone): LoopScheduleValidation` —
  parse; sample the next 20 fires; return
  `{ ok: true, minGapMs, requiresConfirmation }` where
  `requiresConfirmation = minGapMs < 3_600_000`, or
  `{ ok: false, reason }` when unparsable / any gap < 5 min / fewer than 2
  future fires. Constants exported: `LOOP_MIN_GAP_MS = 5 * 60_000`,
  `LOOP_CONFIRM_GAP_MS = 3_600_000`.
- `describeLoopSchedule(schedule, timezone): string` — human-readable
  ("Every weekday at 9:00 AM (America/New_York)") for cards/notes. Keep
  simple: handle the common day/hour/minute shapes, fall back to the raw
  cron string.

Unit tests `loop-schedule.test.ts` (vitest exists in packages/merlin — see
`sandbox/code-session.test.ts`): uneven-gap cron rejected, `* * * * *`
rejected, `0 9 * * 1-5` ok + no confirmation, `*/30 * * * *` ok +
requiresConfirmation, DST-boundary tz sanity, invalid expr/tz → ok:false.

Validation: `pnpm run validate` (runs merlin tests).

---

### [x] L1.3 — Merlin: complete_loop, loop prompt, sandboxKey

`packages/merlin/src/triggered.ts`:
- `export type TriggeredCompleteLoop = (input: { closingNote: string }) =>
  Promise<void>`
- `RunTriggeredContext` gains optional `completeLoop?: TriggeredCompleteLoop`
  and optional `loop?: { name: string; scheduleDescription: string;
  endCondition: string | null }` (presence of `loop` switches the prompt
  section; presence of `completeLoop` binds the tool).
- New `complete_loop` tool in `triggeredTools` — but ONLY bound when the
  executor exists. Follow the existing conditional-context pattern in
  `respond()`: tools whose context member is absent must not be included.
  Concretely: split `triggeredTools` or spread
  `...(ctx.triggered.completeLoop ? { complete_loop } : {})` at the
  `builtinTools` site in index.ts. Description: "The loop's end condition is
  met — permanently complete this loop so it never runs again. Include a
  closing note summarizing the outcome. Only call this when the end
  condition is genuinely, verifiably met."
  Input: `{ closingNote: z.string().min(1).max(2000) }`.
- Add `"complete_loop"` to `SIDE_EFFECT_TOOLS` in `tool-guard.ts` (a retried
  step must not double-complete).
- `loopPromptSection(t)` — variant of `triggeredPromptSection` for loop runs:
  - "## Scheduled loop run" — invoked on a schedule ("{name}", runs
    {scheduleDescription}), nobody watching, only tools have effect.
  - The loop instructions as the brief.
  - End condition block when present: check it FIRST; if met, call
    `complete_loop` (and usually post a final message) instead of doing the
    work again.
  - Same disposition rules + closing-note (handoff) section as triggered —
    successor framing works identically since runs serialize per loop.
- `packages/merlin/src/index.ts` (`respond`):
  - `RespondContext` gains optional `sandboxKey?: string`.
  - `propose_code_change` context: `sandboxKey: ctx.sandboxKey ??
    ctx.threadRootId ?? ctx.channelId`. Check whether `investigate_code` /
    artifacts context also key a sandbox or session by scope — apply the same
    override wherever `threadRootId ?? channelId` keys a persistent sandbox.
  - Prompt assembly: when `ctx.triggered.loop` is set use
    `loopPromptSection`, else `triggeredPromptSection` (both call sites —
    fresh and resume branches if both exist; verify).
  - Bind `complete_loop` tool + context executor when present.

Loop-run briefing: new `loopRunBriefing({ loopId, channelId, runId })` in a
new `packages/merlin/src/loop-runs.ts` (export `@repo/merlin/loop-runs`),
modeled directly on `actRunBriefing` in `act-runs.ts` (read it first): last
run's closing note for `scopeKey = loop.id` + channel activity since
`lastRunAt`. Reuse shared internals from act-runs if extractable without
churn; otherwise parallel implementation is fine at this size.

Validation: `pnpm run validate`.

---

### [x] L1.4 — Worker: shared executor, loop processor, sweep, settlement

The heart. Read `apps/worker/src/jobs/triggered-run.ts` fully first
(~522 lines) plus `apps/worker/src/index.ts` bootstrap and
`apps/worker/src/jobs/prune-run-events.ts` (sweep idioms).

1. **Extract the shared unattended executor** to
   `apps/worker/src/lib/unattended-run.ts`:
   `runUnattended(deps, params)` covering the common body of
   triggered-run.ts L245–L521: load run row → claim (`claimAgentRun`,
   handle terminal/legacy/exhausted) → credits gate (emit `billing:updated`
   on refusal) → conversation from resume-or-payload → `respond()` with
   caller-supplied `triggered` context → `saveHandoffNote` → transition →
   write-back (budget floors + per-workspace redis lock, verbatim) → the
   catch that maps LeaseLostError/abort to silent exit and everything else
   to `failed` with `budget_wall_clock`/`error` stopReason.
   Parameterize only what differs:
   - `killSwitch: (run) => Promise<{ proceed: true, …inputs } | { proceed: false }>`
     (Act: connectorTrigger enabled/instructions; Loop: loop.status active)
   - `buildTriggeredContext(run, inputs)` → the `triggered` object
   - `briefing` composer
   - `onSettled?: (outcome: "complete" | "failed" | "stopped", stopReason) =>
     Promise<void>` — NEW hook, called at every terminal transition inside
     the executor (this is where loop failure accounting lives; Act passes
     nothing). Make sure EVERY terminal path calls it exactly once: credit
     refusal, clean complete, stopped_by_user, and the catch-all failure.
     Recovery re-attempts (LeaseLost/abort silent exits) must NOT call it.
   - optional `sandboxKey` passed through to respond ctx.
   Act processor (`createTriggeredRunProcessor`) keeps its flush/two-shape
   job handling and `createMerlinTask`, then delegates to the executor.
   Behavior of Act runs must be byte-for-byte identical — this is a pure
   refactor plus hooks. `createMerlinTask` moves to a shared lib
   (`apps/worker/src/lib/merlin-task.ts`) so the loop processor reuses it;
   thread `originRunId` into its `schema.task` insert now that the column
   exists.

2. **Loop processor** `apps/worker/src/jobs/loop-run.ts`:
   `createLoopRunProcessor(emitter, redis, respondQueue)` handling
   `LoopRunJobData`:
   - Load run + loop. Kill switch: `loop.status !== "active"` → transition
     queued run to stopped (mirror the trigger-disabled path) and exit.
   - Briefing via `loopRunBriefing` (best-effort, warn + null on error).
   - `triggered` context: `label: "Loop · {name}"`,
     `instructions: loop.instructions`, `loop: { name,
     scheduleDescription: describeLoopSchedule(...), endCondition }`,
     `postMessage`/`createTask` (pass the run id as `originRunId`),
     `completeLoop`: sets `status='completed'`, `completedNote`,
     `pausedReason=null`, `nextRunAt=null` (CAS `WHERE status='active'`),
     emits `loop:updated` to `channelRoom(loop.channelId)`.
   - `sandboxKey: loop.id`.
   - `onSettled`: terminal `failed` → increment `consecutiveFailures`
     (single UPDATE … RETURNING); if it reaches 5 → pause
     (`status='paused'`, `pausedReason= stopReason === "out_of_credits" ?
     "out_of_credits" : "failures"`, `nextRunAt=null`), post Merlin channel
     note ("Paused the loop \"{name}\" after 5 consecutive failed runs —
     resume it when ready."), emit `loop:updated`. Terminal `complete` →
     reset counter to 0 (skip the write when already 0). `stopped` → no-op.

3. **Sweep** `apps/worker/src/jobs/sweep-due-loops.ts`:
   - `SELECT id, schedule, timezone FROM loop WHERE status='active' AND
     next_run_at <= now()` (hits the partial index; LIMIT ~100 per tick).
   - Per loop: compute `next = nextLoopRunAt(schedule, tz)`; on a throw or
     null, pause the loop (`pausedReason='failures'`, log) instead of
     wedging the sweep. CAS-claim (RETURNING `next_run_at` pre-advance as
     `scheduledFor`… simpler: capture the due `nextRunAt` from the probe and
     re-check it in the CAS predicate `AND next_run_at <= now()`). Losers
     skip silently.
   - Winner: INSERT `agent_run` (`scopeKey: loop.id`, `loopId`,
     `scheduledFor: <the due nextRunAt>`, `channelId`, `workspaceId`, env
     budgets — copy the budget block from `createMerlinTask`;
     `triggerMessageId`/`messageId`: check nullability — triggered runs are
     created without a placeholder message, find how Act dispatch inserts
     its run row and mirror it). Unique-active-scope violation
     (`isUniqueViolation`) → previous run still in flight → log + skip
     (nextRunAt already advanced = tick skipped; intended).
   - Enqueue `LOOP_RUN_JOB` on `LOOP_RUN_QUEUE`
     (`jobId: runId`, attempts: 2, fixed backoff 5s, removeOnComplete —
     mirror Act's options). Enqueue failure → delete the orphan run row
     (mirror `createMerlinTask`'s unwind).

4. **Bootstrap** `apps/worker/src/index.ts`: new `Queue` + `Worker` for
   `LOOP_RUN_QUEUE` (own modest concurrency, mirror triggered worker's
   redis opts), `maintenanceQueue.upsertJobScheduler("sweep-due-loops",
   { every: 60_000 })`, wire the sweep into the maintenance worker's
   job-name dispatch, graceful-shutdown close alongside the others.

5. **Pause/stop integration point** (used by the L3 API, build now): a
   helper in `apps/api/src/lib/loops.ts` — `pauseLoop(loopId, reason)`:
   CAS status to paused, `nextRunAt=null`; find active run
   (`scopeKey=loop.id`, state in queued/working/finalizing), set
   `stopRequestedAt`, publish runId on `AGENT_RUN_STOP_CHANNEL` (see how the
   existing user-stop endpoint does it — grep `AGENT_RUN_STOP_CHANNEL` in
   apps/api); emit `loop:updated`. Resume: validate schedule again,
   recompute `nextRunAt` from now, status back to active.

Pitfalls (earned the hard way elsewhere in this repo):
- `attemptsMade` off-by-one: last-attempt = `job.attemptsMade + 1 >=
  (job.opts.attempts ?? 1)` — but note settlement accounting does NOT hang
  off BullMQ attempts at all; the executor's `onSettled` is the only counter.
- Drizzle self-alias joins collapse to `never` — scalar SQL subqueries.
- Passing `channelId: null` into respond silently drops connector tools —
  loop runs always pass the loop's channelId.
- Type fallback branches as the real type (`Promise.resolve<T>`), never let
  a fallback infer `never[]`.

Validation: `pnpm run validate`. Manual smoke (requires user to have pushed
schema): insert an active loop row via SQL with `next_run_at = now()`,
watch worker logs claim → run → posted message; flip channel capabilities to
verify connector tools bind.

---

### [x] L2 — Conversational creation (propose_loop → card → activate)

Mirror the `task_card` pattern end to end (`createTaskWithCard` in
apps/realtime `services/merlin.ts`, card rendering in web
`chat/task-card.tsx` + `message-item.tsx`, row lookup by cardMessageId).

- [x] L2.1 `propose_loop` Merlin tool (conversational runs, NOT triggered
  runs): Merlin translates natural language → `{ name, instructions,
  schedule (cron), timezone, endCondition? }`. Validates via
  `validateLoopSchedule` at proposal time so the card never carries an
  invalid cron. Executor creates the `loop` row (`status='draft'`) + posts
  a `loop_card` message + sets `cardMessageId`.
  Shipped: tool + `ProposeLoopExecutor` in `@repo/merlin` `loops.ts`
  (executor-callback pattern like the triggered disposition tools; in
  `SIDE_EFFECT_TOOLS`); bound in respond() via new
  `RespondContext.proposeLoop` (never set on triggered/loop runs) with
  `LOOPS_PROMPT_LINE`; worker executor `createLoopCard` in
  `apps/worker/src/lib/merlin-loop.ts` (card content = plain-text
  `name — describeLoopSchedule(...)` fallback; compensation-deletes the
  card if the row insert fails; emits `loop:updated`), threaded from
  `merlin-respond.ts` with `creatorId = trigger message author`.
- [x] L2.2 API `POST /workspaces/:slug/loops/:id/activate` — guards: channel
  access via `resolveChannelAccess` (deny = `not_found`, fail closed),
  status must be `draft` (or `paused` for resume — separate endpoint in
  L3), body carries `timezone` (required IANA — clients default it to the
  device tz, editable before accept; server validates and PINS it on the
  row), re-validate schedule with that tz; `requiresConfirmation` and no
  `confirmHighFrequency: true` in body → 409/422 `requires_confirmation`
  with fires-per-day info; on confirm persist `highFrequencyConfirmedAt/By`.
  Compute first `nextRunAt`, flip active, emit `loop:updated`. Plus a
  channel loops read (row lookup by cardMessageId) for the web card.
  Route additions → run `pnpm run validate` (route-tree/generated checks).
  Shipped as `apps/api/src/routes/v1/loops/` (schema/routes/handlers/index,
  mounted in app.ts): `GET /v1/channels/{channelId}/loops` (newest first,
  limit 50, serialized via drift-guarded `toRealtimeLoop`) and
  `POST /v1/loops/{loopId}/activate` (archived channel → 400; non-draft →
  409; invalid schedule/tz → 400; unconfirmed sub-hourly → 422
  `{ code: "requires_confirmation", firesPerDay }`; CAS on draft status;
  best-effort `loop:updated` emit).
- [x] L2.3 Web card (`chat/loop-card.tsx`): name, human schedule
  (`describeLoopSchedule`), end condition line ("until the mobile app
  ships"), status chip (Draft/Active/Paused/Completed + next/last run
  time), **Create Loop** button on drafts (confirmation dialog when the
  activate call returns `requires_confirmation`). Drafts with null tz
  render the schedule in the viewer's device timezone
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and the activate
  call sends it (editable before accepting). Live flip via `loop:updated`
  (channel room — client already joins it). ChatGPT-style editor sheet
  (edit name/instructions/schedule before activating) is L3-optional; v0
  activates as proposed.
  Shipped: `use-channel-loops.ts` hook (mirrors `use-channel-tasks`:
  one query per channel + `loop:updated` cache merge; `useLoopForCard`
  by cardMessageId), `lib/loop-ui.ts` status meta, `loop-card.tsx`
  (drafts get an IANA timezone Select defaulting to device tz + Create
  Loop; 422 opens the fires-per-day AlertDialog and resends with
  `confirmHighFrequency`), `message-item.tsx` renders `loop_card` in the
  same avatar/header row as task cards. `describeLoopSchedule` MOVED to
  dependency-free `@repo/realtime-types/loops` (re-exported from
  `@repo/merlin/loop-schedule` so server call sites are unchanged) — web
  imports realtime-types but must not import the server-side merlin pkg.
- [x] L2.4 Mobile: render `loop_card` as a readable card (status + name +
  schedule); activation can be web-only for v0 — note it in
  `reference/mobile-parity-todo.md`.
  Shipped: `hooks/use-loops.ts` (mirrors use-tasks: channel query +
  `loop:updated` merge; `useActivateLoop` — device-tz activation, 422
  high-frequency confirm as a native Alert), `components/loop-card.tsx`
  (pill: infinity icon, name, plain-english schedule; drafts get a Create
  Loop button, other statuses a chip), `message-row.tsx` branch. Parity
  note updated (detail view/editor + L3 management web-only; mobile always
  pins the device tz).

### [ ] L3 — Management & run history UI

- [x] L3.1 Pause / resume / complete (2026-08-24): `POST
  /v1/loops/{loopId}/pause|resume|complete`. Pause/complete use the L1.4
  lib helpers incl. the in-flight run stop (extracted `stopInFlightRuns`;
  new `completeLoopManually` — CAS over active|paused, sets
  `completedNote: "Marked completed by the team"`); resume re-validates +
  recomputes nextRunAt + resets failures, refused on archived channels
  (400) like activation. Wrong-state calls → 409. Handlers share
  `loadAccessibleLoop` (denials → 404 fail closed). Web: header actions in
  `loop-panel.tsx` — Pause/Play icon button + Mark-completed with an
  are-you-sure dialog (completing is permanent); `useLoopLifecycle` in
  `loop-actions.tsx`. Mobile: chip flips live via loop:updated; actions
  noted web-only in the parity todo.
- [x] L3.2 Channel loops surfacing (2026-08-24, revised per user feedback):
  Discord-style "Loops — N" section at the top of the channel overview
  (members) panel (`loops-overview-section.tsx` inside
  `workspace-members-panel.tsx`) — first 3 loops (sorted active → paused →
  draft → completed, newest first within groups; hidden when the channel
  has none), "Show N more…" opens the full list panel
  (`loops-list-panel.tsx`, compact view `{ type: "loops" }`). Rows
  (`components/loops/loop-row.tsx`, shared) show icon, name, schedule +
  next/last run subtitle, status chip, and open the loop detail panel;
  the detail panel's X/back returns to the overview (default header
  behavior — the list panel is reached only via Show more). The earlier
  chat-header ∞ toggle was removed — discovery lives in the overview
  panel.
- [x] L3.3 Loop detail run history (2026-08-24): `GET /v1/loops/{loopId}/runs`
  — newest scheduled fire first (`coalesce(scheduled_for, created_at)`,
  limit 20), per run: state, stop reason, closing note (`handoffNote`),
  credits spent, recorded actions (distinct `agent_run_tool_result` tool
  names), spawned tasks (`task.originRunId`) and direct artifacts
  (`artifact.originRunId`, serialized via the artifacts module's exported
  `serializeArtifact`). Web: "Recent runs" section in `loop-panel.tsx`
  (non-drafts) — collapsed rows show fire time + one-line note preview;
  completed runs wear NO status chip (success is the default outcome), only
  exceptional states (Running/Failed/Stopped/Queued) get a quiet colored
  word. A chevron signals expandability; expansion animates via the
  grid-rows 0fr→1fr trick (preview folds away as the detail unfolds).
  Expanded: closing note rendered as markdown via the chat `MessageMarkdown`
  (citations included), actions as mono chips, stop reason,
  task rows (click opens the task thread) and artifact chips
  (`ArtifactFileCard`). `useLoopRuns` in `use-channel-loops.ts`;
  `loop:updated` invalidates the history so settlements refresh it live.
  DELIBERATELY PUNTED from L3.3: per-run tool-trail replay (the run-event
  machinery exists but notes + recorded actions cover the need; revisit on
  demand).
- [x] L3.4 Edit schedule/instructions on non-drafts (2026-08-24):
  `PATCH /v1/loops/{loopId}` now takes `{ schedule?, instructions?, name?,
  confirmHighFrequency? }` (≥1 field) and works on draft|active|paused —
  completed is immutable (409). Schedule edits re-validate with the pinned
  tz; ACTIVE loops get `nextRunAt` recomputed; a sub-hourly cadence needs a
  fresh `confirmHighFrequency` (422 `requires_confirmation`) when it's
  newly sub-hourly or TIGHTER than the consented gap — loosening within an
  already-confirmed band rides the existing consent
  (`highFrequencyConfirmedAt/By` refreshed on new consent). CAS on the
  status the edit was computed against (racing pause/activate → 409 retry).
  Web: `useUpdateLoop` (replaces useUpdateLoopSchedule — optimistic, 422
  rolls back + opens the confirm dialog showing the NEW cadence), schedule
  editor enabled for active/paused, Prompt section editable in place
  (pencil → textarea → Save; takes effect from the next fire). Name edit is
  API-ready, no web UI yet (punch list).
- [x] Punch list, web (2026-08-24): DELETE `/v1/loops/{loopId}` (hard-deletes
  the row AND its card message — an orphan card would render stale forever;
  in-flight runs get the pause-style stop; run rows survive via set-null
  FK; new `loop:deleted` channel-room event, handled by web + mobile
  caches). Panel … menu now on every status: Rename (non-completed →
  dialog, PATCH `name`), Mark completed (active/paused), Delete (always,
  destructive + confirm; closes the panel to the overview). Timezone row
  hidden for hourly schedules (reads the same in every tz). Loop-view
  header drops the collapse toggle (`hideCollapse`); prompt is
  click-to-edit with blur-save. Editor-sheet-before-activate DROPPED as
  obsolete — the detail panel already edits drafts in place.
  Still open: mobile management (detail view/editor/lifecycle — see
  mobile-parity-todo), per-run tool-trail replay (punted).
- 2026-08-24 — Design simplification round (user feedback vs ChatGPT):
  the chat card is now a text-only PILL — "Every hour · Name" with the
  schedule tinted (text-primary); state reads from the leading word
  ("Paused · Name", dimmed "Completed · Name") — no badges, no icon tile;
  drafts keep a Create Loop button beside the pill. Overview-section rows
  lost their badges/icons too (name + schedule, quiet status word on the
  right) and COMPLETED LOOPS ARE HIDDEN there — the arrow button beside
  the LOOPS title opens the full list panel (which shows everything,
  completed sorted last). Also: placement prompt gained a loops carve-out
  (recurring/scheduled asks are never a "task" — a live misroute created a
  plan-less task shell around a propose_loop call), and web's task card no
  longer renders the empty plan well on plan-less tasks.

## Decisions & deviations log

- 2026-08-23 — Runbook created. Architecture locked per the table above
  (dedicated queue over shared; settlement-based failure counting; direct
  artifacts confirmed possible — artifacts are not task-gated).
- 2026-08-23 — L1.2: `loop:updated` carries a full `RealtimeLoop` snapshot
  (mirrors `task:updated`; the card renders from the event, no refetch).
  Wire types are drift-guarded against the DB rows at compile time in
  `@repo/merlin` (`wire-guard.ts`; `toRealtimeLoop` in `loops.ts`,
  `toRealtimeTask` in `tasks.ts` — the latter also deduped three
  `serializeTask` copies across api/worker/realtime).
- 2026-08-23 — L1.3: loop briefings have NO 24h age cutoff (a weekly loop's
  predecessor is 7 days old and is exactly what the successor needs);
  trigger briefings keep theirs. Shared composer:
  `composeRunChainBriefing` in act-runs.ts.
- 2026-08-23 — L1.4 additions beyond the plan: (1) `sweepDeadRuns` gained a
  `redis` param and a loop-settlement pass — a force-failed dead loop run
  reaches its terminal transition in the sweep, so the failure counter /
  auto-pause runs there too, or dead runs would never count. (2) Act
  triggered runs now also record `task.originRunId` when their disposition
  spawns a task (free once the column existed). (3) In the shared executor,
  `onSettled` fires after the terminal transition but BEFORE write-back —
  a write-back failure must not distort failure accounting.
- 2026-08-23 — L2.1 timezone (REVISED): `loop.timezone` is now NULLABLE.
  Merlin passes a tz on propose_loop only when the conversation explicitly
  establishes one; null = "not pinned yet" — clients render the draft's
  schedule in the viewer's device timezone, and ACTIVATION pins the
  concrete tz (activate body requires it; defaults client-side to device
  tz, editable before accepting). Invariant: active/paused loops always
  have a tz — `nextLoopRunAt`/`validateLoopSchedule` still require a
  string, so the compiler forces every runtime path to prove it (sweep
  pauses an active loop with null tz; resume rejects it).
  `describeLoopSchedule` accepts null (omits the suffix). Draft validation
  runs in UTC — the 5min/1h gap thresholds are tz-insensitive, and
  activation re-validates with the pinned tz. Also: propose_loop stays
  bound on task-thread runs (they're conversational; only the unattended
  processors never pass the executor).
- 2026-08-23 — L2.2 paths: mounted as `/v1/channels/{channelId}/loops` +
  `/v1/loops/{loopId}/activate` (the runbook draft said
  `/workspaces/:slug/loops/:id/activate`) — mirrors the tasks/approvals
  convention; the workspace is implied by the loop row and access is
  resolved per channel. Denials 404 (not 403 like tasks) per the loops
  fail-closed rule. `requires_confirmation` uses 422 with
  `{ code, firesPerDay }`; 409 is reserved for "not a draft" races.
- 2026-08-24 — L2.3 card redesign (user feedback on the first cut): the
  chat card is now a compact pill (icon + name + plain-english schedule +
  status chip / Create Loop) — no timezone, no instructions preview.
  Clicking it opens a NEW right-sidebar view `{ type: "loop" }`
  (`loop-panel.tsx`, wide size class like threads) with the full prompt,
  schedule rows (Repeat / Timezone / End repeat / Next run / Last run),
  and draft activation; the timezone select lives only there — the card's
  quick Create Loop activates in the viewer's device tz. Activation
  mutation + high-frequency dialog shared via
  `components/loops/activate-loop.tsx`. `describeLoopSchedule` gained
  hourly shapes ("0 * * * *" → "Every hour", "15 */6 * * *" → "Every 6
  hours at :15", dow qualifiers) and the fallback is now labeled
  (`Custom schedule "…"`) — raw cron never renders bare. propose_loop's
  endCondition description now forbids "until manually stopped" as an end
  condition (null is the right encoding; the first live test tripped it).
  Panel editing (name/instructions/schedule) remains L3.
- 2026-08-25 — Structured loop END MODES (user decision; supersedes
  "endCondition text is the only end"). One mode per loop, mutually
  exclusive, both-null = runs forever ("Never"):
  (1) MODEL-JUDGED — `endCondition` text, as before, but `complete_loop`
  now binds ONLY when a condition is set (no condition = no stop button;
  a live loop had been wrongly completed over a prose "manual stop"
  pseudo-condition).
  (2) DATE — new `loop.endAt` timestamp (⚠ needs db:push), enforced
  MECHANICALLY by the sweep: a due fire scheduled past endAt completes the
  loop (`completedNote: "Reached its end date"`) instead of running — so
  completion lands at the first tick past the end, no model involved.
  Merlin proposes it as a RELATIVE `endAfter {amount, unit: days|weeks|
  months}` (respond() has no clock; the tool anchors it to now —
  `endAfterToDate`, tested). Activation/resume refuse a passed end date.
  (3) PROJECT-TIED — an INVARIANT, not a stored mode: archiving a project
  completes every active/paused loop in its channels
  (`completeLoopsForChannels` in api lib/loops.ts, called from the archive
  handler; drafts stay — inert, activation refuses archived channels).
  This also fixed a latent bug: the sweep would have kept firing loops
  into archived channels forever.
  Web: End repeat row is now a Select (Never / On a date / Condition — the
  last only offered while a Merlin-authored condition exists; switching
  away clears it) + native date-input row (end-of-day local semantics);
  PATCH accepts `endAt`/`endCondition` with set-one-clears-the-other.
- 2026-08-24 — L2.3 follow-up: the panel gained a structured schedule
  EDITOR for drafts (ChatGPT-style rows: Repeat hourly/daily/weekly/monthly,
  Day of the week incl. weekday/weekend presets, Day of the month, Time /
  At-minute). Round-trips cron via `parseLoopSchedule`/`formatLoopSchedule`
  (`@repo/realtime-types/loops`, tested); shapes it can't round-trip render
  read-only as custom. Persisted via new `PATCH /v1/loops/{loopId}`
  (draft-only — 409 otherwise; editing ACTIVE loops still L3 with
  pause/recompute/re-confirm semantics), optimistic cache write in
  `useUpdateLoopSchedule` (`components/loops/loop-actions.tsx`, renamed
  from activate-loop.tsx). Loop icon is now `Infinity01Icon` (card pill +
  active status chip) — more distinct than the repeat arrows.
