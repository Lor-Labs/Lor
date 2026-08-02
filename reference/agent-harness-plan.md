# Durable agent runs: architecture plan

Plan for the priorities in [`agent-harness-next.md`](./agent-harness-next.md), per the 2026-08-01 decisions: durable recovery at step boundaries, BullMQ stays the scheduler, Postgres is the source of truth, Trigger.dev deferred. One architecture, shipped in four contained slices.

## Current state (what this replaces)

A "run" today is implicit: a BullMQ job (`apps/worker/src/jobs/merlin-respond.ts`) plus a `message` row with `status: "pending"`. Consequences the plan fixes:

- Nothing survives a worker death. The queue has no `attempts` configured (BullMQ default 1), so a crashed job leaves a stuck pending placeholder forever; if we naively added retries, a retry would restart from zero and re-bill the whole context.
- Late joiners see only a thinking indicator: tool calls / reasoning / deltas are socket-only until the final message row is persisted at completion.
- Budgets (`MAX_STEPS 30`, `RESPOND_TOKEN_BUDGET` 300k, 10-min wall clock) live only in process memory, per `streamText` call.
- A follow-up message mid-run spawns a second concurrent run in the same thread (worker concurrency 5, no serialization).

## 1. Data model (`packages/db`)

### `agent_run`

The durable spine. One row per user-facing run.

- Identity: `id`, `workspaceId`, `channelId`, `threadRootId` (null for channel-placed replies), `messageId` (the pending placeholder the run streams into), `triggerMessageId`.
- Scope: `scopeKey = threadRootId ?? channelId` (its own column). Partial unique index on `scopeKey` where `state` is active → **one active run per conversation scope, enforced by Postgres**, not application logic.
- State machine: `state` pgEnum `queued | working | finalizing | complete | failed | stopped`; `phase` pgEnum `answer | writeback`; `stopReason` pgEnum (`completed`, `budget_steps`, `budget_input_tokens`, `budget_output_tokens`, `budget_tool_calls`, `budget_tool_output`, `budget_wall_clock`, `budget_spend`, `out_of_credits`, `error`, `stopped_by_user`). Stop reason and terminal state are written in the same transaction that ends the run, before any continuation is offered.
- Ownership: `leaseOwner` (worker instance id), `leaseExpiresAt`, `attempt`, `maxAttempts` (2 = one recovery). Claiming and every counter/state write is a guarded UPDATE (`WHERE id = ? AND leaseOwner = ? AND state = ?`) — the CAS that makes retries and concurrent workers unable to double-spend or double-own.
- Counters (cumulative, never reset on retry): `steps`, `inputTokens`, `outputTokens` (includes reasoning), `toolCalls`, `toolOutputBytes`, `creditsSpent`, `startedAt`, `deadlineAt` (wall-clock ceiling as an absolute timestamp so recovery can't extend it).
- Budgets snapshotted at creation as columns (`budgetSteps`, `budgetInputTokens`, `budgetOutputTokens`, `budgetToolCalls`, `budgetToolOutputBytes`, `budgetWallMs`, `budgetCredits`): the run carries its own ceilings; changing env defaults never changes an in-flight run.
- `nextSeq`: allocator for the event log's per-run sequence numbers.
- `checkpointStep`: last completed step number.

### `agent_run_step`

Append-only transcript, one row per completed model/tool step. `(runId, step)` unique; `messages` jsonb holding that step's new `ModelMessage`s (typed via the AI SDK type, not a loose bag); per-step usage columns. Step 0 is the fully prepared initial context (conversation snapshot, brain prefetch, roster) — persisted so recovery replays the *exact* same context with no re-prefetch, no drift, no double embed billing. Transcript reconstruction = concat steps 0..checkpointStep.

### `agent_run_event`

Ordered run-event log for live UX + replay. `(runId, seq)` unique, `seq` allocated from `agent_run.nextSeq`. `kind` enum: `text | reasoning | tool | memory | state | steer | queued | truncate`; typed payload per kind (reusing the existing `MerlinToolCall` / reasoning-segment shapes). Notes:

- **Batched writes.** Socket emits keep the current ~24-char cadence; event rows are flushed coarser (~1s or at step boundaries). Seq is allocated at emit time, so live socket frames and persisted rows share numbering. A crash can lose the un-flushed tail — acceptable by design, because anything after the last checkpoint is discarded on recovery anyway.
- **`truncate` events** carry the authoritative content length at a checkpoint; on recovery the client trims any partial streamed text from the dead attempt back to it.
- **Retention:** events are redundant once the run is terminal and the message row holds the final content/tool trail (existing persistence keeps working). Cleanup job deletes events for runs finished > 7 days.

### `agent_run_tool_result`

Idempotency for side-effecting tools (`write`, `mkdir`, `move`, `link`, `create_linear_issue`, `update_linear_issue`, `comment_linear`). Key: `(runId, toolKey)` where `toolKey = hash(toolName + canonical input)` — toolCallIds regenerate when a step is retried, input identity doesn't. Before executing, the wrapper checks for a stored result and returns it instead of re-executing. Read-only tools skip this. Billing already has its own idempotency (`usage_event.idempotencyKey`); this is for the *action*, that is for the *debit*.

### `agent_run_queue`

Pending follow-up messages for a scope: `id`, `scopeKey`, `runId` (the run that was active when queued), `messageId`, `senderId`, `seq`, `state` (`queued | steered | consumed | rejected`). The message row itself is the content; this table is ordering + lifecycle. Mirrored into `agent_run_event` (`steer`/`queued` kinds) for the audit trail.

## 2. Run lifecycle

```
queued ──claim──▶ working ──answer done──▶ finalizing ──persisted──▶ complete
   │                 │  ▲                      │
   │                 │  └─recovery (attempt≤2) │
   └──────────▶ failed / stopped ◀─────────────┘
```

- **Claim:** worker CAS-claims (`state queued→working` or expired-lease takeover, `attempt++` guarded `attempt ≤ maxAttempts`), heartbeats the lease every ~20s (TTL 60s).
- **Checkpoint (per completed step):** one transaction, guarded by lease — insert `agent_run_step`, add usage to counters, check ceilings, bump `checkpointStep`. This is the atomic reserve/update/transition the spec requires.
- **Recovery:** BullMQ `attempts: 2` on the job (jobId = runId for dedupe). The retry worker claims only if the lease is expired, rebuilds messages from steps ≤ `checkpointStep`, emits a `truncate` + `state: recovered` event, and resumes `streamText` from there. The incomplete step's model request is simply re-issued; its completed side-effects are absorbed by `agent_run_tool_result`. If `attempt > maxAttempts` or any hard budget is exhausted, the run terminates with the exact stop reason — the same run can never continue past a hard ceiling.
- **Finalizing:** grounding, message-row persistence, fanout — as today. `phase → writeback` only if remaining budget clears a floor (e.g. ≥15% of token budget and ≥50 credits); otherwise write-back is skipped (recorded on the run), never failing an already-generated answer.
- Railway drain config (`RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) as mitigation so most deploys finish the in-flight step, but correctness never depends on graceful shutdown.

## 3. Execution engine (`packages/merlin` + worker)

`respond()` grows a run handle (persisted state in, checkpoint/event callbacks out). Verified against `ai@7.0.11` — all three hooks exist with the shapes we need:

- `onStepEnd` → checkpoint transaction (step messages + usage are on the `StepResult`).
- `stopWhen` accepts custom async predicates over `steps` → one budget condition evaluating the run's cumulative counters (steps, tokens, tool calls, wall clock via `deadlineAt`, spend).
- `prepareStep` can return a `messages` override that carries forward → used for (a) existing compaction (`pruneMessages` shapes what's *sent*, never what's *stored* — the durable transcript stays raw), (b) forcing `toolChoice: "none"` when a ceiling means this must be the final step, (c) steering injection (slice 4).
- Per-request context cap: derived from the model's context window minus a reserved output margin (replaces the fixed-only `COMPACT_INPUT_TOKENS`; env stays as an override). Provider retries: `maxRetries: 3` explicit.
- Tool wrapper (composes over the existing tool sets): enforces 256 KB per-call output (truncate + mark) and 2 MB cumulative, records tool bytes into counters, and applies `agent_run_tool_result` idempotency for side-effecting tools.
- **Spend:** `recordUsage` stays the fire-and-forget ledger, but the checkpoint transaction *also* folds the same `computeCredits` math into `creditsSpent` so the ceiling is enforced synchronously. All nested usage counts toward the parent run: `investigate_code`'s `onUsage` (and future child agents) accumulate into the next checkpoint — this also finally closes the red-flagged sandbox cost guard.

## 4. Realtime + replay

- Existing socket events (`message:stream`, `merlin:tool`, `merlin:reasoning`, `merlin:memory`) gain `{ runId, seq }`; no renames, so web/mobile migrate incrementally.
- New replay endpoint: `GET /v1/runs/:runId/events?after=<seq>` (auth = workspace membership through the run's channel, tenant-checked). Client protocol: join the room, buffer live frames, fetch replay after the last persisted seq it has, apply, then drain the buffer by seq. Late joiners and reconnects get the complete trace.
- The pending placeholder and instant reply-count signal are untouched — run-state UI layers *onto* the placeholder, never replaces it.
- Mobile needs the same seq/replay handling; add to `reference/mobile-parity-todo.md` when slice 1 lands.

## 5. Budget defaults

Env-configurable (`packages/env` serverSchema — remember the `TEST_ENV` mirror in `apps/api/vitest.config.ts`), snapshotted per run:

| Budget | Default |
|---|---|
| Model/tool steps | 100 |
| Cumulative input tokens | 1,000,000 |
| Cumulative output+reasoning tokens | 150,000 |
| Context per request | model limit − reserved output margin |
| Tool calls | 200 |
| Tool output | 256 KB/call, 2 MB cumulative |
| Wall clock | 30 min |
| Provider retries | 3 per request |
| Recovery attempts | 1 |
| Spend | min(500 credits, workspace remaining balance) |

Emergency ceilings, not stopping targets: the loop prefers compaction and continuation; ceilings only bound runaways.

## 6. Trigger path + steering (`apps/realtime`)

Message-send flow when Merlin should respond, replacing "always spawn a new placeholder + job":

1. Atomically try to insert an `agent_run` for the scope (the partial unique index arbitrates). Success → create placeholder, enqueue job (jobId = runId).
2. Conflict (active run exists) → **steer**: CAS-append a `steer` event + queue row with `state: steered`, guarded on the run still being `working`. `prepareStep` drains steered messages at the next step boundary, injecting them as attributed user messages ("Jacob (steering): …") and emitting an `applying new direction` state event.
3. CAS failed (run moved to `finalizing`/terminal between read and write) → **queue**: the row lands `queued`. Never silently dropped — ambiguous or late steering always degrades to queued work.
4. On run completion, the worker drains the queue for its scope: **reauthorize each sender** (workspace membership, channel access, same-tenant run/thread — the same checks as send-time; reject/quarantine rows whose sender lost access), then start the next run seeded with the queued messages in seq order.

Authorization at accept-time rides the existing `assertUserCanAccessChannel` path plus a tenant check binding sender → channel → run workspace inside the CAS transition. Author attribution is audit data only. Message idempotency: the client `nonce` (currently echoed, not enforced) becomes a persisted `clientKey` on `message` with a per-author-per-channel unique index — resends return the original row.

Composer/thread UI: run-state chip on the placeholder (working / steering available / message queued / applying new direction / stopped / complete) and an explicit **Stop** action (`stopped_by_user`); restart stays a separate explicit action, never an implicit steering fallback. Steering is the default for a mid-run send; the UI shows *what happened* (steered vs queued) rather than asking upfront, keeping the thread an ordinary chat.

Subagents later (draft-PR loop, etc.) are child executions owned and budgeted by the parent run — they get their own step/event rows under the parent's counters, never sibling top-level runs.

## 7. `LOR.md` lifecycle

### Storage: `workspace_instructions`

Immutable version rows: `id`, `workspaceId`, `version` (unique per workspace, monotonic), `content` (cap ~8 KB), `state` (`active | pending | rejected | superseded`), `authorType` (`user | agent`), `authorUserId` (`MERLIN_USER_ID` for agent proposals), `baseVersion`, `rationale`, `approvedByUserId` / `rejectedByUserId`, timestamps. Exactly one `active` per workspace (partial unique index). Activation is one transaction: current active → `superseded`, target → `active`, guarded on `baseVersion` matching the current active version (concurrent approvals fail cleanly as conflicts, never merge silently).

### Rules

- Owner/admins (`workspace.ownerId` + `workspaceMember.role = 'admin'`) can edit directly — active immediately, still an audited version row — and are the only approvers. Agent-authored versions are always `pending` until a human approves that exact version; the agent can never activate its own proposal. Members read-only for MVP (proposals later).
- Validation on **write and on injection**, fail closed: size cap, secret/credential heuristics (PEM blocks, AWS/API key shapes, bearer tokens), version integrity. Injection additionally verifies run-workspace ↔ instructions-workspace tenant match and skips injection (with a log) on anything ambiguous.
- **Injection point:** `respond()` and `writeBack()` instruction assembly in `packages/merlin/src/index.ts`, in a fixed priority order — system policy → connector/product lines → *approved workspace instructions* → conversation. Explicitly **not** injected into the salience gate, source ingestion/summarization, or the Pi sandbox brief (Pi already runs `--no-context-files`; repo `CLAUDE.md`/`AGENTS.md`/`LOR.md` files are never workspace instructions — extending injection to Pi is a later explicit decision).
- **Agent proposals:** a `propose_instructions` tool in answer/write-back phases creates a pending version and pushes to eligible owner/admins via the existing push pipeline (`packages/messaging/src/push.ts`), deep-linking (`lor://` + web route) to an approval screen. The push never carries an approve action. The screen shows the full diff against the base version, proposer, rationale, and validation status; approve/reject write immutable metadata.
- API under `/v1/workspaces/:id/instructions` (get active, list versions, direct edit, propose, approve, reject). Web settings page + mobile approval screen.

## 8. Slices

1. **Durable run foundation.** `agent_run` + `agent_run_event`, run creation in the trigger path, worker writes events + state transitions, seq on socket frames, replay API, client replay-on-open. No checkpointing yet (transcript = step 0 + final). *Ships the late-join fix on its own.*
2. **Checkpointed execution + budgets.** `agent_run_step`, checkpoint transactions, budget columns/counters/stop reasons, lease + heartbeat + BullMQ `attempts: 2` recovery, tool output caps + `agent_run_tool_result`, spend ceiling incl. `investigate_code`, write-back skip floor, Railway drain config. *Ships crash/deploy recovery.*
3. **`LOR.md`.** `workspace_instructions`, API, validation, injection, `propose_instructions` tool, push + approval screens (web/mobile), settings UI.
4. **Multiplayer steering.** Scope serialization switch-over, steer/queue CAS paths, dequeue reauthorization, `clientKey` idempotency, run-state chip + Stop action, composer affordances.

Each slice is independently shippable; 1–2 touch `packages/db` + `packages/merlin` + worker/realtime, 3 is mostly independent of 2, 4 depends on 1 (events/seq) and benefits from 2 (safe step boundaries for steering).

## 9. Implementation notes (as-built deltas)

Slices 1–3 are built (2026-08-01). Where the code deviates from the sections above:

- **No separate `checkpointStep`** — `agent_run.steps` doubles as the checkpoint pointer (transcript rows 1..steps are durable). Step-0 context lives on the run row (`context` + `instructions` columns); `agent_run_step` holds model steps only.
- **Recovery resets clients with a `replace` text frame** (existing client path) instead of a `truncate` event; the enum value is kept unused. The claim also jumps `nextSeq` by 10,000 on takeover so a zombie's un-flushed live tail can never collide with recovered frames.
- **`investigate_code` billing key** is now a stable hash of (repo, question) instead of a per-response counter — retry- and recovery-safe, and aligned with the `agent_run_tool_result` cache key so a recovered step returns cached findings without re-running or re-billing the sandbox.
- **Checkpoint ordering**: `stopWhen` (async) performs the checkpoint for the just-finished step before the loop may continue; a post-loop sweep covers the final text-only step. `prepareStep` is the graceful enforcer (forces `toolChoice: "none"` when the next step would hit any ceiling); `stopWhen` is the hard backstop.
- **Ledger billing stays per attempt**: a crashed attempt's tokens count toward the run's ceilings (counters) but are deliberately never re-billed — customer-favorable.
- **Per-call tool output cap** (256 KB) is env-only, not a per-run column; the cumulative 2 MB cap is snapshotted.
- **Dead-run sweep**: a 10-minute maintenance job force-fails non-terminal runs well past their deadline and settles their stuck pending placeholders — covers the double-crash case beyond the single recovery attempt.
- **Context-per-request** stays governed by `MERLIN_COMPACT_INPUT_TOKENS` (gateway models don't expose window metadata); `MERLIN_RESPOND_TOKEN_BUDGET` is removed, superseded by the run budgets.

Slice 3 (`LOR.md`), as built:

- **Validation lives in `packages/db`** (`validateWorkspaceInstructionsContent` next to the table): ~2,000-token cap (chars/4 estimate — prompt-budget framing, no tokenizer dep) + secret heuristics (PEM, AWS keys, `sk-`/GitHub/Slack tokens, JWTs, bearer strings). API rejects on write (400); merlin re-validates on injection and skips with a log (fail closed).
- **Authorization** is a new `instructions: ["update", "approve"]` workspace statement — granted to owner/admin via the existing `workspaceGrants` spread, so members are read-only by construction.
- **At most one pending proposal per workspace**: a newer agent proposal marks the previous pending row `superseded` in the same transaction. Pending proposals are visible to all members (read-only); only owner/admins see approve/reject.
- **Activation races can't merge silently**: the supersede UPDATE is guarded on the exact active version read in the transaction, the partial unique active index backstops double-inserts, and unique violations surface as 409s. Direct edits guard on the client's `baseVersion`; approval guards on `proposal.baseVersion == current active` (stale proposals block approval in the UI with guidance to re-apply or reject).
- **Injection** appends an "## Workspace instructions" block to the end of the assembled system prompt in both `respond()` and `writeBack()` (after connector lines + guidance, before the conversation). The run's `instructions` snapshot (slice 2) already carries it through recovery unchanged.
- **`propose_instructions`** is registered as a side-effect tool in the tool guard, so a recovered step replays the cached result instead of filing a duplicate proposal. The push (`sendInstructionsProposalPush`) is presence-independent, goes to owner + admins only, and carries data-only deep-link fields — no approve action.
- **Web UI** is an "Instructions" section in the workspace settings dialog (`instructions-section.tsx`): editor with a token meter for owner/admins, read-only view for members, pending-proposal card with a rendered diff (`@pierre/diffs` `FileDiff`, unified layout, theme-synced via next-themes) + rationale + approve/reject, collapsible version history. Owner/admins also get a sidebar alert banner (`instructions-approval-alert.tsx`) while a proposal is pending, opening straight to the section.
- **Mobile approval flow shipped**: `instructions-proposal` push taps deep-link (with workspace switch) to `apps/mobile/src/app/settings/instructions.tsx` — same rationale/approve/reject as web, stale proposals blocked, read-only for members. Mobile's diff renders via jsdiff (`diff` package) — `@pierre/diffs` is DOM/Shadow-DOM-based and can't run in React Native.

## 10. Open decision points

- **Channel-scope serialization:** `scopeKey = threadRootId ?? channelId` serializes *all* channel-level runs in one channel — two people asking unrelated in-channel questions queue behind each other. Recommended for v1 (placement usually ducks noisy asks into threads anyway; contradictory overlapping answers are worse), but it's one line to relax later.
- **Event retention window** (proposed 7 days post-completion).
- **Write-back budget floor** numbers (proposed ≥15% token budget + ≥50 credits).
- ~~**`LOR.md` content cap** and pending-proposal visibility~~ — decided in slice 3: 8 KB, and pending proposals are visible to all members (read-only).

Schema changes land via `db:push` (Jacob runs it); slices 1–2 add `agent_run`, `agent_run_step`, `agent_run_event`, `agent_run_tool_result`, `agent_run_queue` + `message.clientKey`; slice 3 adds `workspace_instructions`.
