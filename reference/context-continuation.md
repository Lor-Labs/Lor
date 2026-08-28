# Context Continuation & Data-to-File Pipe — Runbook

Two tracks fixing the weaknesses surfaced by the export failure (LOR-66 thread,
2026-08-28): bulk tool data forced through model context, and follow-up runs
rebuilding context from chat text instead of continuing the prior run's transcript.

Worked step-by-step: each step is an independently reviewable ~150–500 LOC diff.
Jacob reviews and commits each step manually before the next begins. Update the
checkboxes and deviations log as steps land.

## Locked decisions

- **No silent truncation of what people can see.** A thread is a bounded unit
  someone is looking at in full, so the model gets all of it — both in the
  fresh path (`THREAD_CONTEXT_LIMIT`) and in a continuation delta
  (`MAX_DELTA_MESSAGES`). Those constants are runaway guards, not windows, and
  if one ever trips the prompt says what was left out and how to fetch it.
  Channels stay windowed (unbounded firehose, nobody reads one "in full").
  Where content genuinely cannot be included (unsupported image type, oversize
  file), render a visible placeholder — never drop it.

- **Two context regimes, never mixed.** Fresh regime: a scope's first run (or
  fallback) builds a snapshot via `loadConversation` rules (30 channel msgs /
  thread + 10 pre-root). Continuation regime: follow-up runs in the same scope
  replay the predecessor run's transcript + append new human messages. A
  continued run never rebuilds or re-injects a snapshot.
- **Continuation applies to thread + task scopes only** (`contextThreadRootId`
  set). Channel-scope runs always use the fresh regime.
- **Predecessor eligibility:** most recent finished run in the same `scopeKey`
  with checkpointed steps. `complete` and `stopped` qualify; `failed` qualifies
  too (a budget-tripped run is exactly the one worth continuing).
  **No age cutoff** — a thread is one conversation however long the gap. A gap
  over 30 min is instead reported to the model in the delta ("It has been about
  3 days since then, so re-check anything that may have changed").
- **The whole chain replays, not one hop.** `agent_run_step.messages` holds only
  the messages that run generated, so continuing just the immediate predecessor
  would silently drop everything before it. `continuedFromRunId` is walked back
  to the chain root (cap 20 hops): root's snapshot, then each hop's delta
  (re-rendered from its `context.conversation`) and steps.
- **Delta rule:** appended messages = scope messages created after the
  predecessor's coverage, excluding rows the predecessor consumed as steered
  (`agent_run_queue.consumedAtStep`) — those are already inside its transcript.
- **Task state moves out of the system prompt** (status/plan/summary → tail of
  the initial user message via the context snapshot). Static task rules stay in
  the system prompt. Prerequisite for continuation: keeps the cached prefix of a
  run chain stable across plan updates.
- **`agent_run_step` is the permanent archive.** Never add a step pruner —
  continuation and run history depend on it. `agent_run_event` pruning (7d
  post-terminal) stays: events are redundant streaming frames once the message
  row and steps exist.
- **`export_tool_result` runs host-side with the run's existing authority**, on
  a deny-list (no approval-gated or action tools). Output goes to artifact
  storage (`putArtifactObject`), so its URL passes the existing
  `inputFileUrls` origin check unchanged.

## Track A — `export_tool_result` (data → file pipe)

Ship first: independent of Track B, immediate win for export-style tasks.

### A1 — tool module (~450 LOC) — [x] built 2026-08-28, awaiting review/commit

- `packages/merlin/src/artifacts/export-tool.ts` (new):
  - Input schema: `{ tool, args, filename, format?: "csv" | "json" }`.
  - Factory takes the run's assembled tool map + toolsContext; executes the
    named tool with the same context; result never enters model context.
  - Deny-list: `create_artifacts`, `propose_code_change`, `request_approval`,
    `set_plan`, `complete_task`, `propose_loop`, `propose_instructions`,
    `create_linear_issue`, `update_linear_issue`, `comment_linear`, brain
    write tools (`write`, `mkdir`, `move`, `link`), and itself.
  - Serialization: uniform array-of-flat-objects (or `{rows: [...]}`) → CSV
    (small local encoder, RFC 4180 quoting); anything else → pretty JSON.
    Handles the Neon MCP `run_sql` result shape explicitly.
  - Upload via `artifactBlobKey` + `putArtifactObject`; return receipt only:
    `{ url, filename, bytes, rowCount?, columns?, preview }` (preview = first
    5 rows).
- `packages/merlin/src/artifacts/export-tool.test.ts`: CSV encoding (quotes,
  commas, newlines, unicode), shape detection, deny-list, receipt shape.

### A2 — wiring + prompt (~250 LOC) — [x] built 2026-08-28, awaiting review/commit; live Neon check owed

- `packages/merlin/src/index.ts`: add to the tool map (assembled ~L1640) after
  the base tools exist (factory closes over the map), before `guardTools`
  (~L1841) so the receipt rides the normal byte caps. Gate on the same
  capability flag as `create_artifacts`.
- New prompt line (next to `ARTIFACTS_PROMPT_LINE`): when a tool returns bulk
  data, call `export_tool_result` instead of reading rows into context; the
  returned url is shareable in the answer and valid for
  `create_artifacts.inputFileUrls`.
- `apps/web` tool-call display: name/icon mapping for `export_tool_result`
  (same registry as other tool cards).
- Verify end-to-end against dev Neon MCP: query → CSV link → `inputFileUrls`
  into a workbench session.

## Track B — run continuation

### B0 — task state out of the system prompt (~250 LOC) — [x] built 2026-08-28, awaiting review/commit

- `packages/db/src/schemas/agent-runs.ts`: extend `AgentRunContext` with an
  optional `task` snapshot `{ title, goal, status, plan, summary }` (jsonb
  type only — no new column; rides the existing `context` snapshot so resume
  stays byte-stable).
- `packages/merlin/src/index.ts`:
  - Split `taskPromptSection`: static rules remain in instructions; volatile
    status/plan/summary render at the tail of the initial user message in
    `buildInitialUserMessage` (after brain/roster, before the final directive).
  - `respond()` reads task state from ctx as today; context builder copies it
    into the snapshot.
- `apps/worker/src/jobs/merlin-respond.ts`: pass task into the context
  snapshot at `saveContext`.
- Result: system prompt is stable per channel; plan updates no longer
  invalidate the whole prompt cache.

### B1 — continuation assembly (~400 LOC) — [x] built 2026-08-28, awaiting review/commit. **db:push owed** (`agent_run.continued_from_run_id`)

- `packages/db/src/schemas/agent-runs.ts`: add
  `continuedFromRunId: uuid("continued_from_run_id")` on `agent_run`
  (nullable, no FK cascade surprises — plain reference). **db:push owed.**
- `apps/worker/src/lib/run-continuation.ts` (new):
  - `findPredecessor({ scopeKey, workspaceId })`: newest terminal run in scope
    with steps, within `CONTINUATION_MAX_AGE`.
  - `loadPredecessorTranscript(run)`: rebuild
    `[buildInitialUserMessage(run.context), ...step messages]` — same pattern
    as the crash-recovery resume in `claimAgentRun`.
  - `buildDelta({ predecessor, scope, merlinMessageId })`: scope messages after
    the predecessor's start, minus steered-consumed rows, minus placeholders;
    render as one user message using the `withAttachmentLines` format
    (images as `[file: …]` lines in v1 — vision parts for deltas are a
    stretch item).
- Unit tests: delta dedupe against steered rows, age cutoff, empty-steps
  fallback, transcript ordering.

### B2 — processor integration (~300 LOC) — [ ]

- `apps/worker/src/jobs/merlin-respond.ts`: for thread-scoped runs
  (`contextThreadRootId` set) with no crash-resume state, attempt continuation
  before `loadConversation`. On success: feed the assembled messages through
  the same pathway `execution.resume` uses (fresh counters/budgets — this is a
  new run, not a recovery), persist `continuedFromRunId`, and store the delta
  turns as the new run's `context.conversation` so crash recovery of a
  continued run rebuilds deterministically (predecessor chain is static data).
  On any failure: fall back to the fresh regime silently.
- Compaction interplay: seed the first `prepareStep` with the predecessor's
  last step input size (same `lastInputTokens` mechanism as resume) so a heavy
  inherited transcript compacts immediately.
- Live tests owed: budget-trip → "continue" picks up mid-work; steer-then-
  continue does not duplicate messages; week-old thread falls back to fresh.

### C1 — summarizing compaction (~400 LOC) — [ ]

Replaces the current blunt prune (`pruneMessages` with
`toolCalls: "before-last-4-messages"` at `MERLIN_COMPACT_INPUT_TOKENS`, default
60k) — the mechanism behind "Merlin forgot what it just did" mid-run.

- **Summarize, don't delete.** Before dropping old tool calls, have the small
  model write a dense working-state note (IDs, confirmed schema/facts, exact
  queries run, files produced, what remains) and keep it in context in their
  place. Preserve verbatim: anything that looks like an identifier, URL, or
  file path — those are what re-derivation wastes steps on.
- **Raise the trigger far above 60k.** ⚠️ Must be derived from the configured
  model's real context window, NOT a guessed constant: setting it above the
  window converts a graceful compaction into a hard context-length failure.
  Verify `MERLIN_MODEL`'s window on the AI Gateway first, then set the trigger
  to ~70–80% of it. Env-configurable, since the model is.
- Cost note: GLM 5.3 Flash is $0.15/Mtok input, $0.03 cached — a large window
  is affordable here in a way it would not have been on Kimi K3 ($3/$0.3).
- Once this lands, `MAX_CHAIN_HOPS` / `MAX_INHERITED_STEPS` in
  `run-continuation.ts` stop being functional limits and are pure loop guards.
  Consider replacing the per-hop chain walk with one recursive CTE.

### B3 — docs + hardening (~150 LOC) — [ ]

- `reference/agent-harness.md`: as-built update — two regimes, predecessor
  rules, `agent_run_step` permanence note.
- Guard note in `prune-run-events.ts` / schema comment: steps are never pruned.
- Stretch: vision parts for delta images; `CONTINUATION_MAX_AGE` to env.

## Step order

A1 → A2 → B0 → B1 → B2 → B3 → C1. Each step: review → Jacob commits → next.
C1 (summarizing compaction) is independent of Track B and can move earlier;
it is the fix for mid-run forgetting, as B is for cross-run forgetting.

## Deviations log

- **B1:** dropped `CONTINUATION_MAX_AGE` (was 6h). It was a cost guard, not a
  correctness one — and compaction already bounds an inherited transcript's
  size on the first step. A thread reply should carry the thread's working
  state however long the gap; elapsed time is surfaced to the model instead.
- **B1:** dropped the 30-message delta window (and the fresh path's 30-message
  cap for thread scope) after Jacob's "everything they see, the model gets"
  call. Both are now 1000-row runaway guards that announce themselves if hit.
  Still open elsewhere: `read_thread`'s `THREAD_MAX = 100` truncates silently;
  `MAX_IMAGES = 8` drops older images but does render `[attachment: name]`, so
  the model at least knows one existed.
- **B1:** added the chain walk. Found while reviewing: a step row stores only
  its own run's messages, so the original one-hop design would have lost run 1's
  work as soon as run 3 continued run 2 — precisely the retry-after-retry case
  this track exists to fix.

- **B0:** no `apps/worker` change was needed. `saveContext` persists whatever
  `buildRunContext` returns, so adding `task` there put it in the snapshot
  automatically. Task title/goal moved to the state section too (not just
  status/plan/summary): the system prompt now holds zero per-task data, so the
  cached prefix is identical for every task run in a channel.

- (none yet)
