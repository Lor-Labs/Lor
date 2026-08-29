# Durable agent runs (Merlin harness)

As-built reference for the durable run system, shipped 2026-08-01/02. A Merlin response is a durable **run**: Postgres owns all state, BullMQ is scheduler only, recovery happens at step boundaries (never byte-level stream restore). Late joiners replay the persisted event log; crashes resume from the last checkpoint; budgets are hard ceilings the run can never exceed; mid-run messages steer, queue, or ride along as ambient context.

## Data model (`packages/db/src/schemas/agent-runs.ts`, `workspace-instructions.ts`)

### `agent_run`

One row per user-facing run — the durable spine.

- Identity: `workspaceId`, `channelId`, `threadRootId` (null for channel-placed replies), `messageId` (the pending placeholder the run streams into — **null for headless triggered runs**, the Act effect), `triggerMessageId`, and trigger provenance `triggerId`/`deliveryId` (null on conversational runs; see `automation-primitives.md` §2).
- Scope: `scopeKey = threadRootId ?? channelId` (headless triggered runs use their `deliveryId`), with a partial unique index over active states (`queued | working | finalizing`) → **one active run per conversation scope, enforced by Postgres**. Placement-ducked answers get their own thread scope, so only genuinely in-channel answers serialize.
- State machine: `state` (`queued | working | finalizing | complete | failed | stopped`), `phase` (`answer | writeback`), `stopReason` (completed, per-budget reasons, out_of_credits, error, stopped_by_user). Stop reason and terminal state commit in the same transaction that ends the run.
- Ownership: `leaseOwner`, `leaseExpiresAt`, `attempt`, `maxAttempts` (2 = one recovery). Claiming and every counter/state write is a lease-guarded CAS UPDATE — retries and concurrent workers can't double-spend or double-own.
- Counters (cumulative, never reset on retry): `steps` (doubles as the checkpoint pointer — transcript rows 1..steps are durable), `inputTokens`, `cachedInputTokens` (the cache-read subset of `inputTokens`), `outputTokens` (incl. reasoning), `toolCalls`, `toolOutputBytes`, `creditsSpent`, `startedAt`, `deadlineAt` (absolute wall-clock ceiling so recovery can't extend it).
- Budgets snapshotted at creation as columns — changing env defaults never changes an in-flight run.
- `nextSeq`: allocator for the event log. `context` + `instructions` columns hold the step-0 prepared context (conversation snapshot, brain prefetch, roster, LOR.md, task state, continuation delta) so recovery replays the exact same context with no re-prefetch or drift.
- `continuedFromRunId`: set when this run inherited an earlier run's transcript rather than building a fresh snapshot (see Context continuation). `on delete set null` — never cascade, or deleting an old run would delete the run that followed it.
- Stop: `stopRequestedAt` / `stopRequestedBy` (see Stop below).

### `agent_run_step`

Append-only transcript, one row per completed model/tool step. `(runId, step)` unique; `messages` jsonb holds **only that step's own new** `ModelMessage`s (not anything inherited) plus per-step usage. Transcript reconstruction = run `context` + concat of steps 1..steps. Steer injections are prepended to the next checkpoint's messages so a resumed flat concat reproduces runtime order exactly.

**Never pruned.** Unlike `agent_run_event` (7-day post-terminal sweep), step rows are the permanent record of what a run actually did, and context continuation replays them across runs. Adding a retention job here would break both run history and continuation. Because a row holds only its own run's messages, replaying a chain requires walking `continuedFromRunId` — continuing just the immediate predecessor silently drops everything before it.

### `agent_run_event`

Ordered event log for live UX + late-join replay. `(runId, seq)` unique, seq allocated from `agent_run.nextSeq` at emit time so live socket frames and persisted rows share numbering. Kinds: `text | reasoning | tool | memory | state | steer` (`queued`/`truncate` reserved, unused). Writes are batched (~1s / 50 events) with contiguous text/reasoning coalescing; a crash can lose the un-flushed tail — fine, anything past the last checkpoint is discarded on recovery anyway. Recovery resets clients with a `replace` text frame, and a lease takeover jumps `nextSeq` by 10,000 so a zombie's tail can't collide. Events for runs terminal > 7 days are pruned by a worker interval.

### `agent_run_tool_result`

Idempotency for side-effecting tools (fs writes, `propose_instructions`, `investigate_code`, Linear mutations). Key: `(runId, toolKey)`, `toolKey = hash(toolName + canonical input)` — a recovered step returns the stored result instead of re-executing. `investigate_code`'s billing key is a stable hash of (repo, question), aligned with this cache, so recovery never re-runs or re-bills the sandbox.

### `agent_run_queue`

Trigger-tier messages that arrived while a run was active: `scopeKey`, `runId`, `messageId` (unique), `senderId`, `state` (`queued | steered | consumed | rejected | cancelled`), `consumedAtStep`. The message row is the content; this table is ordering + lifecycle + audit. Realtime writes these rows; **only the worker writes `agent_run_event`** (single seq writer).

### `message.clientKey`

The client send nonce persists with a partial unique index on (author, channel, clientKey); a resend returns the original row and skips fanout/broadcast/triggers entirely. Web sends `crypto.randomUUID()`, mobile a `mobile-…` nonce.

### `workspace_instructions` (LOR.md)

Immutable version rows: `version` (monotonic per workspace), `content`, `state` (`active | pending | rejected | superseded`), `authorType`, `baseVersion`, `rationale`, approver/rejecter, timestamps. Exactly one `active` per workspace (partial unique index); at most one `pending` (a newer proposal supersedes the previous in the same transaction).

## Run lifecycle (worker: `apps/worker/src/lib/agent-run.ts`, `jobs/merlin-respond.ts`)

```text
queued ──claim──▶ working ──answer done──▶ finalizing ──persisted──▶ complete
   │                 │  ▲                      │
   │                 │  └─recovery (attempt≤2) │
   └──────────▶ failed / stopped ◀─────────────┘
```

- **Claim:** CAS `queued→working` or expired-lease takeover (`attempt++`, capped); heartbeat every ~20s (TTL 60s).
- **Checkpoint:** one lease-guarded transaction per completed step — insert step row, add usage, check ceilings, advance `steps`. Runs *inside* the async `stopWhen` so the loop can't continue past an uncommitted step; a post-loop sweep covers the final text-only step. `prepareStep` is the graceful enforcer (forces `toolChoice: "none"` when the next step would hit a ceiling); `stopWhen` is the hard backstop.
- **Recovery:** BullMQ `attempts: 2`, `jobId = runId`. The retry claims only on expired lease, rebuilds messages from durable steps, replace-frames clients, and resumes. The incomplete step's model request is re-issued; completed side-effects are absorbed by `agent_run_tool_result`. Ledger billing stays per attempt — a crashed attempt's tokens count toward ceilings but are never re-billed.
- **Finalizing:** grounding, message persistence, fanout as before. Write-back runs only if remaining budget clears a floor (≥15% tokens + ≥50 credits + ≥60s of wall clock); otherwise skipped and recorded, never failing the answer.
- **Dead-run sweep** (10-min interval): force-fails dead runs — claimed runs 10 min past `deadlineAt`, never-claimed queued runs 30 min past `createdAt` (the longer grace so a worker-outage backlog isn't failed just before its jobs run) — settling each stuck placeholder in the same per-run transaction, then drains their scope queues. Covers the double-crash case.
- Railway drain seconds is manual mitigation so deploys usually finish the in-flight step; correctness never depends on graceful shutdown.

## Execution engine (`packages/merlin/src/run.ts`, `index.ts`)

`respond()` takes a `RunHandle` (persisted state in; checkpoint/event/drain/stop callbacks out), verified against `ai@7.0.11`:

- `stopWhen`: one async predicate over cumulative counters (steps, tokens, tool calls, `deadlineAt`, spend, stop flag) that also performs the checkpoint.
- `prepareStep`: compaction (summarizing `compact()` in `compaction.ts` shapes what's *sent*, never what's *stored*; fires above `MERLIN_COMPACT_INPUT_TOKENS`, persists notes + baseline via `saveCompaction`, surfaces in the trail as a `compact_context` entry → web divider), forced final text step near ceilings, and conversation drain (steering; see below).
- Tool wrapper (`tool-guard.ts`): 256 KB/call (env) + 2 MB cumulative output caps, byte counting, side-effect idempotency.
- Spend: `recordUsage` stays the async ledger; the checkpoint also folds `computeCredits` into `creditsSpent` synchronously. Nested usage (`investigate_code`, future child agents) accumulates into the parent run's counters.
- Provider retries: `maxRetries: 3`. Context-per-request stays governed by `MERLIN_COMPACT_INPUT_TOKENS`.

## Context continuation (`apps/worker/src/lib/run-continuation.ts`)

A follow-up run in a thread or task scope **inherits its predecessor's transcript** — its tool calls, results, and reasoning — instead of rebuilding context from chat text alone. Without this, every follow-up rediscovered what the last run already knew (the failure that motivated it: a budget-tripped run, then "go ahead", then 10 steps re-deriving a project id and schema it had found minutes earlier). See `reference/context-continuation.md` for the full runbook.

Two regimes, never mixed:

- **Fresh** — a scope's first run, or any fallback. `loadConversation` builds a snapshot: whole thread (+10 channel messages before the root) for thread scope, newest 30 for channel scope.
- **Continuation** — every later run in the same scope. Messages = the chain's replay + one delta message. No snapshot is built or injected alongside it.

Mechanics:

- **Predecessor**: newest finished run in the same `scopeKey` + channel with `steps > 0` and a stored `context`. `complete`, `stopped`, and `failed` all qualify — a budget-tripped run is exactly the one worth continuing. **No age cutoff**: a thread is one conversation however long the gap; a gap over 30 min is instead reported in the delta ("about 3 days since then, so re-check anything that may have changed").
- **Chain replay** (`replayChain`): walks `continuedFromRunId` back to the chain root (cap 20 hops), then emits root snapshot → root steps → each later hop's stored delta → that hop's steps. Necessary because a step row holds only its own run's messages. **When any run in the chain persisted a compaction** (`agent_run.compaction`: notes + post-compaction baseline + `atStep`), replay starts at the newest baseline instead — baseline + that run's steps `> atStep` + later hops — which keeps replay bounded to one context however long the thread lives, keeps the prefix byte-identical (prompt cache), and hands the notes to the successor's compactor so facts merge forward.
- **Delta**: scope messages created after the predecessor started, excluding Merlin's own (already assistant turns), the placeholder, still-`queued` rows, and rows the predecessor actually injected — the last identified by **`consumedAtStep IS NOT NULL`**. `drainScopeQueue` marks the winning queued row `consumed` against the *predecessor's* run id with `consumedAtStep` left null, so excluding all consumed rows would drop the very message that triggered the continued run.
- **`context.continuationDelta`** stores the rendered delta verbatim; it embeds elapsed time, so re-rendering on recovery would change the string and break byte-stable replay (and the prompt cache). Recovery uses `replayContinuedPrefix`, not `buildInitialUserMessage`.
- **Instructions are rebuilt fresh**, not inherited: rules reflect the current world even though history does not. They rarely change, so the cached prefix normally survives anyway.
- Empty delta → fall back to fresh (nothing new to ask). Any error → fall back to fresh, logged.
- Compaction is seeded with `max(estimate(replayed messages), last-step input)` — on both the continuation and crash-recovery paths — so a heavy inherited transcript compacts on the first step rather than after it. The last step alone is never trusted: after a compaction it is small precisely because the bulk was projected away.

## Budgets

Env-defaulted (`AGENT_RUN_*` in `packages/env` — mirror new required fields into `TEST_ENV` in `apps/api/vitest.config.ts`), snapshotted per run. Emergency ceilings, not stopping targets:

| Budget | Default |
|---|---|
| Model/tool steps | 500 |
| Cumulative input tokens | 10,000,000 (cache reads weighted ×0.1) |
| Cumulative output+reasoning tokens | 1,000,000 |
| Tool calls | 1,000 |
| Tool output | 256 KB/call (env), 16 MB cumulative |
| Wall clock | 2 h |
| Provider retries | 3 per request |
| Recovery attempts | 1 |
| Spend | min(2,000 credits, workspace remaining balance) |

The input rail counts `inputTokens - 0.9 × cachedInputTokens`. Every step re-sends the whole context, so at a high cache-hit rate the raw total climbs ~10× faster than real cost: pre-weighting, runs tripped `budget_input_tokens` at ~25% of their credit ceiling with every other rail under half used.

## Realtime + replay

- Socket frames (`message:stream`, `merlin:tool`, `merlin:reasoning`, `merlin:memory`, `merlin:steer`) carry `{ runId, seq }`.
- Replay API: `GET /v1/runs/by-message/:messageId/events?after=<seq>` (workspace membership through the run's channel, tenant-checked).
- Client protocol (web `apps/web/src/hooks/use-merlin-stream.ts`, mobile `apps/mobile/src/lib/run-replay.ts`): any pending Merlin placeholder in view starts a replay — buffer live frames, fetch the log, rebuild streamed fields (authoritative up to max seq), then drain the buffer gated by seq. Terminal runs refetch the message row instead. Legacy runs (404/no seq) fall back to live-frames-only.
- The pending placeholder and the instant reply-count signal are untouched — run-state UI layers onto the placeholder, never replaces it.

## Multiplayer steering (two-tier contract)

Any message that would **trigger** Merlin (mention, open session, Merlin-thread reply) is absorbed by the scope's active run, with delivery guarantees. Messages that would *not* trigger (someone addressing a teammate mid-run) are the **ambient tier**: `prepareStep` re-reads the scope at each boundary and injects them as context only ("act on these only if addressed to you") — no guarantee, never spawns or queues a run. Both arrive in one injected user message per boundary.

How a trigger is absorbed depends on the scope:

- **Channel scope**: active `queued`/`working` run → `steered` row (injected at the next step boundary); `finalizing` → `queued`.
- **Thread scope**: always `queued` (Codex model). The thread composer shows the queue as a pill with per-message actions: **Steer** (`POST /v1/runs/queued-messages/:messageId/steer`, any member) stamps the row's `promotedAt` (front of the drain order) and stops the active run immediately, so this message is answered next, ahead of the rest of the queue; **remove** (`DELETE /v1/runs/queued-messages/:messageId`, sender only) marks the row `cancelled`. Pill state: adds via `message:routed` (outcome `queued`, room-broadcast), removals via `run:queue:updated` (consumed/rejected/cancelled), late-join snapshot via the events endpoint's `queue` field.

Mechanics:

- **Routing** (`apps/realtime/src/services/merlin.ts`, `routeToActiveRun`): post-insert re-read downgrades steer→queue (run hit finalizing) or undoes the row entirely (run terminal → fresh run — closes the stranded-row window for both outcomes). Placeholder creation stays first (the run row references it); a lost race deletes the never-emitted placeholder and late-routes.
- **No drops, no double-injection**: a fresh claim's snapshot sweep (`markConversationLoaded`) consumes steer rows the conversation snapshot already covers; recovered attempts skip the sweep and drain everything pending; the completion/dead-run drain re-queues leftovers.
- **Completion drain** (`apps/worker/src/lib/run-queue.ts`, `drainScopeQueue`): sweeps scope-wide leftover `steered` rows of terminal runs to `queued`, then pops exactly ONE row per drain — order is `promotedAt ASC NULLS LAST, createdAt ASC` (steered messages jump the line) — **reauthorizes that sender at dequeue** (workspace membership + message-in-run-channel tenant binding; unauthorized rows ahead of the winner → `rejected`, rows behind stay queued), and starts one follow-up run answering just that message. Each completion drains the next, so every queued message gets its own run and its own answer — never collapsed into a batch. Still-`queued` messages are excluded from `loadConversation` (and the ambient boundary re-read), so Merlin can't see or answer them early — the server mirror of clients hiding them from the transcript. Author attribution is audit data, not authorization. Emits `run:queue:updated` per consumed/rejected row. A lost scope race leaves rows queued (nothing consumed — the occupying run can't see them either).
- **UX**: a queued message lives ONLY in the composer queue pill — clients hide it from the transcript entirely (render filter on queuedIds) until the drain settles the row, when it materializes in its createdAt slot (full Codex model; everyone sees the pill, so nothing is hidden from the team). Pill mounted on thread AND channel composers (channel covers the finalizing-queue window), rows show the sender's name for other members' messages. Trash = withdraw AND delete: queue-cancel endpoint first (needs the message row), then the normal socket `message:delete` — a queued message reads as never-sent, so cancelling must not pop it into the transcript. Sends into a working thread run land in the pill optimistically: the row is added with the send nonce at send time and the `message:created` echo swaps in the real id (`message:routed` then dedups; mobile holds steer/remove while the row still has a nonce id). The `steered` outcome keeps its transcript chip ("Steering Merlin's current answer"), cleared when the steer lands (`merlin:steer` → `steeredMessageId`) or the row settles (`run:queue:updated`); `merlin:steer` shows "Applying {name}'s new direction…" on the placeholder (replayable from the event log). The pill renders tucked into the composer's top edge (web: flush-attached rounded-t card above MessageInput; mobile: `topAccessory` slot on MessageComposer sliding under the opaque input card). Cancel-and-restart is never an implicit fallback — thread "Steer" is the explicit stop+reprompt affordance.

## Stop

`POST /v1/runs/by-message/:messageId/stop` (any member with channel access), shared core `requestRunStop` in `apps/api/src/routes/v1/runs/handlers.ts`:

- Never-claimed `queued` run → settled directly by the API (placeholder → "⏹️ Stopped.").
- `working` run → the `stopRequestedAt/By` flag is written durably, then the API publishes the runId on the `agent-run:stop` Redis pub/sub channel. The lease-holding worker (subscriber in `apps/worker/src/index.ts` → `signalRunStop` → per-claim `requestStop`) **aborts the in-flight model request immediately** via a stop-specific `AbortController` (combined with the lease-loss controller through `AbortSignal.any` into `streamText`'s `abortSignal`). The stream ends with an `abort` part; `respond()` keeps the partial text, checkpoints completed steps, and returns `stoppedFor: "stopped_by_user"`; the worker persists the partial answer as a normal message, settles the run `stopped`, and skips write-back. The flag riding the heartbeat + checkpoint RETURNING stays as the durable fallback (also aborts on discovery). A step blocked inside a long tool execution still runs to its boundary (tools don't observe the signal; accepted).
- `finalizing` accepts the flag but effectively no-ops. Terminal → 409.
- Lease-loss aborts stay distinguishable: `execution.aborted()` reflects only the lease controller, so a superseded attempt still exits silently while a user stop settles gracefully.
- Clients show a Stop button on in-flight placeholders with optimistic "Stopping…" (web `message-item.tsx` `MerlinRunControls`, mobile `message-row.tsx`).

## LOR.md (workspace instructions)

Durable operating instructions, distinct from workspace memory (knowledge). Repository files named `LOR.md`/`AGENTS.md`/`CLAUDE.md` are never workspace instructions.

- Owner/admins (new `instructions: ["update", "approve"]` workspace statement) edit directly — active immediately, still audited. Agent proposals (`propose_instructions`, a side-effect tool so recovery can't file duplicates) stay `pending` until a human approves that exact version; the agent can never activate its own proposal. Pending proposals are visible to all members read-only.
- Validation on write **and** injection, fail closed (`validateWorkspaceInstructionsContent` in `packages/db`): ~2,000-token cap (chars/4) + secret heuristics (PEM, AWS keys, `sk-`/GitHub/Slack tokens, JWTs, bearer strings). Clients mirror the cap constant.
- Activation races can't merge silently: version-guarded supersede + partial unique active index → 409s; stale proposals block approval in the UI.
- Injection appends a "## Workspace instructions" block to `respond()` + `writeBack()` system prompts (after connector lines, before conversation). Not injected into the salience gate, ingestion, or the Pi sandbox brief. The run's `instructions` snapshot carries it through recovery unchanged.
- Proposal push (`sendInstructionsProposalPush`): presence-independent, owner+admins, data-only deep link to the approval screen (web `instructions-section.tsx` + sidebar alert; mobile `/settings/instructions`, diff via jsdiff) — never approve from the push itself.

## Tasks (layer on runs, shipped 2026-08-08)

**Tasks** (the multiplayer delegated-work feature) layer a `task` entity over run chains without touching the run engine. Artifacts + workbench are documented in [`artifacts.md`](./artifacts.md).

- **Task = thread.** `task` row (`packages/db/src/schemas/tasks.ts`) anchors to a `task_card` message that is also the thread root, so every task run executes in that thread scope — steering, always-queue, stop, replay, and recovery apply unchanged, and a long task never blocks channel Q&A. Tasks are created at routing time: the placement router (`packages/merlin/src/placement.ts`) returns a third judgment `task` (clear delegation with a deliverable) and `createTaskWithCard` (apps/realtime `services/merlin.ts`) inserts card + task before the normal placeholder/run/enqueue flow. Task threads auto-trigger on plain replies via the existing `isMerlinThread` rule (the pending placeholder makes the thread Merlin's immediately).
- **States live BETWEEN runs, never on them.** `running | waiting_for_input | waiting_for_approval | completed | failed | stopped`. The worker sets `running` on claim and settles on run end (`settleTask` in `jobs/merlin-respond.ts`): failed/stopped mirror the run; a clean end without `complete_task` parks the task `waiting_for_input` (ball in the team's court). Tool-set states (`completed`, `waiting_for_approval`) are never clobbered.
- **Task tools** (`packages/merlin/src/tasks.ts`, bound only when the run has task context): `set_plan` (full-replace checklist the team watches live), `complete_task` (only path to `completed`), `request_approval` (files an `approval` row — `schemas/approvals.ts`, workflow-agnostic, one pending per task — then trips a flag that makes `prepareStep` force a final text step, same mechanism as budget ceilings; the run ends cleanly, no lease is ever held waiting on a human).
- **Approval resolution = end-and-resume, no waitpoints.** `POST /v1/approvals/:id/approve|reject` (apps/api `routes/v1/tasks/`): CAS-resolves the row, posts the resolution into the task thread AS the resolver, and starts the continuation run via `startTaskContinuationRun` (`apps/api/src/lib/task-runs.ts`) — a copy of the drain's recipe: busy scope → ride the run queue; free scope → placeholder + run + enqueue with the same unique-index race fallbacks. This made the API a BullMQ **producer** (producer only). Run-creation recipe now exists in three places (realtime, worker drain, API) — extract to a shared package if touched again.
- **Task context:** the worker detects task runs by `cardMessageId = threadRootId`, threads `RunTaskContext` into `respond()` (task tools + workbench continuity: per-task sandbox checkpoint and Pi session resume — see artifacts.md), and broadcasts every task change as `task:updated` to the **channel room** (fine-grained run events stay thread-room-only). The prompt is split: static rules (`taskRulesSection`) sit in the instructions, while the volatile title/goal/status/plan (`taskStateSection`) render at the tail of the initial user message via `context.task`. Keeping live task state out of the system prompt is what lets a task's run chain share one cached prefix — otherwise every `set_plan` invalidated the entire prompt.

## Open items

- **Channel-scope serialization** is live and deliberately strict; one line to relax if it chafes.
- Live verification still owed: steer/queue/ambient/stop flows and a kill-mid-run crash-recovery exercise.
- **Context continuation live tests owed** (built 2026-08-28, unproven in the app): budget-trip → "continue" resumes mid-work rather than restarting; a queued follow-up actually takes the continuation path; steer-then-continue doesn't duplicate messages; a crashed continued run recovers with its inherited chain intact.
- ~~Compaction is still a blunt prune~~ **Done (C1 + C2 in `context-continuation.md`)**: summarizing `compact()` at 700k trigger (fallback model Kimi K3's window binds, not GLM's), notes + baseline persisted in `agent_run.compaction`, replay-from-baseline on recovery and continuation, `compact_context` divider in the trail. `pruneMessages` remains only as the fallback when the summarizer fails repeatedly. Compaction live test owed alongside the continuation ones.
- Trigger.dev remains deferred: Postgres-owned state + BullMQ-as-scheduler covers durability; revisit only for hours-long waitpoints/fan-out.
- Next milestone after this harness: the read-only [`Slack connector`](./slack-connector-next.md).
