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

### B2 — processor integration (~300 LOC) — [x] built 2026-08-28, awaiting review/commit. Live tests still owed

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

### C1 — summarizing compaction (~400 LOC) — [x] built + rewritten 2026-08-28, awaiting review/commit

Shape (after the rewrite): one exported `compact({ messages, state, ... })` in
`packages/merlin/src/compaction.ts`, called once from `prepareStep`. Returns the
messages untouched below the trigger or if the reduced version fails validation.

    [original ask] [working notes] [verbatim tail] [authoritative task state]

Compaction is a **projection, not a deletion** — `agent_run_step` keeps the whole
transcript forever; only what gets *sent* shrinks. Head stays byte-identical so
the cached prefix survives. Still open from the Claude Code design: microcompaction
(stub old tool results before summarizing), prompt-too-long retry for the
summarizer itself, and restoring non-task state (recent artifacts, sandbox key).

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

### C2 — persisted compaction + trail divider (~450 LOC) — [x] built 2026-08-29, awaiting review/commit. **db:push owed** (`agent_run.compaction`)

Audit follow-up (compared against Anthropic's compaction API + Claude Code:
the summary is *persisted state that later requests build from*, not a
per-request computation). Three fixes, one UI feature:

- **Bug fix (recovery re-sent the raw transcript):** the resume path seeded
  the compaction trigger from `stepRows.at(-1).inputTokens`, which is small
  *after* a compaction while the raw replay stays huge — recovery would send
  the whole uncompacted history, and past ~2 compactions that exceeds the
  model window outright, making the run unrecoverable. Same fix as
  `replayChain`: `max(estimateMessagesTokens(replayed), lastStepInput)`.
- **`agent_run.compaction` jsonb** (`AgentRunCompaction`): `{ summary,
  summaryFailures, baselineMessages, atStep }`, overwritten on each
  compaction via `RunHandle.saveCompaction` (best-effort, lease-guarded; a
  failed write keeps the previous baseline, which replays correctly — steps
  after its `atStep` cover the gap). Saved *before* steer injection: injected
  messages ride the next checkpoint and would double on replay.
- **Replay from the baseline:** recovery and `replayChain` start from the
  newest baseline in scope/chain (`baselineMessages` + step rows
  `> atStep`) instead of the raw chain. Notes (`summary`) seed the successor's
  compactor (`RunResume.compaction` / `RunContinuation.compaction`;
  `summaryFailures` resets across runs), so facts merge forward instead of
  being rebuilt from `renderForSummary`'s front-clipped 120k-char digest —
  the old rebuild silently lost everything older than the clip. Also restores
  byte-identical prefixes across continuations (prompt cache) and drops the
  per-continuation re-summarization spend.
- **UI divider:** compaction rides the existing tool-trail rail as a synthetic
  `compact_context` entry fired via `onToolEvent` from `prepareStep` (start
  frame = spinner, `status: "ok"` frame = done) — no new event kind, socket
  event, API schema, or message column; replay/recovery/terminal persistence
  all come free. Keyed `compaction-${steps}` so a recovered attempt upserts
  rather than stacking dividers. Web renders it as a hairline divider with a
  centered "Compaction" badge (`merlin-compaction-divider.tsx`), split out of
  tool groups in `merlin-message-body.tsx`. Mobile renders it as a plain trail
  row (acceptable default, no changes).

### B3 — docs + hardening (~150 LOC) — [x] built 2026-08-28, awaiting review/commit

- `reference/agent-harness.md`: as-built update — two regimes, predecessor
  rules, `agent_run_step` permanence note.
- Guard note in `prune-run-events.ts` / schema comment: steps are never pruned.
- Stretch: vision parts for delta images.

## Track D — remaining silent-truncation fixes

Found while applying the no-silent-truncation rule to the rest of the context
path. Neither blocks B or C.

### D1 — read_thread window + honest placeholders (~300 LOC) — [ ]

- `packages/merlin/src/index.ts` `readThread` (~L490): today it is
  `orderBy(asc).limit(THREAD_MAX=100)` — the **oldest** 100. A 340-message
  thread silently drops the 240 most recent, the same defect fixed in B1's
  delta. And "oldest N" is the wrong window regardless: the tool takes a
  message id, so the model wants context *around that message*.
  - Always include the thread root (the subject; what a person sees pinned).
  - Window centred on the requested message, not from the beginning.
  - Return `omittedBefore` / `omittedAfter` counts explicitly.
  - Add `before`/`after` cursors so the model can page. Needed because
    read_thread output rides the 256KB per-call tool cap: a huge thread
    currently trips the generic "output too large, narrow the request" error
    that the model cannot act on, since the tool has no narrowing parameter.
- `buildInitialUserMessage` (~L1477): `[attachment: name]` is emitted for three
  different reasons (over `MAX_IMAGES`, unsupported type, failed fetch) and the
  model cannot tell which, so it cannot respond usefully. Say which, e.g.
  `[image: chart.png — not shown, only the 8 most recent images are included]`
  vs `[image: photo.heic — this format can't be viewed]`. Text only, no token
  cost.

### D2 — image access (~350 LOC) — [ ]

- **HEIC/HEIF are missing from `VISION_MEDIA_TYPES`** (jpeg/png/gif/webp only)
  — the default iPhone photo format, so a phone photo is silently unviewable.
  Transcode with `sharp` at fetch time in `fetchImageBytes`.
- **Do not simply raise `MAX_IMAGES = 8`**: images run ~1–1.5k tokens each and
  cache poorly, so a bigger cap is a permanent per-run bill. Instead add a
  `view_image(url)` tool — same philosophy as `export_tool_result`: every image
  in the thread stays reachable, but only the ones actually needed are paid for.
  ⚠️ Verify AI SDK v7 supports image parts in tool results before committing to
  this design; fall back to a modest cap raise if not.

### D3 — speaker spoofing in the transcript (~200 LOC) — [x] built 2026-08-29, awaiting review/commit

Channel turns render as `${authorName}: ${content}` lines inside one user
message (`buildInitialUserMessage`, and `formatDelta` copies the pattern). The
label is only a text convention, so a message body containing a newline plus
`Someone: …` renders as an additional apparent speaker. No special access is
needed — anyone can type a newline — and with all channels public to the
workspace, any member can appear to speak as any other (or as Merlin).

- `sanitizeRosterLabel` (strips `\r\n<>`, clips to 80) already exists but is
  applied **only** to the mentionable-people roster. Apply it to `authorName`
  in conversation turns too.
- Neutralize `Name:`-shaped line starts in message *bodies* — indent
  continuation lines, fence the body, or escape a leading `word:` pattern.
  Whatever is chosen must survive round-tripping into the stored transcript,
  since continued runs replay these strings verbatim.
- Same treatment for `formatDelta` and `withAttachmentLines` in
  `apps/worker/src/lib/agent-run.ts` (mid-run steer injections).

## Step order

A1 → A2 → B0 → B1 → B2 → B3 → C1 → C2 → D1 → D2 → D3. Each step: review →
Jacob commits → next. C1 (summarizing compaction) is independent of Track B and can
move earlier; it is the fix for mid-run forgetting, as B is for cross-run
forgetting. Track D is independent of both — D3 is the only one with a
security flavor, so it may deserve to jump the queue.

## Deviations log

- **C1:** context windows verified rather than guessed — GLM 5.3 Flash
  1,310,720 and Kimi K3 1,048,576. The **fallback** binds, not the primary, so
  `MERLIN_COMPACT_INPUT_TOKENS` went 60k → **700k**, not ~1M. Any future model
  change must re-check the smallest window in the chain.
- **C1:** the rolling notes were deliberately NOT persisted at first — a
  recovered attempt rebuilt them from its own transcript. **Superseded by C2**
  after the literature audit: rebuilding runs through `renderForSummary`'s
  front-clipped digest, so everything older than ~120k chars of raw transcript
  silently fell out of the rebuilt notes, and every continuation re-paid the
  summarizer. Notes + baseline now persist in `agent_run.compaction`.
- **C1 (token estimation stays a heuristic):** considered `gpt-tokenizer`;
  rejected. It ships OpenAI encodings only (r50k/p50k/cl100k/o200k), and the
  models here (GLM 5.3 Flash, Kimi K3) use their own vocabularies — it would be
  a differently-wrong number with false precision, plus BPE cost over megabytes
  every step. The exact count comes from the provider on each step regardless;
  the estimate only covers a continued run's first step and tail sizing. Made
  the heuristic conservative instead (UTF-8 bytes ÷ 3, was UTF-16 length ÷ 4),
  since under-counting is the dangerous direction in both uses.
- **C1 × B (compaction does not survive into the next run):** steps checkpoint
  the messages they *produced*, so `agent_run_step` holds the full uncompacted
  history and a continued run replays all of it — the predecessor's compaction
  is discarded (good for fidelity). But `replayChain` seeded the compaction
  trigger from the predecessor's last step's `inputTokens`, and after a
  compaction those steps are small *because* the bulk was projected away. The
  continued run would therefore send the entire uncompacted transcript without
  compacting it — the exact case most at risk of exceeding the window. Now
  seeded with `max(estimateMessagesTokens(assembled), lastStepInput)`.
  The open design question here (replay the compacted projection instead?) was
  settled **yes** in C2 — the "loses detail" worry was backwards, since the
  raw-replay path re-derived notes through a clipped digest and lost *more*.
  The same trigger-seeding bug also existed on the crash-recovery path in
  `agent-run.ts` and was fixed in C2.
- **C1 (compaction boundary):** `ai@7.0.11` documents that a `prepareStep`
  `messages` override **carries forward into later steps** (`index.d.ts:1644`),
  so a compacted array becomes the new baseline. The first implementation
  tracked "what is already summarized" as an index (`coveredThrough`) measured
  against the pre-compaction array — after one compaction that index pointed
  past the end of a now-shorter array, so the notes froze at v1 and never
  picked up later work, and a low split could stack two notes messages. Fixed
  by deriving the boundary from the array itself: the notes carry a marker
  (`isSummaryMessage`), everything after them is unsummarized, and the split is
  clamped to at least that point. Regression-tested by feeding `compact()` its
  own output.
- **C1 (rewritten):** first cut inserted notes and leaned on `pruneMessages`'
  implicit "last 4 messages" for the tail. Rebuilt around the Claude Code
  design Jacob supplied: single `compact()` entry point; explicit verbatim tail
  sized by tokens; split forced onto a complete tool round (`isSafeSplit`);
  authoritative task state re-injected from the DB after the tail instead of
  trusted to prose; assembled result validated for tool pairing before use;
  circuit breaker after 3 summarizer failures. `pruneMessages` is now only the
  fallback when summarization fails or validation rejects the assembly.
- **C1 (test tooling):** `beforeEach(() => mock.mockReset())` — arrow shorthand —
  returns the mock, and vitest calls a returned function as teardown, invoking
  the mock after the test. Cost an hour of false "the catch isn't catching"
  debugging. Always use a block body in `beforeEach`.

- **B1:** dropped `CONTINUATION_MAX_AGE` (was 6h). It was a cost guard, not a
  correctness one — and compaction already bounds an inherited transcript's
  size on the first step. A thread reply should carry the thread's working
  state however long the gap; elapsed time is surfaced to the model instead.
- **B2:** the steer-row exclusion had to be narrowed to
  `consumedAtStep IS NOT NULL`. `drainScopeQueue` marks the *winning* queued row
  `consumed` (leaving `consumedAtStep` null) against the **predecessor's** run id
  before enqueuing the follow-up, so excluding all consumed rows dropped the very
  message that triggered the continued run — the delta came back empty and
  continuation would have silently never fired for queued follow-ups, the most
  common path. Only rows with `consumedAtStep` set were actually injected into
  the predecessor's transcript.
- **B2:** `AgentRunContext.continuationDelta` stores the rendered delta verbatim.
  It embeds elapsed time ("about 3 hours since then"), so re-rendering it during
  crash recovery would produce a different string and break byte-stable replay.
  `replayChain` / `replayContinuedPrefix` are shared by the build path and
  recovery for the same reason.
- **B1:** dropped the 30-message delta window (and the fresh path's 30-message
  cap for thread scope) after Jacob's "everything they see, the model gets"
  call. Both are now 1000-row runaway guards that announce themselves if hit.
  Two more instances found and deferred to Track D: `read_thread`'s
  `THREAD_MAX = 100` (silent, and takes the oldest 100), and the ambiguous
  `[attachment: name]` placeholder covering three unrelated causes.
- **B1:** added the chain walk. Found while reviewing: a step row stores only
  its own run's messages, so the original one-hop design would have lost run 1's
  work as soon as run 3 continued run 2 — precisely the retry-after-retry case
  this track exists to fix.

- **B0:** no `apps/worker` change was needed. `saveContext` persists whatever
  `buildRunContext` returns, so adding `task` there put it in the snapshot
  automatically. Task title/goal moved to the state section too (not just
  status/plan/summary): the system prompt now holds zero per-task data, so the
  cached prefix is identical for every task run in a channel.

- **C2 (UI rides the tool trail):** first cut added a `compaction` event kind
  to `agent_run_event` + a `merlin:compaction` socket event + a persisted
  message column — reverted. The trail already gives any tool-shaped entry
  event-log persistence, live frames, late-join replay, recovery seeding
  (`loadTrailSeed`), and terminal persistence on the message row, so a
  synthetic `compact_context` MerlinToolCall gets all of it for one web render
  branch. The DB event-kind enum already carries two reserved-unused values
  (`queued`, `truncate`); didn't add a third.
- **C2 (`summaryFailures` resets across runs):** the circuit breaker counts one
  run's summarizer retries. Inheriting a predecessor's `3` would permanently
  disable summarization for every successor in the thread.

- **D3 (indent, don't pattern-match):** body neutralization indents *every*
  continuation line by two spaces (`formatSpeakerLine` in
  `packages/merlin/src/transcript.ts`) rather than escaping `word:`-shaped
  lines — no pattern to match means no pattern to evade, and only real
  speaker lines ever start at column 0. Two spaces, not four (four is a
  markdown code block). Applied at render time in all five speaker-line
  surfaces (initial transcript, steer/ambient updates, continuation delta,
  placement prompt, grounding-gate text); stored snapshots keep raw text, and
  already-stored `continuationDelta` strings replay verbatim (unsanitized) by
  design. Folding a delta turn's `[file: …]` lines into the body puts
  user-controlled filenames under the same indent; `buildInitialUserMessage`'s
  bracket lines instead use `sanitizeInlineLabel` (they interleave with image
  parts, so they can't ride the indent). `read_thread`/`search` return
  structured JSON — a name can't escape a JSON string field — so they need
  nothing. `sanitizeRosterLabel` moved to `transcript.ts` unchanged.
