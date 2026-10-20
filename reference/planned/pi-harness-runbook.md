# Pi foundation migration runbook — phase 1

> Status: revised 2026-10-20 after a source review of the exact published
> packages, the repository and vendor docs. **Documentation only;
> implementation not started.** Implements phase 1 of
> [Shared harness sessions](harness-sessions.md). Repository baseline: `dev`
> at `7d663fdf`; planning branch: `codex/pi-harness-sessions`.
>
> **Runtime decided (G0 closed 2026-10-20):** Vercel `HarnessAgent` +
> `@ai-sdk/harness-pi`. Pi Durable is rejected for phase 1. Vercel's
> `durable-harness` is a reference design, not a dependency. See §3.

Use Vercel's Pi adapter, Pi's native compactor and the adapter's remote
file/shell tools. Lor supplies policy, storage, budgets and the Blaxel bridge.
The adapter is a good base but is not a drop-in replacement: several defaults
must be overridden (§4.9) and its native-state handling cannot be Lor's
authority (§4.3). Do not infer production readiness from the common API alone.

## 1. Decisions and scope

### Decisions locked with Jacob, 2026-10-20

| Topic | Decision |
|---|---|
| Runtime (G0) | `HarnessAgent` + `@ai-sdk/harness-pi`. Vercel ships Claude Code and Codex adapters on the same harness spec, so phase 2 reuses the session core. Pi Durable and `durable-harness` are rejected for phase 1 (§3). |
| Durability (G2) | **Save native state per completed turn**, plus approval suspension and stop. A worker crash mid-turn loses that turn's native progress; recovery re-runs the turn from the last saved turn. Mid-turn native recovery is not required in phase 1. Re-evaluate an upstream session-store contribution later if crash loss hurts in real use. |
| Budgets (G5) | **Spend is the real limit** (§4.5). Drop the step, tool-call and token ceilings for Pi runs; keep Stop, the per-call output limit and a high wall-clock backstop. Target: the workspace balance with auto top-up and an admin monthly cap, stopping only when the balance cannot be refilled. Interim while billing is off: `AGENT_RUN_MAX_CREDITS` as a raised emergency backstop. No new strict gate before every model request. Count automatic compaction usage. |
| Compaction (G4) | Keep Pi's default trigger and algorithm. Add Lor's instructions (copy IDs, citations, URLs and file paths exactly) through `session_before_compact`. Revisit the trigger only if real use shows a cost or quality problem. |
| Pi settings | None in phase 1: compaction, retries and cache warming keep Pi's defaults. If a setting must change later, patch the adapter with `pnpm patch` to pass a settings record and send the same change upstream as a PR. |
| Sandboxes (G6) | Every agent run gets its session sandbox, **including voice, Loop and Act runs**. Each needs a session workspace owner before it provisions. |
| Lost workspace (G6) | **Interim until phase 2.** If a session's sandbox no longer exists (crash or deletion), continue the session in a new empty sandbox and tell the model and the people in the session that earlier files are gone. Fail the run only when the native **conversation** state is missing or corrupt. Phase 2 Git checkpoints replace this: Lor rebuilds the sandbox from the last completed-turn commit. |
| Capacity | Build as if sandboxes are unlimited. No idle TTL or reclamation for session sandboxes in phase 1; capacity planning is deferred. A quota error still fails the run visibly. |
| Worker runtime | Run the Pi path on **Bun**, the worker's current runtime. Verify the adapter on Bun in 1.1; move the Pi path to Node only if a concrete Bun failure appears. |
| AI SDK | Upgrade `ai` repo-wide to the version the harness requires (≥ `7.0.145`). Change the remaining AI SDK callers (write-back, placement, titles, classifiers, embeddings, rerank) where the upgrade needs it. |
| Legacy engine | **Delete it** (2026-10-20). No one uses the app yet, so there is no flag, rollout, drain or import. Old sessions have no native state; their first Pi run starts from the visible session history, like any first run. Legacy run tables keep their rows but receive no new writes; dropping them is a separate later decision. |
| System prompt | Lor's own prompt replaces Pi's "expert coding assistant" prompt through a `before_agent_start` extension. Keep Pi's tool list and tool rules; drop the Pi-docs section. |
| Tool permissions | A new **Computer** built-in group in agent-profile tool access holds Pi's `bash`, `read`, `write`, `edit`, `grep`, `find` and `ls`; on by default. Each of these tools is an approval-policy target, off by default like every gate. When the group is off, the tools stay in the session's fixed list and are refused when called. |
| Quality check | Jacob runs `eval:long` on the Pi path before the switch. The eval harness moves to the Pi path. |
| Skills and slash commands | Out of phase 1; moved to the self-configuration work. |
| Versions | Re-baseline on `@ai-sdk/harness-pi@1.0.159`, `@ai-sdk/harness@1.0.157`, Pi `1.3.0`. Pin exact versions; the harness ships breaking changes in patch releases. |

### Earlier revisions (kept for the record)

| Earlier proposal | Decision |
|---|---|
| Direct Pi SDK by default | Use `HarnessAgent` + `createPi`; supported configuration/extensions first, then focused upstream changes. Direct SDK is a per-gap fallback. |
| New Pi-to-AI-SDK inference bridge | Use Pi's Gateway provider. Add routing through the payload hook (§4.5). No new transport. |
| Port Lor's summarizer into the new loop | Use Pi's native compactor with Lor's instructions through `session_before_compact` (§4.4). |
| Disable native retries and implement Lor retries | Use Pi's retries. Do not stack retry engines. |
| New native approval/batch replay dispatcher | Reuse harness approval/continuation state and Pi adapter replay. |
| New filesystem/shell tool implementations | Reuse the adapter's remote tools. |
| Zero sandbox allocation for plain chat | Every agent run gets an isolated session sandbox. Cost optimization is deferred. |
| Six prescribed new storage tables | Minimum additive schema after the native-state contract is settled. |
| Session code mixed with product behavior | Internal session core behind injected storage, policy and execution interfaces; no published SDK. |
| Pi Durable as a phase-1 candidate | Rejected for phase 1 (§3). |

### Agreed product architecture

- One session model for Lor chat/cowork/code, with Pi the Lor-funded primary
  runtime. Human channel chat remains human chat.
- Shared session orchestration, product behavior and Lor services must support
  official Claude Code/Codex adapters without a second architecture. Pi-specific
  APIs must not become dependencies of the common product layer.
- Lor owns memory, permissions, approvals, plans, Loops, queues, budgets, billing,
  collaboration and durable identity. Pi owns the model/tool loop and native context.
- Postgres owns native Pi history and common durable activity. Private Git will
  own checkpoint file trees, joined through immutable checkpoint references.
- A completed user turn and a model/tool iteration are different boundaries.
  Phase 1 saves native state at completed turns (and approval/stop boundaries).
  Recovery after a crash re-runs the interrupted turn; it must not blindly
  replay uncertain external effects. A moving branch name is not a historical checkpoint.
- Every Lor agent run gets its session sandbox, regardless of chat type or harness.
  Create it on the session's first agent run, reuse the same logical workspace
  across turns and allow standby between runs. Human-only channels do not create
  agent runtimes.
- Credentials and permission decisions are resolved afresh, not restored from
  snapshots. A sandbox does not grant permission to execute every available tool.

This is **phase 1 only**. Phase 2 adds private Git checkpoints and official
Claude Code/Codex adapters. Phase 3 adds forks/handoffs/strict rewind; phase 4
adds code collaboration. CLI, publishing an SDK, direct subscription inference,
an extension marketplace, a new terminal UI, mid-turn native recovery, skills,
slash commands and allocation cost optimizations are deferred. Billing changes (the workspace
balance limit, auto top-up, the monthly cap and the in-run balance check, §4.5)
are not part of phase 1; they ship with the billing work in
[pricing-and-billing.md](pricing-and-billing.md). Phase 1 only keeps usage
recording unchanged and raises the per-run credit backstop. Do not use extraction-readiness to
expand this migration.

Until phase 2, workspace files have no durable revision. A lost sandbox loses
its files (artifacts saved through `writeArtifactVersion` survive). Lor says so
explicitly and continues in a fresh workspace; it never presents a fresh
workspace as an exact resume. Phase 2 checkpoints restore the files of the last
completed turn instead.

## 2. Evidence baseline

Source review of published package archives, the repository and vendor docs,
2026-10-19/20. Nothing was installed in this repository; no tests or runtime
experiments ran. Verified source behavior is separated from inference below.

| Component | Version | Notes |
|---|---|---|
| `@ai-sdk/harness-pi` | `1.0.159` (first review on `1.0.158`) | 1.0.159 added prompt image input. Depends on `pi-coding-agent ^1.0.3`. |
| `@ai-sdk/harness` | `1.0.157` | Shared by the Pi, Claude Code (`1.0.161`) and Codex (`1.0.159`) adapters. Needs `ai@7.0.145`. Docs label it experimental; ~8 releases a week; breaking changes ship as patches (e.g. 1.0.92, 1.0.123). |
| `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` | `1.3.0` (first review on `1.0.3`) | `^1.0.3` resolves to 1.3.0 on a fresh install. Compaction, session manager and Gateway behavior below were rechecked on 1.3.0. |
| `@ai-sdk/provider-utils` | `5.0.64` | `SandboxSession` contract unchanged from 5.0.63. |
| Existing Lor | `ai@7.0.11`; sandbox image Pi `0.84.1` | The worker **runs on Bun** (`oven/bun:1-slim`). Harness packages declare `node >=22`, and the Pi adapter patches `node:fs` process-wide; Bun support is unverified (decision: try Bun first). |

Source keys: **P** = `@ai-sdk/harness-pi` `src/`; **H** = `@ai-sdk/harness`
`src/`; **C** = `pi-coding-agent` `dist/core/`; **A** = `pi-ai` `dist/`.
Function and type names are the evidence anchors. Reinspect them if versions
change; a newer doc example does not prove an older package has that behavior.

## 3. Runtime choice (G0) — closed

The deciding constraint is shared code and consistent behavior across Pi,
Claude Code and Codex.

| Candidate | Assessment |
|---|---|
| **`HarnessAgent` + `harness-pi` (chosen)** | Vercel publishes Claude Code and Codex adapters on the same `HarnessV1` spec, released together with `harness-pi`. Lifecycle (create/resume/detach/stop/`suspendTurn`), the opaque continuation state with framework-owned pending approvals, host-tool approvals and the UI stream are written once for all three. Gaps are adapter-specific and listed below. |
| Pi Durable (`@earendil-works/pi-durable@1.3.0`) | Strongest persistence model: awaited atomic `Storage.commit`, tool intent recorded before execution, durable retries/compaction, prompt images. Rejected for phase 1: Pi-only, so Claude Code/Codex would need a second session core; no approval pause (`beforeTool` waits in memory; upstream issue #10852 open); `beforeRequest` fails open (#11055); no conversation deletion (#11026), which conflicts with Lor's deletion rule; Postgres storage must be written (no cross-process locking; the third-party adapter is single-owner); storage contract changed in 1.1.0 and 1.2.0. Revisit after #10852 lands and the API settles. |
| Vercel `durable-harness` (`0.0.1-beta.6`) | Nearly Lor's target design: the session is a Workflow run, its event log is the source of truth, a crash resumes the turn elsewhere, unsafe tools never run twice, one VM and drive per session, idle cleanup tells the session its files are gone. Rejected as a dependency: separate stack (not `@ai-sdk/harness`); Claude Code/Codex run only in Vercel Sandbox (Lor uses Blaxel); no human-approval API; text-only input; its own Postgres queue beside BullMQ; repo created 2026-10-16. Use it as a reference design. |
| Direct Pi SDK | Per-gap fallback inside the same session boundary only. Record the blocker first. |

**Cross-harness facts to carry into phase 2** (verified from adapter source):

- All three adapters keep native state in the sandbox HOME; their resume state
  is only a pointer. Pi and Codex silently start a fresh conversation when that
  state is missing. Lor's Postgres copy and load check (§4.3) must exist per adapter.
- Codex has no built-in tool approvals (allow-all only, platform sandbox off) and
  starts a new native thread when instructions, tools or skills change.
- Claude Code and Codex run a bridge inside the sandbox. The worker must reach an
  exposed sandbox port, and credentials stay out of the sandbox only with request
  transformations. No AI SDK Blaxel sandbox adapter exists.
- No adapter implements `readHistory`.
- Adapter "subscription" modes read the host user's own credential files: a
  single-developer feature. Anthropic's Agent SDK docs state that third parties
  may not offer claude.ai login or rate limits without prior approval; OpenAI
  requires an interest form for remotely hosted apps. Confirm hosted terms with
  both vendors before planning phase 2 around personal subscriptions.

## 4. Requirement findings and decisions — selected adapter

### 4.1 Images (G1): mapping task, not a blocker

**Observed (1.0.159):** H `extractHarnessPromptContent` and P
`extractPiPromptContent` pass prompt images to `AgentSession.prompt`. Limits:
images must be inline (base64, bytes or data URLs; URLs and provider references
are rejected); only image media types; any text after an image throws
`HarnessCapabilityUnsupportedError`; the model must declare image input. Pi
stores prompt images inline as base64 in the native journal. The `read` tool
returns image blocks; host-tool `toModelOutput` images have a conversion path.

**Lor today:** `initial-message.ts` inlines up to 8 images (5 MB each, `images.ts`)
next to the messages they belong to. `view_image` sends bytes through
`toModelOutput`; stored transcripts keep only a receipt. Continuation deltas
and steering show images only as `[file: …]` lines.

**Decision:** fetch and inline authorized images at the prompt boundary. Put all
text first, then the images, each labeled in the text with its message and
attachment ID. Keep `view_image`. Native entries will carry image bytes, so the
Postgres store must stage large payloads (§5). Gateway catalog: DeepSeek V4.1
Flash and Kimi K3 accept image input; some endpoints (e.g. `runinfra`,
`baseten`) lack the vision tag, which Lor's provider order avoids.

### 4.2 Approvals (G3): reuse the harness protocol

**Observed:** H persists pending approvals (a list), client tool results,
completed host results and frozen turn settings. P persists pending native
batches with completed results and approval decisions; cold replay reuses
completed results, suppresses duplicate output and zeroes replayed usage.
Replay is keyed by tool-call ID; calls running at a crash run again.
`reattachInProcess: false` restores from persisted state. Sources: H lifecycle
state/`run-prompt`; P `pi-resume-state`, `pi-tool-batch`,
`requestBuiltinToolApproval`, `doContinueTurn`.

**Lor today:** two kinds of approval. Policy gates return `user-approval` from
`approval-policy.ts`; the discretionary `request_approval` plan tool sets a flag
that forces a final text step. A run parks, the post-loop sweep makes the step
durable, `fileParkedApproval` inserts the row, and the run stops with
`awaiting_approval`. Partial unique indexes allow one pending approval per run
and per plan. Resolution starts a **successor run** that replays the chain and
ends with the `tool-approval-response`. Latent bug: `index.ts` overwrites
`parked` per request, so two gated calls in one step file only the last one.

**Decision:** keep the harness protocol. Remove the proposed Lor batch replayer
and manual insertion of approval results. Map policy gates to harness
`toolApproval` with exact arguments; keep resolver authorization, voice
restrictions, HMAC binding intent and plan waiting states. Save native state at
the suspension (§4.3) and release the worker. Map `request_approval` explicitly
(it is a tool result plus a parked plan, not a gate). Pi's built-in tools become
approval targets too (§4.6); built-in approvals go through
`requestBuiltinToolApproval`. The harness supports several pending approvals;
present them as a set and drop the one-per-run index, which also removes
today's multi-gate bug. Confirm partially
answered batches, revocation and host-tool context rebinding in 1.1. Tool-call
IDs must be non-empty: the Anthropic Messages path copies provider IDs, while
the OpenAI Chat Completions path defaults missing IDs to `""` (A
`openai-completions`), so do not configure Chat Completions.

### 4.3 Durability (G2): save per turn; Postgres is the authority

**Observed:**

- Pi runs in the worker process (P). During a turn the journal is a local file
  under the worker's temp directory. P `persistSessionFileToSandbox` copies it to
  `$HOME/.ai-sdk/harness-pi/<sha256(id)>` in the sandbox only on stop, detach or
  suspend. Resume JSON holds a filename and pending-batch data, not the native bytes.
- `doStop`/`doSuspendTurn` swallow copy failures. A missing restored file makes
  P create a fresh `SessionManager` instead of failing.
- The sandbox HOME is writable by the model's `bash`. The journal is reloaded on
  cold resume without an integrity check.
- P `rebuildPiSession` disposes the session and calls `SessionManager.create`
  (a new, empty journal) when the sorted host-tool names change between turns.
  Calling harness `compact()` on a freshly resumed session builds it with no
  tools, so the next prompt also drops restored history.
- H lifecycle callbacks use `Promise.allSettled`; P `piSession.subscribe` is a
  void emitter. C extension `message_end` runs before the journal append.
- C `SessionManager.inMemory(cwd, opts, entries)` can start from external
  entries, but the adapter always uses file-backed create/open.

**Decision (2026-10-20): save per turn.**

1. Save points: completed turn, approval suspension, user stop, budget stop.
   Each save is one Postgres transaction: new native journal entries, the
   harness continuation state, activity projection, counters, stop reason and
   the new head. Guard it with the lease generation and the expected previous
   head. A failed save fails the run; it never reports a completed turn.
2. Before each resume, write the saved journal from Postgres into the sandbox
   path the pinned adapter reads, then verify that the loaded session matches
   the saved head (an inline extension reads the loaded entries, or compare the
   file hash before resume). Missing, mismatched or corrupt state fails the run
   visibly. Never accept the adapter's silent fresh start. The sandbox file is a
   runtime copy; Postgres is the authority. The path is adapter-internal: pin
   the version and recheck it on upgrade.
   Save from the worker's live copy, not the sandbox copy, so a model edit to
   the sandbox file never reaches Postgres; the next restore overwrites it. Add
   the adapter's state folder (`$HOME/.ai-sdk/harness-pi`) to
   `fileToolPathPolicy.deniedRoots` so the file tools refuse it. That policy
   does not restrict `bash`; the restore makes `bash` edits harmless.
3. Keep **one stable host-tool list per session**. Bind every tool the session
   may use and deny unavailable ones at execute time, so a grant or connector
   change never changes the tool-name set. Do not call harness `compact()` on a
   freshly resumed session.
4. Worker crash mid-turn: the turn's native progress is lost. BullMQ's second
   attempt re-runs the turn from the last saved head with the same input and a
   note that an earlier attempt was interrupted and may have changed files or
   external systems. Lor side-effect tools keep `agent_run_tool_result`
   receipts, so an identical repeated call returns the stored result; a
   different call is not deduplicated. Usage of the lost attempt is still
   counted (recorded per step, §4.5) and not re-billed. Clients get today's
   replace frame. Sandbox file changes from the lost attempt stay.
5. Later option, not phase 1: an upstream session-store option for the adapter
   (load entries from a store, awaited append per entry) would restore mid-turn
   recovery. `SessionManager.inMemory(entries)` makes it plausible.

### 4.4 Compaction (G4): Pi's algorithm, Lor's instructions and settings

**Observed (1.3.0):** C `shouldCompact` triggers when context tokens exceed
`contextWindow − reserveTokens`. Defaults: `reserveTokens` 16,384,
`keepRecentTokens` 20,000. For DeepSeek V4.1 Flash (1,048,576 window) that is
about **1.03M tokens**. Auto-compaction passes no custom instructions.
`session_before_compact` may cancel or return a replacement. The exported C
`compact(preparation, model, apiKey, headers, customInstructions, signal,
thinkingLevel, streamFn, …)` and `generateSummaryWithUsage` take custom
instructions, a model, a stream function and the previous summary (iterative
update). Compaction requests skip `before_provider_request` (they get
`before_provider_headers`) and retry 3 times. P `doCompact` discards the native
result; the normalized event has no usage, but the turn's usage total includes
auto-compaction cost. Harness `compact()` aborts a running turn.

**Lor today (`compaction.ts`):** triggers at about 520k tokens (0.75 × min(700k,
0.8 × window) minus instructions and tool schemas); keeps a ~60k verbatim tail;
keeps the first message byte-identical for the prompt cache; summarizes only new
activity on the small model with an identifier-preserving prompt; merges notes
(12k cap) across recovery and successor runs; re-reads plan state from the DB;
falls back to pruning after 3 failures; `fitMessagesToBudget` as a hard limit.

Pi also recovers from a context-overflow error: C detects it with pi-ai
`isContextOverflow` (provider error patterns, including Kimi's "exceeded model
token limit"), compacts and retries once.

**Decision (2026-10-20): Pi's trigger, Lor's instructions.**

- Keep Pi's default trigger (`reserveTokens` 16,384, `keepRecentTokens` 20,000)
  and algorithm. No settings change (§4.9).
- Handle `session_before_compact` with a trusted inline extension that calls
  Pi's exported `compact()` with Lor's instructions: copy message IDs, citation
  IDs, URLs, file paths and other identifiers exactly; keep open decisions and
  plan progress. Return the result with its usage. The summary uses the session
  model, as Pi does by default. This keeps Pi's cut-point and iterative-summary
  algorithm; no upstream change and no second compactor.
- Re-inject current plan state after compaction through the `context` hook, at
  the end of the context (prompt cache, §4.8).
- Accepted changes from today: compaction starts near 1.03M tokens instead of
  ~520k; Pi summarizes Lor's first context message once it falls outside the
  kept tail; summary requests carry no gateway `order`/fallback options unless
  the hook passes Lor's routed stream function (optional).
- Known edge: Kimi K3's window (1,000,000) is smaller than DeepSeek's trigger
  point. A gateway fallback to K3 above 1M tokens is rejected; Pi's overflow
  recovery should compact and retry. 1.1 confirms that the gateway's error text
  matches `isContextOverflow`.
- Revisit the trigger (through the settings patch, §4.9) only if real use shows
  a cost or quality problem at very long contexts. The long-task eval ran with
  today's ~520k trigger.
- Commit the compaction entry with the turn save. Count its usage.
- `compaction.ts` is deleted with the legacy engine.

### 4.5 Gateway, retries and budgets (G5): match today

**Gateway (verified):** pi-ai sends Gateway traffic to `https://ai-gateway.vercel.sh`
with the Anthropic Messages API. Both Lor models are in pi-ai's catalog (DeepSeek
V4.1 Flash: 1,048,576 context, 32,768 output; Kimi K3: 1,000,000 / 131,072),
with `allowEmptySignature` for DeepSeek's unsigned thinking blocks (1.3.0). An
unknown model ID throws. The Gateway accepts `providerOptions.gateway` in the
Messages JSON body. pi-ai's `compat.vercelGatewayRouting` is ignored on this API
(upstream issue #9211), so add `models`/`order` with a `before_provider_request`
extension. That hook does not cover compaction, so the summary stream function
(§4.4) must add the same options.

**Caching:** `caching: "auto"` adds markers only for Anthropic, MiniMax and
Alibaba; DeepSeek caches implicitly and Moonshot is not listed. Cache hits depend
on the `x-session-affinity` header, which pi-ai sets from the session ID. Use
the Lor session ID. Pi `cacheRetention` is not Gateway caching.

**Retries:** use Pi's retry loop (on by default, 3 tries, 2 s base) and provider
retries. The adapter does not expose retry settings (§4.9). No outer Lor retry.

**Lor today:** per-run ceilings (500 steps; 10M input tokens with cache reads at
×0.1; 1M output tokens; 1,000 tool calls; 256 KB per tool output and 16 MB in
total; 2 h; 2,000 credits = $20 at Lor's prices), counted per step in a
lease-guarded CAS. A forced final answer near a ceiling, a hard stop at it,
abort on stop or lease loss. `checkCredits` checks the workspace balance only
before a run starts. There is no check before each model request; retries are
not counted separately; compaction/search/rerank/embedding usage is billed but
not counted toward ceilings. The ceilings are per run (one turn); nothing limits
a whole thread.

**Decision (2026-10-20): spend is the real limit.** Code-session turns can be
long, with many tool calls and repeated compaction. Step, tool-call and token
ceilings measure activity, not cost, and would cut real work short (near 1M
tokens of context, the 10M input ceiling trips after about 80 steps).

- Drop the step, tool-call, input-token and output-token ceilings for Pi runs.
- Keep the Stop button, abort on lease loss, and the per-call output limit on
  Lor host tools (it protects the context, not money).
- Keep the wall clock only as a high backstop for a stuck run.
- Money (target; **not part of phase 1**, built with the billing work in
  [pricing-and-billing.md](pricing-and-billing.md#9-stripe-autumn-and-the-current-implementation)):
  the workspace balance is the limit. Auto top-up refills it when it falls below
  a threshold; a run stops gracefully (save the turn, keep partial output,
  `out_of_credits`) only when the balance is exhausted and cannot be refilled.
  An admin-set monthly dollar cap on top-ups is the guard against a runaway
  loop. Check the live balance during the run, not only before it starts;
  parallel sessions share one balance. In-flight requests may overshoot slightly.
- Interim while billing is off in prod: keep `AGENT_RUN_MAX_CREDITS` as an
  operator-only emergency backstop, raised well above a normal long turn. It is
  the only spend limit while there is no balance.

Pi mapping:

- Read per-step usage from harness `finish-step` parts (P maps Pi assistant
  `message_end` usage). Update run counters and the usage ledger per step, as
  today, even though native state saves per turn.
- Near the deadline or the spend limit, block further tool calls in the
  `tool_call` extension hook (it fails closed) so the model answers. At the
  limit, abort.
- Count built-in tool output from tool result events.
- Count automatic compaction usage (already in Pi's turn total).
- Cache warming stays at Pi's default (§4.9). If it ever sends requests, count
  their `cache_warm` usage.
- A strict check before every model request stays deferred, as today.

### 4.6 File/shell tools and tool names

**Observed:** P exposes seven built-ins: `read`, `write`, `edit`, `bash`, `grep`,
`find` (as `glob`) and `ls`. Only `read` uses Pi's own tool definition; the
others are adapter wrappers. All route through `SandboxSession`.

**Decision:** use the adapter's tools. Lor implements a thin Blaxel
`SandboxSession` bridge, not new tools. No fallback to worker-local operations.

**Permissions (decision 2026-10-20):** agent-profile tool access has two built-in
groups today, `web` and `artifacts` (`BUILTIN_TOOL_GROUPS` in
`profile-tool-access.ts`). Add a **Computer** group holding `bash`, `read`,
`write`, `edit`, `grep`, `find` and `ls`, on by default. Each tool is also an
approval-policy target (`tool:<name>`), off by default like every gate. When a
profile turns the group off, the tools stay in the session's fixed list (§4.3)
and are refused when called.

**Tool-name collisions:** Lor's brain tools are literally `ls`, `read`, `tree`,
`write`, `edit`, `mkdir`, `move`, `link` and `search` (`brain.ts`). `ls`, `read`,
`write` and `edit` collide with Pi built-ins. Rename the brain tools (e.g.
`memory_read`) and update every dependent:

- `SIDE_EFFECT_TOOLS` idempotency keys (`tool-guard.ts`)
- the reserved-name list (`custom-tools.ts`); add `bash`, `grep`, `find`, `glob`,
  which workspace custom tools can use today
- web and mobile tool trails (`TARGET_TOOLS` in `lor-tool-trail.tsx`)
- prompt text, e.g. the `search` description that says "call read"
- approval-gate targets and the eval harness

Canonical approval/grant identity must survive the rename.

### 4.7 Steering and stop

**Lor today:** realtime always passes `threadScope: true`, so session runs queue
triggering messages (one run per message, sender re-authorized at dequeue).
**Ambient** messages (people talking to each other in the session) are injected
as context only at each step boundary and recorded in `coveredMessageIds`.
Stop aborts the in-flight request through Redis pub/sub and keeps partial text.

**Observed:** the harness exposes text-only `experimental_steerTurn`, which calls
Pi `steer`. Pi follow-up messages are not exposed. Abort, `stop`,
`suspendTurn` and `destroy` exist.

**Decision:** keep the queue model. Map ambient messages through the `context`
hook (appended at the end) rather than `steer`, and record coverage at the turn
save. Map stop to abort plus a stop save (§4.3).

### 4.8 System prompt and prompt cache

**Observed:** Pi's default prompt (C `buildSystemPromptSections`) opens with "You
are an expert coding assistant operating inside pi, a coding agent harness",
then lists tools and rules, then a Pi-docs section with the worker's Pi doc
paths, then the working directory. The adapter only appends Lor's session
instructions after it (`appendSystemPromptOverride`). A `before_agent_start`
extension result may set `systemPrompt`, which replaces the complete system
prompt for that turn; the event carries the rendered prompt and
`systemPromptOptions`. Neither Lor model accepts system messages
mid-conversation, so a changed system prompt rewrites the start of the prompt.

**Decision (2026-10-20): Lor's own prompt.** A trusted `before_agent_start`
extension replaces the system prompt with Lor's prompt (today's base prompt,
connector lines, LOR.md, plan rules and trigger/Loop/voice sections) plus Pi's
tool list and tool rules. Drop Pi's preamble, Pi-docs section and context-file
section. Lor is a team workspace agent, not only a coding assistant.

**Cache rules:** build the prompt from per-session inputs only, so it is
byte-identical across turns until LOR.md, connectors or rules actually change.
Put volatile state (plan state, delta, elapsed time, ambient messages) at the
end of the turn's user message or through the `context` hook at the end of the
context. The stable tool list (§4.3) keeps the tool section stable. Set
`x-session-affinity` (§4.5).

### 4.9 Adapter defaults Lor must override (G7)

Each item is verified in P/C source unless marked.

| Default | Risk | Required handling |
|---|---|---|
| Host-tool name set change rebuilds the session with an empty journal | Silent loss of conversation | Stable tool list per session (§4.3) |
| Missing restored journal creates a fresh session | Silent loss of conversation | Postgres restore + load check (§4.3) |
| Without an `auth` record, Pi reads every `*_API_KEY`, `*_BASE_URL` and `VERCEL_OIDC_TOKEN` in the worker env and `~/.pi/agent/auth.json` | Worker credentials reach the runtime | Always pass an explicit request-scoped `auth` record |
| Context files: `noContextFiles` is not set, so AGENTS.md/CLAUDE.md are read from the working directory upward | Host files above the workspace mount reach the prompt | Disable for phase 1; repository instruction files are never workspace instructions (`agent-harness.md`) |
| No settings record: P uses `SettingsManager.inMemory()`; passing `agentDir` loads global settings **and** `<workspace>/.pi/settings.json` | A settings folder would let the model change Pi's settings by writing a workspace file | Phase 1 changes no settings, so never pass `agentDir`. If a setting must change later: `pnpm patch` the adapter to pass a settings record (`SettingsManager.inMemory(settings)` already accepts one) and send the same change upstream |
| `cacheWarming: "streaming"` default | Background requests (1-token replays near the cache expiry) | Keep the default. Evaluated 2026-10-20: C `CacheWarmer` warms only when the model has a cache lifetime (`promptCache`) and the expected saving is at least $0.05, and stops when the run settles. No Gateway model in pi-ai 1.3.0 has `promptCache`, so it stays inactive for Lor's models. Count `cache_warm` usage if it ever appears |
| Pi's system prompt opens as a coding assistant and lists the worker's Pi doc paths | Wrong role for team chat; worker paths in every prompt | Replace it with Lor's prompt through `before_agent_start` (§4.8) |
| Text starting with `/skill:` or `/` expands skills or extension commands | Team members trigger runtime commands by accident | Escape a leading `/` in user and ambient text; Lor editor slash actions stay separate |
| The journal lives in the sandbox HOME | Model can tamper with history | Save from the worker copy, restore from Postgres, load check, and `deniedRoots` for the file tools (§4.3) |
| The adapter patches `node:fs` for the whole process; mount paths include the session ID | Collisions with a fixed `workDir`; unknown behavior on Bun | Never set a fixed `workDir`; verify the patch on Bun (Node only if Bun fails) |
| MCP results over 20 KB spill to the host temp dir | Worker disk exposure | Do not register MCP servers with the adapter; keep Lor's connector wrappers |
| Mirror sync and the skills check repeat every turn (P), plus startup round trips | Added latency per turn | Measure; keep the mirror small |

Also: trusted inline extensions run in the worker. Do not load user or
repository extensions. Inspect real path/symlink handling and stale process
termination in the Blaxel bridge.

### 4.10 Every agent run gets a sandbox (G6)

**Agreed 2026-10-19, extended 2026-10-20:** every agent run gets its session
sandbox: chat, cowork and code sessions, and voice, Loop and Act runs. Provision
on the session's first agent run; reuse it across turns, worker attempts and
approval continuations. Empty session creation or history viewing does not start
a run.

**Lor today:** plain chat never gets a sandbox. `investigate_code` uses a throwaway
`inv-{uuid}`; `create_artifacts` keeps `wbs-{threadRootId}` for 24 h idle;
`propose_code_change` keeps `code-{scope}` for 7 days idle. Unhealthy or
undersized sandboxes are deleted and recreated with only a log warning
(`blaxel.ts`). Code checkouts run `reset --hard && clean -fd`; the workbench
resets `/workspace/out`. The sandbox Pi receives `AI_GATEWAY_API_KEY` in its
environment. A Blaxel quota error fails one tool (`SANDBOX_QUOTA_REASON`).

**Blaxel facts (docs, 2026-10-20):** standby after ~5–15 s idle, resume in under
25 ms with processes kept; standby charges for snapshot/volume storage, not CPU
or memory. **Standby sandboxes count against quota:** 10 (Tier 0), 50 (Tier 1),
200 (Tier 2), higher tiers more. Tier 0 caps sandbox life at 7 days; Tier 1
deletes after a hard 30 days regardless of activity; Tier 2+ has no cap.
`ttl-idle` counts only resume/suspend as activity. Deleted sandboxes cannot be
recovered; the sandbox filesystem is lost on deletion or crash. Cold create time
is not published.

**Decisions:**

- Workspace owner: each run binds to a session workspace before it provisions.
  Voice runs have no `agent_session` today; they are scoped to the call's voice
  session (`scopeKey = request.sessionId` in `voice-request.ts`). Decision
  (2026-10-20): one sandbox per call, created on the first Lor run in that call.
  Joining a call never creates one. Revisit when voice channels launch; they may
  ship after the first release. Loop runs create a session per run
  (`loop-session.ts`); Act runs adopt a provisional session (`trigger-session.ts`).
- Lost workspace (interim until phase 2): continue in a new empty sandbox and
  tell the model and the session that earlier files are gone. Never recreate a
  sandbox silently, as `blaxel.ts` does today. Fail only for missing conversation
  state. Phase 2 checkpoints rebuild the sandbox from the last completed turn.
- Capacity (decision 2026-10-20): build as if sandboxes are unlimited. No idle
  TTL or reclamation for session sandboxes in phase 1. A quota error fails the
  run with a visible capacity state; it never falls back to worker-local tools.
- Latency: measure first-run provisioning and per-turn setup, especially for
  voice's live 10-minute interaction.
- At safe turn/approval boundaries, save native state and settle active work
  before releasing connections so Blaxel can enter standby.
- The Pi loop runs in the worker, so the session sandbox does not need the
  Gateway key. Keep it out of session sandboxes; the existing coding child
  (`investigate_code`, workbench Pi) keeps its current behavior until replaced.
- Deferred: zero-VM plain chat, virtual-to-remote promotion and allocation cost
  optimization.

## 5. Gates

Use this order **per gap**, not a blanket rewrite:

| Option | Appropriate use | Limit |
|---|---|---|
| Adapter configuration and harness APIs | Auth, tools, skills, approvals, lifecycle envelopes, UI stream | Preferred wherever source supports the required semantics |
| Trusted inline Pi extension | `session_before_compact`, `context`, `tool_call`, `before_provider_request`, load checks | Most handler errors are swallowed; `tool_call` fails closed |
| Thin Lor bridge/decorator | Blaxel operations, scoped host tools, policy/accounting, Postgres save/restore, projections | Reuse provider algorithms |
| Focused upstream adapter/Pi change | Keep history when the tool list changes; fail instead of a fresh start on a missing journal; a settings record if needed; later a session store | A candidate patch is not a shipped feature |
| Direct Pi SDK inside the same session boundary | A remaining blocker that is costly or impossible above | Record the blocker and the maintenance cost |
| Custom compactor, tool replay or inference transport | Only a separately evidenced unmet requirement | Not default work |

Do not route image turns to one runtime and text turns to another inside a
session. Native authentication, resume payloads and capability limits can differ
per adapter; record unsupported behavior honestly.

| Gate | Status | Acceptance evidence |
|---|---|---|
| G0 Runtime | **Closed 2026-10-20**: `HarnessAgent` + `harness-pi` | §3 |
| G1 Images | Supported in 1.0.159; mapping open | Text-first prompt with labeled images; inline bytes; resume carries them; model compatibility checked |
| G2 Native state | Per-turn save decided; implementation open | Postgres save at every save point; restore + load check; stable tool list; crash re-runs the turn |
| G3 Approvals | Harness protocol reused; Lor mapping open | Gates and `request_approval` mapped; pending set; exact decisions; no unapproved or duplicate execution after resume |
| G4 Compaction | Pi's default trigger + Lor instructions decided; overflow check open | Lor instructions via `session_before_compact`; plan state re-injected; overflow recovery works on a K3 fallback; entry and usage saved |
| G5 Gateway/budgets/retries | Spend-only limits decided; mapping open | Routing on normal and summary requests; per-step counters; tool block near the deadline or spend limit; abort at the limit |
| G6 Sandbox lifecycle | Every run, unlimited capacity and one sandbox per call decided | Owner per run kind; lost-workspace notice; quota failure visible; no silent recreation |
| G7 Isolation/runtime | Override list recorded (§4.9); Bun, the `ai` upgrade and legacy deletion decided | Every row in §4.9 handled; adapter works on Bun; remaining AI SDK callers work after the `ai` upgrade |

For each open gate record: source behavior, chosen seam or focused change,
remaining limitation, and why the alternative costs more. No upstream PR,
dependency patch or application code is part of this documentation task.

## 6. Internal architecture and durable contract

Keep the implementation within `packages/lor` initially, with a small internal
`session-core/` boundary. Do not create or publish a new package.

| Internal layer | Owns | Must not depend on |
|---|---|---|
| Session core | Runtime binding/version, lifecycle orchestration, saved head, native state references, typed activity, cancel/steer/resume interfaces | Lor DB schema, channel roles, brain implementation, Loop policy, UI components or global credentials |
| Runtime integration | `HarnessAgent`/Pi configuration, inline extensions, native-state conversion | Product authorization decisions or rendering |
| Injected ports | Native-state store, ownership gate, sandbox operations, usage sink, approval decisions, resources and scoped tools | Arbitrary third-party plugins |
| Lor integration | Postgres transactions, queue/lease ownership, context/memory/tools, approval authority, budgets, billing, current UI mapping | A second model/tool loop |

The core may use Vercel's public types. Keep native payloads versioned and
capabilities explicit, so the Claude Code and Codex adapters fit the same core
in phase 2.

### Data to retain

Extend existing session/run records and add only data that cannot fit safely:

- Sticky runtime binding and exact adapter/native-format versions; product owner,
  workspace reference, original input/turn identity and frozen run config.
  Approval successors keep logical turn identity; worker attempts stay separate.
- Native header, entries/IDs/ancestry, active leaf and compaction state, plus the
  **complete harness continuation state**: pending approvals/results/batches,
  frozen turn settings and completed result receipts. Visible messages or a
  sandbox filename never replace them.
- The saved head per session, expected parent head, input/steering coverage,
  cumulative counters and per-claim writer generation. Native entry sequence is
  not `agent_run.steps`. Deduplicate semantic tool calls by original call
  identity and source provenance.
- Common durable activity, projected from native entries: messages, tools and
  results, file-change metadata, approvals, usage and terminal states.
  `agent_run_event` (pruned 7 days after a run ends) cannot be its only source.
- Retained instruction/resource/context content and artifact references.
  Credentials are resolved afresh. Keep private history out of code exports.
- Native entries carry prompt images as base64 (§4.1). Stage large payloads
  first, or reference stored attachments where the format allows.

Do not store a separate full AI SDK transcript beside each Pi journal. Store
native entries incrementally at each save. Legacy `agent_run_step` rows stay in
place, but nothing writes or reads them after the legacy engine is deleted.
Write-back reads a bounded projection of the Pi activity.

At a save point, atomically commit native entries, continuation state, receipts,
activity, coverage/counters and the new head under expected-parent and
claim-generation checks. Failure stops progress; a lost lease cannot advance the
head. Before a replacement writer uses the same workspace, stop old remote
processes; if termination cannot be established, block workspace recovery.

Receipts reduce replay but cannot make arbitrary API mutations exactly-once.
Today's receipt key is `hash(tool name + input)` per run, so two intended
identical calls merge, and custom/MCP tools have no protection on replay.
Reconcile unknown outcomes with provider IDs or idempotency keys where they
exist. Imported historical results never execute or bill again.

### Required lifecycle behavior

1. Enqueue with a sticky runtime selection; claim with a generation. Existing
   session/thread, voice and Act/Loop scope rules remain authoritative.
2. Load the saved native state and continuation state from Postgres. Reject
   missing, incompatible or corrupt state explicitly. Bind current credentials,
   permissions and scoped services. Provision the session sandbox on its first
   run or reconnect to it; on a lost workspace, continue in a new one with a
   notice (§4.10). Restore the journal into the sandbox and run the load check.
3. Run the turn with the session's stable tool list. Record usage and counters
   per step; block tools near ceilings; abort at ceilings, stop or lease loss.
4. On approval suspension, save (§4.3) and release the worker and sandbox
   connections. No lease is held while waiting for a user.
5. Let Pi compact and retry within Lor's limits. Compaction runs through Lor's
   `session_before_compact` handler.
6. At the end of the turn, save, then publish the completed turn and final Lor
   message. Preserve the worker answer/write-back phase so recovery does not
   regenerate a finished answer or duplicate memory effects.

A crashed attempt loses its in-flight turn; the retry re-runs it from the last
saved head (§4.3). Do not label approval pauses or failed/budget-stopped turns
as completed turns.

## 7. Repository implementation map

| Current code | Preserve / change |
|---|---|
| `packages/lor/src/index.ts`, `run.ts`, `initial-message.ts` | Keep scoped setup, context building and UI callbacks. Replace the `streamText` loop (`prepareStep`, `stopWhen`, post-loop sweep) with the Pi adapter and delete it. Build Lor's system prompt for `before_agent_start` (§4.8) and the turn prompt text-first with labeled images. |
| `packages/lor/src/images.ts` | Keep limits and conversion; fetch and inline images for Pi prompts. |
| `packages/lor/src/brain.ts`, `compaction.ts`, `plans.ts` | Keep brain, retrieval, write-back and plan state. Rename brain tools (§4.6). Compaction goes through `session_before_compact`; delete `compaction.ts`. |
| `packages/db/src/schemas/profile-tool-access.ts`, `packages/connectors/src/tools.ts`, approval target vocabulary in `@repo/connectors` | Add the Computer built-in group and approval targets for Pi's built-in tools (§4.6). |
| `packages/lor/src/eval/long/` | Move the long-task eval to the Pi path so Jacob can run it before the switch. |
| `packages/lor/src/models.ts`, `usage.ts` | Keep model/routing and credit semantics; add gateway options through the payload hook and the summary stream function. |
| `packages/lor/src/tool-guard.ts`, `approval-policy.ts`, `custom-tools.ts` | Keep grants, targets, output limits and execution context. Map gates to harness approvals. Update `SIDE_EFFECT_TOOLS` and the reserved-name list for the rename. |
| `apps/worker/src/lib/agent-run.ts`, `run-continuation.ts` | Native dispatch, generation fencing, per-step counters, per-turn saves and fresh-process restore. Delete the legacy transcript replay (`replayChain`, continuation deltas). Today's continuation silently falls back to fresh context on error; the Pi path fails visibly instead. Re-point the context meter (`GET /v1/runs/context/{scopeKey}`) to Pi usage. |
| Worker `jobs/lor-respond.ts`, `voice-request.ts`, `lib/run-queue.ts`, `loop-session.ts`, `trigger-session.ts`, `voice-continuation.ts`, `voice-approvals.ts` | Keep queued successors, stop, approval resumes, voice limits and answer/write-back phases. Bind each run kind to a session workspace. |
| Realtime `services/lor.ts`, `index.ts`; API `lib/scope-runs.ts`, `lib/act-runs.ts`; Lor `act-runs.ts`, `agent-sessions.ts` | Audit every run producer; bind provisional Act runs to their session before native state is created. |
| API `routes/v1/approvals/handlers.ts`, `packages/db/src/schemas/approvals.ts` | Keep resolver checks, plan/voice rules and resolution idempotency; present a pending set and drop the one-per-run index. |
| `packages/db/src/schemas/agent-sessions.ts`, `agent-runs.ts` | Add minimum native/continuation/receipt/activity storage and runtime references. |
| `packages/lor/src/sandbox/{blaxel,workbench,code-session,investigate,pi-config}.ts`, `code.ts`, `artifacts/tool.ts`, `code-actions.ts` | Thin Blaxel `SandboxSession` bridge, session sandbox for every run, lost-workspace notice, quota handling, process fencing; reuse artifact/Git helpers. Replace silent unhealthy-sandbox recreation and the output-directory reset. |
| Web/mobile `lor-tool-trail.tsx`, shared session/realtime types | Keep events, approvals, tool details and files; update `TARGET_TOOLS` for renamed tools. |

Keep the existing connector/MCP wrappers; do not register MCP servers with the
adapter. Remove obligatory child coding/artifact dispatch only after the primary
runtime has equivalent capability.

## 8. Implementation slices — all within phase 1

There is no enrollment flag: the legacy engine is deleted once the Pi path
works (decision 2026-10-20; no one uses the app yet).

### 1.1 — Close the remaining contract questions

- [x] G0 runtime decided (2026-10-20): `HarnessAgent` + `harness-pi`.
- [ ] Pin exact versions (`harness-pi` 1.0.159, `harness` 1.0.157, Pi 1.3.0 or
  newer after recheck). Verify the adapter on Bun (decided: Bun first).
- [ ] Upgrade `ai` repo-wide (7.0.11 → the harness's version, ≥ 7.0.145) and
  fix the remaining AI SDK callers where needed.
- [ ] Confirm which journal copy is complete and readable at each save point,
  and how the load check reads the loaded session (§4.3).
- [ ] Confirm that the gateway's error for a K3 fallback above 1M tokens matches
  pi-ai `isContextOverflow`, so Pi's overflow recovery compacts and retries (§4.4).
- [ ] Map `request_approval`, partial batches, revocation and host-tool context
  rebinding (§4.2).
- [x] Budget limits decided (2026-10-20): spend only, no step/tool/token ceilings (§4.5).
- [x] Product decisions (2026-10-20): Lor's own system prompt, the Computer tool
  group, legacy deletion, `eval:long` before the switch, skills deferred.
- [ ] Define the internal core/ports and versioned lifecycle contract.

Exit: every gate in §5 has a recorded seam; the focused upstream changes are
listed; no claim that unmodified stock APIs meet Lor's guarantees.

### 1.2 — Add native state and explicit dispatch

- [ ] Add only the schema and references from §6.
- [ ] Implement expected-head/claim-generation saves, source deduplication,
  native/continuation storage and operation/accounting identity.
- [ ] Record the runtime kind and version per session (Pi now; Claude Code and
  Codex in phase 2). Missing native data fails explicitly.

Exit: storage review covers owner isolation, atomic save, retained payloads and
version rejection. No destructive history rewrite.

### 1.3 — Integrate the adapter and Lor services

- [ ] Replace the `streamText` loop in `respond` with the Pi adapter; keep
  context building and scoped tools.
- [ ] Build Lor's system prompt for `before_agent_start` (§4.8).
- [ ] Wire the stable tool list, renamed brain tools, exact execute context,
  output limits, images, Gateway options and current event consumers.
- [ ] Add the Computer tool group and approval targets for Pi's built-in tools (§4.6).
- [ ] Apply every override in §4.9.
- [ ] Reuse harness approval/continuation APIs with Lor policy and durable decisions.
- [ ] Add the compaction handler, per-step counters, tool block near ceilings,
  ambient context, steering and stop.

Exit: source review follows every request, tool and summary through permission,
accounting and save points, including cold approval resume and a crashed turn.

### 1.4 — Attach session sandboxes and scoped resources

- [ ] Implement the thin Blaxel bridge; provision on a session's first run and
  reconnect later, for every run kind.
- [ ] Keep workspace identity, artifacts, checkout/publish policy and process
  fencing. Add the lost-workspace notice and the visible quota failure.
- [ ] Replace mandatory child dispatch only after primary capability coverage.

Skills and slash commands are out of phase 1 (moved to the self-configuration
work). User text that starts with `/` is still escaped (§4.9).

Exit: every agent run has its session sandbox, with reuse, standby and explicit
lost-workspace handling. Tools cannot reach worker files or bypass Lor policy.

### 1.5 — Wire producers and durable activity

- [ ] Audit every production `agentRun` insert and `respond` caller: realtime
  messages, API scope runs (approvals, proposals, plan continuations), worker
  queue drains, Loops, Act, voice and `packages/lor` `act-runs.ts`.
- [ ] Project completed semantic history from saved native entries with stable
  origin IDs; token deltas stay transient.
- [ ] Preserve web/mobile tool, memory, plan, approval and message behavior.

Exit: every run producer uses the Pi path, and completed history does not
disappear when transient stream rows expire.

### 1.6 — Delete the legacy engine, check quality and document

- [ ] Delete the legacy engine: the `streamText` loop, `compaction.ts`, legacy
  continuation replay and their callers. Legacy tables keep their rows; nothing
  writes or reads them. Old sessions start from their visible history on their
  first Pi run. Passing a full messages array to `HarnessAgent` does not import
  history, so no import path is built.
- [ ] Move `packages/lor/src/eval/long/` to the Pi path. Jacob runs `eval:long`
  and reviews the results before the switch.
- [ ] Update as-built docs (`agent-harness.md`, `context-continuation.md`,
  `approval-policies.md`, `artifacts.md`) and tick phase-1 items individually.

Exit: one engine. The Pi path keeps Lor's controls, per-turn native recovery and
activity; workspace limits stay explicit until Git checkpoints ship.

## 9. Verification, rollout and record

No tests, ad hoc test scripts, browser test harnesses or `pnpm run validate`,
per repository policy. One exception (decision 2026-10-20): Jacob runs
`eval:long` on the Pi path before the switch. This revision is source and
documentation review, not runtime proof. For implementation use focused
code/SQL review, lint, type checking and builds that do not execute tests.

Trace these paths in review: images; multiple approvals; a crash mid-turn; a
lost workspace; tool-list stability across grant changes; compaction trigger and
usage; stop and lease loss; stale workspace processes; ambient messages; event
expiry; every run producer; cold restore with no local native files.

Deploy the additive schema, then workers/API/realtime together. There is no
enrollment flag; on a regression, fix forward or revert the deploy. `db:push` is
a mutation, not validation; Jacob reviews the schema diff and runs it.

Observe internal use for stuck runs/approvals, missing usage, save failures,
lost-workspace notices and quota failures. Preserve native data and a compatible
reader/build. No automatic fallback to fresh history.

| Record | Status |
|---|---|
| Adapter, Pi Durable, cross-harness and repository review | Completed by source/documentation review, 2026-10-19/20. |
| G0 runtime | Closed 2026-10-20: `HarnessAgent` + `harness-pi`. |
| Per-turn saves, spend-only run limits, sandboxes for every run kind, interim lost-workspace behavior, unlimited capacity, Bun, `ai` upgrade, Lor's own system prompt, Computer tool group, legacy deletion, `eval:long` before the switch, skills deferred | Decided with Jacob 2026-10-20. |
| Gates G1–G7 | Findings and seams recorded; implementation not validated. |
| Implementation slices 1.1–1.6 | Not started. |
| Upstream changes / SDK publication | None submitted. Candidates for `@ai-sdk/harness-pi` PRs: keep history when the host-tool list changes (`rebuildPiSession`); fail instead of a silent fresh start on a missing journal; a settings record if a setting must change; later a session store. |

## Sources

- AI SDK harness: [Pi adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi),
  [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent),
  [adapter capabilities](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters).
- AI Gateway: [Anthropic Messages API](https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api),
  [provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options),
  [automatic caching](https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching).
- Blaxel: [lifecycle](https://blaxel.ai/blog/understand-the-lifecycle-of-a-blaxel-sandbox),
  [quotas](https://docs.blaxel.ai/Security/Quotas),
  [expiration](https://docs.blaxel.ai/Sandboxes/Expiration).
- Alternatives: [Pi Durable post](https://earendil.com/posts/pi-durable/),
  [Vercel agent harnesses (`durable-harness`)](https://vercel.com/docs/agent-harnesses).
- Package archives reviewed:
  [harness-pi 1.0.159](https://registry.npmjs.org/@ai-sdk/harness-pi/-/harness-pi-1.0.159.tgz),
  [harness 1.0.157](https://registry.npmjs.org/@ai-sdk/harness/-/harness-1.0.157.tgz),
  [pi-coding-agent 1.3.0](https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.3.0.tgz),
  [pi-ai 1.3.0](https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-1.3.0.tgz),
  [pi-durable 1.3.0](https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.3.0.tgz).
