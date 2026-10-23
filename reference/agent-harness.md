# Durable agent runs (Lor harness)

As-built reference for the durable run system. Rewritten 2026-10-22 for the
Pi path (phase 1 of [harness-sessions.md](planned/harness-sessions.md); the
decisions and their history are in
[pi-harness-runbook.md](planned/pi-harness-runbook.md)). The legacy
`streamText` engine, its step checkpoints and transcript replay are deleted.

A Lor response is a durable **run**: Postgres owns its state, BullMQ only
schedules it. Each turn runs in the conversation's **Pi session** (Vercel
`HarnessAgent` + `@ai-sdk/harness-pi`), and the native Pi log is saved to
Postgres after every completed turn. A crash re-runs the turn from the last
saved turn. Spend is the real limit. Mid-run messages steer, queue or ride
along as ambient context.

## Data model (`packages/db/src/schemas/agent-runs.ts`, `harness-states.ts`, `workspace-instructions.ts`)

### `agent_run`

One row per user-facing run.

- **Identity:** `workspaceId`, `channelId`, `threadRootId`, `messageId` (the
  pending placeholder the run streams into), `triggerMessageId`, trigger
  provenance `triggerId`/`deliveryId` and `loopId`.
- **Scope:** `scopeKey` is the session's thread, or the call for voice runs.
  An Act run holds its trigger id until it moves into its own session. A
  partial unique index over active states (`queued | working | finalizing`)
  allows **one active run per conversation, enforced by Postgres**.
- **State machine:** `state` (`queued | working | finalizing | complete |
  failed | stopped`), `phase` (`answer | writeback`), `stopReason`
  (`completed`, `budget_spend`, `budget_wall_clock`, `out_of_credits`,
  `error`, `stopped_by_user`, `awaiting_approval`; older values stay in the
  enum for old rows). A paused turn settles `complete` with
  `awaiting_approval`.
- **Ownership:** `leaseOwner`, `leaseExpiresAt`, `attempt`, `maxAttempts`
  (2 = one recovery). Claims and every counter/state write are lease-guarded
  CAS updates.
- **Limits:** `budgetCredits` and `budgetWallMs`, snapshotted at creation;
  `deadlineAt` is absolute, so recovery can't extend it.
- **Usage counters** (cumulative, never reset on retry): `steps` (model
  calls), `inputTokens`, `cachedInputTokens`, `outputTokens`, `toolCalls`,
  `toolOutputBytes`, `creditsSpent`.
- **`context` + `instructions`:** the turn's request as sent (conversation
  snapshot or delta, roster, plan), the system prompt, and turn state that
  must survive retries: covered message ids, sandbox mode and sandbox
  context, a paused turn's sandbox state, Pi's context count
  (`contextUsage`), and `continueOnly` for runs that only finish a paused
  turn.
- `continuedFromRunId` links a run to its predecessor for the delta (see
  Continuation). `on delete set null`.
- Stop: `stopRequestedAt` / `stopRequestedBy`.

### `harness_state` and `harness_log`

One `harness_state` per conversation (a Lor session or a voice call), with
the saved head of Pi's session log (entry count, head entry id, byte length,
sha256), the adapter and format versions, the pending `continuation` while
approvals wait, and `lastRunId`. `harness_log` holds the log itself, one
chunk per save, each tagged with the `runId` that saved it. Saves happen once
per completed turn (and at pause and stop), inside the run's transaction,
guarded by the lease and a compare-and-swap on the previous head. Loading
checks length and sha256; a gap fails the run instead of starting Pi blank.
This log is the permanent record of what a run did; nothing prunes it.

### `agent_run_event`

Ordered event log for live UX and late-join replay. `(runId, seq)` unique;
`seq` comes from `agent_run.nextSeq`, so live socket frames and persisted
rows share numbering. Kinds: `text | reasoning | tool | memory | state |
steer` (`queued`/`truncate` reserved, unused). Writes are batched (~1 s / 50
events). A takeover jumps `nextSeq` by 10,000 so a zombie's tail can't
collide. Events of runs terminal for more than 7 days are pruned
(`prune-run-events.ts`); the message row keeps the durable trail.

### `agent_run_tool_result`

Idempotency for side-effecting Lor tools (`SIDE_EFFECT_TOOLS` in
`tool-guard.ts`): `(runId, toolKey)`, `toolKey = hash(toolName + canonical
input)`. A re-run turn returns the stored result instead of acting twice.

### `agent_run_queue`

Trigger-tier messages that arrived while a run was active: `scopeKey`,
`runId`, `messageId` (unique), `senderId`, `state` (`queued | steered |
consumed | rejected | cancelled`), `consumedAtStep`, `promotedAt`. Realtime
writes these rows; **only the worker writes `agent_run_event`**.

### `message.clientKey`

The client send nonce, with a partial unique index on (author, channel,
clientKey); a resend returns the original row and skips fanout and triggers.

### `workspace_instructions` (LOR.md)

Immutable version rows (`active | pending | rejected | superseded`); see
LOR.md below.

## Run lifecycle (`apps/worker/src/lib/agent-run.ts`, `jobs/lor-respond.ts`, `jobs/voice-request.ts`)

```text
queued ──claim──▶ working ──turn saved──▶ finalizing ──persisted──▶ complete
   │                 │  ▲                     │
   │                 │  └─recovery (attempt≤2)│
   └──────────▶ failed / stopped ◀────────────┘
```

- **Claim:** CAS `queued → working`, or takeover of an expired lease
  (`attempt++`). A claim that meets a live lease delays the job until the
  lease expires (`delayJobUntil`), without using an attempt. Heartbeat
  every ~20 s (TTL 60 s); a lost lease aborts the turn.
- **During the turn:** each model call's usage is recorded as it finishes
  (`recordUsage`), so the spend limit is checked inside the turn. The ledger
  is charged once per model per attempt (`<runId>:turn:<model>`), at the
  model that answered.
- **Save:** one transaction per turn (`saveTurn`): the new Pi log bytes, the
  approval rows of a paused turn, the remaining counters (compaction and
  cache usage, tool counts) and the run's context updates.
- **Recovery:** BullMQ `attempts: 2`, `jobId = runId`. The retry claims on
  an expired lease. If the lost attempt already saved its turn, the saved
  answer is delivered instead of running the turn twice. Otherwise the turn
  runs again from the last saved turn, with a note that an earlier attempt
  may already have changed files or connected services; side-effecting Lor
  tools replay from `agent_run_tool_result`.
- **Finalizing:** citation grounding, message persistence and fanout, then
  write-back (skipped and recorded when the run finished near its spend or
  time limit), touches, session title.
- **Dead-run sweep** (10-min interval): force-fails claimed runs 10 min past
  `deadlineAt` and never-claimed runs 30 min past `createdAt`, settles their
  placeholders, then drains their scope queues.

## A turn (`packages/lor/src/index.ts`, `session-core/pi-runtime.ts`)

`respond()` refuses to run without a session harness. It builds Lor's
system prompt and tool set, opens the conversation's sandbox, and runs one
Pi turn (`runPiTurn`):

- **Sandbox:** every run gets its conversation's Blaxel sandbox
  (`openSessionSandbox`): one per session or voice call, created on the first
  run, reused after, in standby between turns. Commands still running from
  an earlier attempt are stopped first. A replaced sandbox continues empty
  with a notice to the model and a trail row. See
  [artifacts.md](artifacts.md) for files.
- **Tools:** Lor's host tools (memory, search, connectors, plans,
  `share_file`, `clone_repo`, MCP and custom tools) plus Pi's built-ins
  (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `ls`). Lor tools are
  wrapped by `tool-guard.ts` (256 KB per-call output cap, idempotency).
- **Approvals:** workspace approval policies gate Lor tools; `bash`, `write`
  and `edit` follow the turn starter's sandbox mode (manual, auto with the
  classifier, bypass; Loop and Act runs are autonomous). A gated call pauses
  the turn; see [approval-policies.md](approval-policies.md).
- **Limits inside the turn:** at 90% of the spend limit, or near the
  deadline, tools are refused so the model answers; at the limit the turn is
  aborted and the step that crossed it still counts.
- **Compaction:** Pi's own, with Lor's focus (copy ids, citations and paths
  exactly) and the plan restated after it. It shows in the trail as a
  `compact_context` row (web divider). Its usage is charged like the turn.
- **Steering:** at each Pi turn boundary, steered queue rows and ambient
  messages (see below) are saved into the Pi log as a conversation update.
- **Trail:** text, reasoning, tool rows (Pi's sandbox tools as flat rows
  with diffs) and memory writes stream as run events and persist on the
  message.

## Continuation (`apps/worker/src/lib/run-continuation.ts`)

The Pi session holds the conversation, so a later run sends only what is
new. A session's first run sends the initial message (conversation snapshot,
roster, plan). Every later run sends a **delta**: scope messages since the
predecessor, without Lor's own messages, still-queued rows, or messages a
turn already took in (`coveredMessageIds`). The delta walks back through
runs that only finished a paused turn (`continuedFromRunId`), and always
includes the trigger message. See
[context-continuation.md](context-continuation.md).

## Context meter (`GET /v1/runs/context/{scopeKey}`)

Ring in the session composer showing how full the model's window is.

- **The total is Pi's own count** (`getContextUsage()`), taken at each answer,
  at compaction and when the agent settles, and saved on the run
  (`context.contextUsage`) with the window, the compaction point (window minus
  Pi's 16,384 reserve) and whether the session compacted. The meter reads the
  newest run that has it; it is hidden until the first turn saves.
- The System and Tools segments are estimated from the saved prompt and tool
  schema sizes (bytes ÷ 3); Messages is the rest.
- "History kept" is the saved Pi log size.
- Cost is shown in credits, never USD.

## Limits

Spend is the only real limit (runbook §4.5). Env-defaulted in
`packages/env`; credits and wall clock are snapshotted per run.

| Limit | Default |
|---|---|
| Spend | `AGENT_RUN_MAX_CREDITS` 2,000 (operator backstop while billing is off) |
| Wall clock | `AGENT_RUN_MAX_WALL_MS` 2 h; 10 min for voice |
| Tool output | 256 KB per Lor tool call; Pi cuts any tool result at 50 KB |
| Recovery attempts | 1 |

There are no step, token or tool-call ceilings.

## Realtime + replay

- Socket frames (`message:stream`, `lor:tool`, `lor:reasoning`,
  `lor:memory`, `lor:steer`) carry `{ runId, seq }`.
- Replay API: `GET /v1/runs/by-message/:messageId/events?after=<seq>`.
- Client protocol (web `use-lor-stream.ts`, mobile `run-replay.ts`): a
  pending placeholder in view starts a replay — buffer live frames, fetch the
  log, rebuild streamed fields, drain the buffer gated by seq. Terminal runs
  refetch the message row.

## Multiplayer steering (two-tier contract)

- **Trigger tier:** a message that would trigger Lor while a run is active
  goes to the scope's queue. The composer shows the queue as a pill:
  **Steer** (`POST /v1/runs/queued-messages/:messageId/steer`) promotes the
  row and stops the active run, so it is answered next; **remove**
  (`DELETE /v1/runs/queued-messages/:messageId`, sender only) cancels it.
  `steered` rows are injected at the next turn boundary. The completion
  drain (`run-queue.ts`, `drainScopeQueue`) pops one row per finished run
  (`promotedAt` first), reauthorizes the sender, and starts one follow-up
  run for it.
- **Ambient tier:** messages not addressed to Lor (teammates talking
  mid-run) are re-read at each turn boundary and added as context only, with
  no delivery guarantee. Queued rows are never read early.

## Stop

`POST /v1/runs/by-message/:messageId/stop` (any member with channel access):

- A never-claimed `queued` run is settled by the API.
- A `working` run gets `stopRequestedAt/By`, and the API publishes the run id
  on `agent-run:stop`. The lease-holding worker aborts the Pi turn at once;
  `respond()` keeps the partial text and returns `stopped_by_user`, the worker
  saves the partial answer, settles the run `stopped` and skips write-back.
- A turn paused on approvals is dropped: its pending approvals are denied and
  a later run is told the calls did not run.
- `finalizing` accepts the flag but does nothing; terminal runs get 409.

## LOR.md (workspace instructions)

Durable operating instructions, distinct from workspace memory. Repository
files named `LOR.md`/`AGENTS.md`/`CLAUDE.md` are never workspace instructions.

- Owner/admins edit directly (active at once, audited). Agent proposals
  (`propose_instructions`, a side-effect tool) stay `pending` until a human
  approves that exact version.
- Validation on write **and** injection, fail closed
  (`validateWorkspaceInstructionsContent`): ~2,000-token cap plus secret
  heuristics.
- Version-guarded supersede and a partial unique active index turn races into
  409s.
- Injected as a "Workspace instructions" block in the `respond()` and
  `writeBack()` system prompts; the run's `instructions` snapshot carries it
  through recovery.
- Proposal push (`sendInstructionsProposalPush`) deep-links owner/admins to
  the approval screen.

## Plans

Plans (delegated multi-step work, formerly Tasks) layer over session runs;
see [tasks-v2.md](tasks-v2.md).

## Open items

- Live QA owed for the Pi path: approvals (single, set, steer, Stop, voice),
  sandbox modes and the classifier, egress, the spend limit, mid-turn
  messages, two queued messages, a worker crash mid-turn, a paused Loop
  followed by a message, compaction, the context meter and touches.
- Known gaps (runbook 1.3 exit review, low): resume enqueue failure after a
  decision commits, approval gates not re-checked mid-turn, usage of turns
  that do not finish, steered or voice messages lost on a crash.
