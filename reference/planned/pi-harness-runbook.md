# Pi foundation migration runbook — phase 1

> Status: revised 2026-10-20 after a source review of the exact published
> packages, the repository and vendor docs. **Documentation only;
> implementation not started.** Implements phase 1 of
> [Shared harness sessions](harness-sessions.md). Repository baseline: `dev`
> at `7d663fdf`; branch: `pi-harness-sessions`.
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
| Compaction (G4) | Keep Pi's default trigger and algorithm. Add Lor's instructions (copy IDs, citations, URLs and file paths exactly) through `session_before_compact`. Register DeepSeek's window as 1,000,000, the smallest in the fallback chain, through the adapter's `providers` option (not a Pi setting), so a fallback to Kimi K3 never overflows (§4.4). Revisit the trigger only if real use shows a cost or quality problem. |
| Pi settings | None in phase 1: compaction, retries and cache warming keep Pi's defaults. If a setting must change later, patch the adapter with `pnpm patch` to pass a settings record and send the same change upstream as a PR. |
| Sandboxes (G6) | Every agent run gets its session sandbox, **including voice, Loop and Act runs**. Each needs a session workspace owner before it provisions. |
| Lost workspace (G6) | **Interim until phase 2.** If a session's sandbox no longer exists (crash or deletion), continue the session in a new empty sandbox and tell the model and the people in the session that earlier files are gone. Fail the run only when the native **conversation** state is missing or corrupt. Phase 2 Git checkpoints replace this: Lor rebuilds the sandbox from the last completed-turn commit. |
| Capacity | Changed 2026-10-21 after Tier 1's 40 GB ephemeral-volume quota allowed only 5 session sandboxes: session sandboxes get a 2 GB `/workspace` (`LOR_SESSION_DISK_MB`; code tools keep 8 GB), Blaxel deletes them after 7 days idle (`LOR_SESSION_SANDBOX_TTL`), and archiving a session deletes its sandbox after a 10-minute undo window (loop sessions excepted). Until phase 2 checkpoints, unshared sandbox files are lost then; the conversation and shared files are not. A quota error still fails the run visibly. |
| Worker runtime | Run the Pi path on **Bun**, the worker's current runtime. Verify the adapter on Bun in 1.1; move the Pi path to Node only if a concrete Bun failure appears. |
| AI SDK | Upgrade `ai` repo-wide to the version the harness requires (≥ `7.0.145`). Change the remaining AI SDK callers (write-back, placement, titles, classifiers, embeddings, rerank) where the upgrade needs it. |
| Legacy engine | **Delete it** (2026-10-20). No one uses the app yet, so there is no flag, rollout, drain or import. Old sessions have no native state; their first Pi run starts from the visible session history, like any first run. Legacy run tables keep their rows but receive no new writes; dropping them is a separate later decision. |
| System prompt | Lor's own prompt replaces Pi's "expert coding assistant" prompt, including Pi's tool guidance and dropping the Pi-docs section. Mechanism (§4.8): a small adapter patch passing Pi's `systemPromptOverride`, sent upstream; `before_agent_start` alone misses approval resumes. |
| Tool permissions | A new **Sandbox** built-in group in agent-profile tool access (workspace default, then category, then channel) holds Pi's `bash`, `read`, `write`, `edit`, `grep`, `find` and `ls`; on by default. When the group is off, the tools stay in the session's fixed list and are refused when called. `bash`, `write` and `edit` are **not** workspace approval targets: a **per-user sandbox permission mode** decides them, like Claude Code and Codex: **manual** (ask before every call), **auto** (a classifier asks only for potentially destructive calls), **bypass** (allow all). Read-only tools never ask (§4.6). |
| Approvals | `request_approval` pauses the turn like any gate and continues after the decision. Anyone in the session can approve sandbox asks. Steering while approvals are pending denies them and runs next; a queued message waits for the decision; Stop denies them and ends the turn (§4.2). |
| Sandbox mode details | The turn starter's mode applies; default **auto**; a per-session switch comes later with the code-channel composer. **Loop and Act runs are autonomous:** classifier only, higher tolerance, a flagged call is refused with "try a safer way" and never waits for a human. Voice uses the speaker's mode. The classifier is Jev through `experimental_decide` (§4.6). |
| Quality check | Jacob runs `eval:long` on the Pi path before the switch. The eval harness moves to the Pi path. A new **sandbox classifier eval** sets the safety thresholds and rules from evidence (§4.6). |
| Sandbox safety policy | Allow list, then rules, then the classifier for the middle. Interactive auto asks at probability ≥ 0.35; Loop/Act refuses at ≥ 0.70; rule hits ask or refuse; errors ask or refuse. Starting values, tuned with the classifier eval (§4.6). |
| Skills and slash commands | Out of phase 1; moved to the self-configuration work. |
| Versions | **Pinned 2026-10-20:** `@ai-sdk/harness-pi@1.0.160`, `@ai-sdk/harness@1.0.158`, `ai@7.0.147`, Pi `1.3.0` (direct dependency plus a root pnpm override). Exact versions; the harness ships breaking changes in patch releases. 1.0.159 → 1.0.160 only bumped `ai`. |

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
| `@ai-sdk/harness-pi` | `1.0.160`, pinned (first review on `1.0.158`) | 1.0.159 added prompt image input; 1.0.160 only bumped `ai`. Depends on `pi-coding-agent ^1.0.3`, so Lor pins 1.3.0 with a root pnpm override. |
| `@ai-sdk/harness` | `1.0.158`, pinned | Shared by the Pi, Claude Code (`1.0.161`) and Codex (`1.0.159`) adapters. Depends on exactly `ai@7.0.147`. Docs label it experimental; ~8 releases a week; breaking changes ship as patches (e.g. 1.0.92, 1.0.123). |
| `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` | `1.3.0`, pinned (first review on `1.0.3`) | pi-coding-agent pins the rest of the family exactly. Compaction, session manager and Gateway behavior below were rechecked on 1.3.0. No native modules (image work is WASM). |
| `@ai-sdk/provider-utils` | `5.0.64` | `SandboxSession` contract unchanged from 5.0.63. |
| Lor | `ai@7.0.147` (upgraded from 7.0.11 on 2026-10-20; type check and Biome pass); sandbox image Pi `0.84.1` | The worker **runs on Bun** (`oven/bun:1-slim`). Harness packages declare `node >=22`; Bun verdict in §4.9. |

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

**Observed (H 1.0.158, P 1.0.160; verified 2026-10-20):**

- **Host tools:** `toolApproval` is a static map from tool name to status, fixed
  when the agent is built. No callback; `prepareCall` cannot change it; a tool's
  `needsApproval` is ignored. `user-approval` creates a pending approval
  `{approvalId, toolCallId, toolName, input (raw JSON), kind: "custom"}`;
  `{type: "denied", reason}` denies at once.
- **Built-in tools:** only `permissionMode`: `allow-all` (default), `allow-edits`
  (asks for `bash`), `allow-reads` (asks for `write`, `edit` and `bash`). `read`,
  `grep`, `find` and `ls` can never ask. There is no per-tool choice. Hazard:
  P `requestBuiltinToolApproval` checks the mode before it looks up a delivered
  decision, so a looser mode at resume runs a rejected call.
- **Stream:** `tool-approval-request {approvalId, toolCall, isAutomatic?}`. Its
  shown input has work-directory paths removed; file approval rows from the raw
  `pendingToolApprovals[].input`.
- **Batches:** ungated host and built-in calls run at once; gated calls wait. The
  pause comes at the step end, so all gated calls of one step are pending
  together. Finished siblings' results live only in the continue-turn state
  (`completedToolResults`) until the batch completes; replay reuses them and
  zeroes replayed usage.
- **Pause and continue:** `suspendTurn()` returns `{type: "continue-turn", data,
  pendingToolApprovals, pendingToolResults, turnSettings}`. To continue:
  `createSession({sessionId, continueFrom, toolsContext, runtimeContext,
  sandboxSession})`, then `continueStream({session, toolApprovalContinuations:
  [{type: "tool-approval-response", approvalId, approved, reason?}]})`.
- **Partial decisions:** H handles only decided approvals. On a cold resume Pi
  waits until every pending call has a decision, with no signal.
- **Fresh process:** host tools are rebound from the new agent's tool
  definitions and `toolsContext`; a missing tool name throws. The approved host
  call runs with the saved raw input, re-checked against its schema. Built-in
  calls run with the journal's arguments. H has no signing.
- **Denial:** the model sees `{"type":"execution-denied","reason":"…"}`.
- **New prompt:** throws while a turn is unfinished (pending approvals).

**Lor today:** two kinds of approval. Policy gates return `user-approval` from
`approval-policy.ts`; the discretionary `request_approval` plan tool sets a flag
that forces a final text step. A run parks, the post-loop sweep makes the step
durable, `fileParkedApproval` inserts the row, and the run stops with
`awaiting_approval`. Partial unique indexes allow one pending approval per run
and per plan. Resolution starts a **successor run** that replays the chain and
ends with the `tool-approval-response`. Latent bug: `index.ts` overwrites
`parked` per request, so two gated calls in one step file only the last one.

**Decision:** keep the harness protocol; no Lor batch replayer and no manual
insertion of approval results.

- **Gates** on capabilities, custom tools and MCP tools: build the `toolApproval`
  map per run from `loadApprovalGates`, with one `HarnessAgent` per run over the
  session's stable tool list. Delete the AI SDK wiring (`buildToolApproval`,
  `experimental_toolApprovalSecret`).
- **Argument binding:** the continuation state round-trips through Lor's
  database, so an HMAC secret adds nothing. Store a sha256 of the raw input on
  the approval row; before resuming, compare it with the continue-turn input
  (host calls) and the restored journal's call arguments (built-in calls).
  Retire `LOR_TOOL_APPROVAL_SECRET`.
- **Pending set:** one approval row per `pendingToolApprovals` entry. Drop
  `approval_run_pending_uidx` and `approval_plan_pending_uidx`; add unique
  `(run_id, tool_call_id)`, `harness_approval_id` and `kind`. Cards group rows
  by run; push deduplicates per run and resolver. Resume only when the whole set
  is decided: the last resolution enqueues the resume through a CAS on the run.
  This also removes today's multi-gate bug.
- **Revocation:** before `continueStream`, the worker reloads gates, grants and
  the resolver's access, and turns a revoked approval into `approved: false`
  with a reason. Lor's execute wrapper and the `tool_call` hook check again.
- **Freeze the sandbox permission mode** (§4.6) with the turn's saved config,
  so a looser mode at resume cannot run a rejected built-in call.
- **Voice:** keep computing `canPark` at run start (a static `denied` when
  nobody in the call can approve); the existing watcher covers people leaving;
  `parkRun` handles a set.
- **Plans:** set `waiting_for_approval` at the suspension save, as today.
- **Tool-call IDs** must be non-empty: the Anthropic Messages path copies
  provider IDs, while the OpenAI Chat Completions path defaults missing IDs to
  `""` (A `openai-completions`), so do not configure Chat Completions.

**Decided with Jacob, 2026-10-20:**

- **Built-in tools:** only `bash`, `write` and `edit` can ever ask; `read`,
  `grep`, `find` and `ls` never ask. They are **not** workspace approval-policy
  targets. A per-user sandbox permission mode decides (§4.6). The adapter needs
  a per-call approval callback for built-in tools (patch + upstream PR, §4.6).
- **`request_approval`:** a host tool that always requires approval. The turn
  pauses like any gate and continues after the decision; the card shows the
  request, with no closing text before it.
- **Anyone in the session can approve** (decided 2026-10-20; channel write
  access is the floor). Workspace gates keep their configured resolvers.
- **Steering while approvals are pending** denies them, with a reason that points
  to the steering message; the turn finishes and that message runs next (Claude
  Code treats typing at a permission prompt as a "no"). A message that only
  queues waits until the pending set is decided, because the harness refuses a
  new prompt while a turn is unfinished. **Stop** denies all pending approvals
  and ends the turn.

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

1. **Save points and timing.** The adapter deletes the worker's journal inside
   `suspendTurn`, `stop` and `destroy`, so Lor reads it **before** those calls:
   - completed turn: after the harness stream ends (`done`), then `destroy()`.
     Lor passes its own `SandboxSession`, so `destroy` leaves the sandbox alone;
   - approval pause: when the turn pauses with pending approvals, then
     `suspendTurn()`; store the returned continue-turn state verbatim (it holds
     the finished siblings' results);
   - user or budget stop: abort through the abort signal, await `done`, then
     `destroy()`.
   Each save is one Postgres transaction: the new journal bytes, the
   continuation state, activity projection, counters, stop reason and the new
   head. Guard it with the lease generation and the expected previous head. A
   failed save fails the run; it never reports a completed turn.
2. **Reading the journal.** The adapter exposes no path or entries API (P has
   no `readHistory`). A trusted inline extension records
   `ctx.sessionManager.getSessionFile()` at `agent_start`. At the save point Lor
   reads the worker file's bytes, checks that the previously saved prefix is
   unchanged (length and sha256) and that the last entry's id equals
   `getLeafId()`, and saves the new bytes. Never read the sandbox copy: the
   model's `bash` can edit it.
3. **Restore.** Delete any stale `tmpdir()/ai-sdk-harness/pi/<id>` root. Write the
   saved bytes to `$HOME/.ai-sdk/harness-pi/<sha256(sessionId)>/<sessionFileName>`
   in the sandbox (skip the write when the sandbox copy's sha256 already
   matches; standby keeps it). Then `createSession({sessionId, sandboxSession,
   resumeFrom | continueFrom})` with `reattachInProcess: false`. After a
   completed turn Lor builds `resumeFrom` itself (`{type, harnessId: "pi",
   specificationVersion: "harness-v1", data: {sessionFileName}}`); after an
   approval pause it passes the stored continue-turn state. The adapter pulls
   the file once, in `doStart`. The path is adapter-internal: pin the version
   and recheck it on upgrade. Add `$HOME/.ai-sdk/harness-pi` to
   `fileToolPathPolicy.deniedRoots` so the file tools refuse it; `bash` is not
   restricted, and the restore overwrites any edit.
4. **Load check.** `session_start` never fires for Lor (the adapter binds
   extensions only when MCP servers are configured). `agent_start` fires on both
   the prompt and the replay path, before the first request. A trusted extension
   checks there that `getHeader().id` equals the saved Pi session id,
   `getEntries().length` is at least the saved count, and
   `entries[count-1].id` equals the saved head. It uses positions, not
   `getLeafId()`, because replay moves the leaf. Handler errors are swallowed, so
   on a mismatch the extension sets a Lor flag and calls `ctx.abort()`; after
   `done` Lor fails the run visibly and saves nothing. This catches every silent
   fresh start: a missing or 0-byte file, skipped malformed lines, and a session
   rebuilt after a tool-list change or `compact()`.
5. **Size.** Compaction appends and deletes nothing, replay leaves inactive
   branches, and images are stored inline, so the journal only grows. Resume
   reads the whole file. Watch the size; the later session-store option (item 8)
   removes this. **Two full transfers per turn** (found 2026-10-21; deferred
   with Jacob): the adapter copies the file back to the sandbox only on
   stop, detach or suspend, never on `destroy()`. So after every completed turn
   the sandbox copy is a turn behind; the next restore uploads the whole file,
   and `pullSessionFileFromSandbox` downloads it again. That is negligible for
   short sessions and costs seconds for long ones with images and big tool
   results. Appending each turn's new lines to the sandbox copy after the save
   would remove the upload. Removing both needs the session store (item 8) or
   a patch that lets the adapter open a worker-local file Lor writes.
6. **Tool lists may change between turns** (decided with Jacob 2026-10-21;
   this replaces "one stable host-tool list per session"). The empty-journal
   rebuild only happens inside one live adapter session: `rebuildPiSession`
   restores the saved file whenever `piSession` is null, and every Lor turn is
   a fresh session (`reattachInProcess: false`). The load check would catch a
   miss anyway. So each turn binds only the tools the run may use, and the
   model never sees tools it would be refused. Costs accepted: a turn whose
   list changed re-sends the whole prompt uncached. Keep the tool order
   deterministic so an unchanged list never busts the cache. On an approval
   resume whose tool is no longer bound, deny that approval with a reason
   (1.3e) instead of letting the adapter throw. Do not call harness
   `compact()` on a freshly resumed session.
7. Worker crash mid-turn: the turn's native progress is lost. BullMQ's second
   attempt re-runs the turn from the last saved head with the same input and a
   note that an earlier attempt was interrupted and may have changed files or
   external systems. Lor side-effect tools keep `agent_run_tool_result`
   receipts, so an identical repeated call returns the stored result; a
   different call is not deduplicated. Usage of the lost attempt is still
   counted (recorded per step, §4.5) and not re-billed. Clients get today's
   replace frame. Sandbox file changes from the lost attempt stay.
8. Later option, not phase 1: an upstream session-store option for the adapter
   (load entries from a store, awaited append per entry) would restore mid-turn
   recovery. `SessionManager.inMemory(entries)` makes it plausible.

### 4.4 Compaction (G4): Pi's algorithm, Lor's instructions and settings

**Observed (1.3.0):** C `shouldCompact` triggers when context tokens exceed
`contextWindow − reserveTokens`. Defaults: `reserveTokens` 16,384,
`keepRecentTokens` 20,000. For DeepSeek V4.1 Flash (1,048,576 window) that is
about **1.03M tokens** (984k with the window override below). Auto-compaction
passes no custom instructions.
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
  plan progress. Return `{ compaction }` (the `CompactionResult` with usage). The
  summary uses the session model (`ctx.model`), as Pi does by default. This keeps
  Pi's cut-point and iterative-summary algorithm; no upstream change and no
  second compactor. Verified signature: `compact(preparation, model, apiKey,
  headers, customInstructions, signal, thinkingLevel, streamFn, env, retry, …)`.
  Pass the retry policy explicitly (`{enabled: true, maxRetries: 3, baseDelayMs:
  2000}`, Pi's defaults); an undefined policy turns retry off. Pass a `streamFn`
  that wraps `ctx.modelRegistry.streamSimple` and adds the gateway options
  (§4.5), so summary requests are routed like normal ones.
- Re-inject current plan state after compaction through the `context` hook, at
  the end of the context (prompt cache, §4.8).
- **Window override (verified 2026-10-20).** Kimi K3's window is 1,000,000 and
  Moonshot counts input plus `max_tokens`, so with DeepSeek's catalog window
  (1,048,576) a fallback to K3 fails from about 967k input. Register Lor's
  gateway models through `createPi({ providers: { "vercel-ai-gateway": { models:
  [...] } } })` with DeepSeek's `contextWindow` set to 1,000,000, the smallest
  window in the chain (today's `LOR_CONTEXT_WINDOW` uses the same rule). This is
  an adapter option, not a Pi setting, and the gateway auth config is kept. Pi
  then compacts at 983,616, and `clampMaxTokensToContext` keeps input plus
  `max_tokens` under the window. The list replaces the provider's whole model
  list, so include every gateway model Lor uses, and always pass the model per
  turn. Do not use an extension's `registerProvider` for this: the resolver
  snapshot is taken before extensions load. Remaining risk: K3's tokenizer may
  count more than Pi's estimate (unverified).
- Overflow recovery stays a backup only. The gateway's overflow text is
  undocumented; Moonshot's "exceeded model token limit" matches
  `isContextOverflow`, but DeepInfra's "Requested input length … exceeds maximum
  input length" does not, and Pi's retry patterns can then retry the same
  failure 3 times.
- Accepted changes from today: compaction starts near 984k tokens instead of
  ~520k; Pi summarizes Lor's first context message once it falls outside the
  kept tail.
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
extension: `pi.on("before_provider_request", (event, ctx) => payload)`, where a
returned value replaces the payload. It runs for every agent-loop request,
including Pi's automatic retries and overflow recovery, and provider HTTP retries
reuse the changed body. A throw is logged and the request is sent unchanged
(fail-open). It does not cover compaction, so the summary stream function (§4.4)
adds the same options.

**Caching and session affinity (corrected 2026-10-20):** `caching: "auto"` adds
markers only for Anthropic, MiniMax and Alibaba; DeepSeek caches implicitly and
Moonshot is not listed. pi-ai sends `x-session-affinity` only for OpenRouter by
default, not for these Gateway models, and its value would be Pi's own session
id, not Lor's. Send `sessionId: <Lor session id>` in `providerOptions.gateway`
through the same hook, and set HarnessAgent `headers: { "x-session-id": <Lor
session id> }`, which also reaches compaction requests. Without a session id the
Gateway pins only the provider by fingerprint. Pi `cacheRetention` is not
Gateway caching.

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
`profile-tool-access.ts`). Add a **Sandbox** group holding `bash`, `read`,
`write`, `edit`, `grep`, `find` and `ls`, plus `share_file`, on by default. When
a profile turns the group off, the turn leaves them out: the adapter's
built-in tool filter drops Pi's tools and `share_file` is not bound
(2026-10-21, §4.3 item 6). Agent profiles already resolve per channel (channel, then category,
then workspace default), so Sandbox on/off works at each level.

**Sandbox permission mode (decision 2026-10-20).** `bash`, `write` and `edit`
are not workspace approval-policy targets. Each person chooses a mode in their
user settings (a per-user row, like `user_notification_settings`):

| Mode | `bash`, `write`, `edit` | Read-only tools |
|---|---|---|
| Manual | Ask before every call, except known-safe read-only commands (2026-10-21) | Never ask |
| Auto | Allow routine calls; flagged calls go to the classifier, which allows or asks (revised 2026-10-21) | Never ask |
| Bypass | Allow every call except the hard rules (2026-10-21) | Never ask |

- **Auto classifier:** a decision model, TypeSafe's Jev (`typesafe-ai/jev`
  through the Gateway), called with `experimental_decide` (available in
  `ai@7.0.147`; question types `boolean`, `choice`, `score`). The SDK posts to
  the Gateway's `/decision-model` endpoint and gets `{type: "boolean",
  probability}` back (verified in `@ai-sdk/gateway@4.0.120`); TypeSafe's own API
  calls this question type `noul`, and the Gateway maps it. A `refusal` answer
  counts as a classifier error. Usage is billed like other auxiliary calls.
  Gateway catalog flags for Jev (2026-09-30): no ZDR, no training. The policy
  that uses it is below.
- **Mechanism:** the adapter's static `permissionMode` cannot express a
  per-call decision. Patch the adapter (`pnpm patch`, then upstream) with a
  per-call built-in approval callback, `(call) => "allow" | "ask" | {deny,
  reason}`, that also checks a delivered decision before asking (this fixes the
  ordering hazard in §4.2). An "ask" becomes a normal pending approval (§4.2).
- **Freeze the mode with the turn**, so changing the setting mid-turn never runs a
  rejected call.
- **Bypass risk** is limited to the session's own sandbox: it has no credentials
  and cannot reach the worker, and Git publishing stays host-controlled. It can
  still delete session files and make network calls.

**Decided with Jacob, 2026-10-20:**

- **Whose mode applies:** the mode of the person whose message started the turn.
- **Who approves:** anyone in the session (sessions are multiplayer), with the
  usual floor of channel write access. Anyone can also interrupt by **steering**
  (§4.2); a message that only queues waits for the decision.
- **Loop and Act runs are autonomous** and never ask. Flagged calls go to the
  classifier, which allows or refuses (revised 2026-10-21: the autonomous bar
  is the same or stricter than the interactive one, never looser). A refused
  call returns a tool result telling the model the command was flagged as
  dangerous and to try a safer way, so the run continues without a human. A
  classifier error also refuses (fail closed). Workspace approval policies for
  connector, custom and MCP tools still apply to these runs as today.
- **Voice** uses the speaker's mode; only someone in the call can approve, as today.
- **Default mode** for new users: auto.
- **Per-session switch** (like Claude Code's mode toggle): later, with the
  code-channel composer. Phase 1 has the user setting only.

**Sandbox safety policy (revised with Jacob 2026-10-21; replaces the
2026-10-20 draft).** Based on how Claude Code, Codex, Cursor, Gemini CLI, VS
Code and others do it, and on the research evidence, both summarized with
sources in `reference/planned/sandbox-safety-research.md`. Containment carries
the most weight: the sandbox holds no Lor credentials, and egress limits come
next (1.3f-4). Rules decide the clear cases from a parsed command. The
classifier judges only flagged calls. People approve 93–97% of prompts, so
asking less often makes each ask count.

What can go wrong in a session sandbox (no Lor credentials, no worker access,
host-controlled Git): destroying the session's own work (unrecoverable until
phase 2); using credentials found in the workspace, such as a cloned repo's
`.env`; changing systems outside the sandbox (deploy, publish, writes to
external APIs, sending data out); abusing resources; turning a "read-only"
command into code execution through its flags or the repo's config.

**Decision per call** (`sandbox/sandbox-approval.ts`):

1. **Hard rules, deny in every mode (Bypass and autonomous included):**
   deletes of `/`, `~`, `/workspace`, the work folder or their parents; writes
   (tool or shell) to the adapter's state folder `~/.ai-sdk/`; other agent
   CLIs with their permission bypass flags (`--dangerously-skip-permissions`,
   `--yolo`, `--trust-all-tools`, `--dangerously-bypass-approvals-and-sandbox`);
   the metadata address `169.254.169.254` and link-local addresses; invisible
   or bidirectional Unicode in a command.
2. **Read-only tools** (`read`, `grep`, `glob`, `ls`): allow.
3. **`write` and `edit`:** resolve the path (symlinks, case). Inside the work
   folder or `/tmp` and not protected: routine. A protected path or anywhere
   else: flagged. Protected: `.git/` (hooks, config), `.env*` except templates,
   keys and credential files (`*.pem`, `id_*`, `.aws/`, `.ssh/`, `.npmrc`,
   `.pypirc`, `.netrc`, `.git-credentials`), shell rc files, CI workflows
   (`.github/workflows/`), agent instruction and config files (`AGENTS.md`,
   `CLAUDE.md`, `.pi/`, `.claude/`, `.cursor/`, `.vscode/`, `.mcp.json`).
4. **`bash`:** parse with tree-sitter-bash (web-tree-sitter).
   - **Known safe:** plain words and quoted strings joined by `&& || ; |`,
     every segment on the safe list: Codex's last list (`cat cd cut echo expr
     false grep head id ls nl paste pwd rev seq stat tail tr true uname uniq wc
     which whoami`; `find` without `-exec -execdir -ok -okdir -delete -fls
     -fprint -fprint0 -fprintf`; `rg` without `--pre --hostname-bin
     --search-zip -z`; `sed -n Np` / `-n M,Np` only; `base64` without `-o`).
     No git: repo config can make read-only git commands run code.
   - **Flagged:** walk every literal command, including those nested in
     `$( )`, backticks, subshells, control flow and `bash|sh|zsh -c`; unwrap
     `sudo`, `env`, `command`, `exec`, `nohup`, `nice`, `timeout`, `time`,
     `stdbuf`, `xargs` and `find -exec`; past depth 8, flag. Then flag:
     - unparseable input, over 10,000 characters, control characters;
     - constructs that hide what runs: a dynamic command name (`$cmd`),
       `eval`, `source` of a downloaded file, piping into a shell or
       interpreter (including `curl … | sh` and decode-then-run);
     - loss of work: `rm` with `-r` or `-f`, `git reset --hard`, `git clean
       -f*`, `git checkout -- .`, `git restore .`, `git stash drop|clear`,
       `git branch -D`;
     - leaving the sandbox: `git push`, `git remote add|set-url`, publishing
       (`npm|pnpm|yarn publish`, `cargo publish`, `twine upload`, `gem push`,
       `docker push`), deploy and infrastructure by subcommand (`terraform
       apply|destroy`, `kubectl apply|delete|exec|patch|scale`, `vercel`, `fly
       deploy`, `aws`/`gcloud` except describe/list/get, `gh pr merge|release|
       repo delete|api -X`, `stripe` writes), remote database clients,
       `ssh|scp|rsync|sftp|ftp`, `nc|ncat|socat`, `curl`/`wget` sending data
       (`-d`, `--data*`, `--json`, `-F`, `-T`, `-X` POST/PUT/PATCH/DELETE,
       `--post-*`, `--method`) until egress limits land;
     - persistence and config: `crontab`, `systemctl`, `git config` of keys
       that run code (`core.hooksPath`, `core.pager`, `core.fsmonitor`,
       `core.sshCommand`, `diff.external`, `*.textconv`, `filter.*`,
       `alias.*`), shell writes (`>`, `tee`, `cp`, `mv`, `sed -i`) to
       protected paths;
     - tunnels, listeners and scanners: `ngrok`, `cloudflared`, `ssh -R`, `nc
       -l`, `nmap`, `masscan`;
     - privilege and disk: `sudo`, `mount`, `dd`, `mkfs`, `shred`, `iptables`,
       `--privileged`, `docker.sock`; fork bombs.
   - **Routine:** anything else (`npm install`, `pytest`, builds, running a
     script the session wrote). The sandbox is the boundary for these.

| Call | Manual | Auto | Bypass | Loop / Act |
|---|---|---|---|---|
| Hard rule | Deny | Deny | Deny | Deny |
| Read-only tool, known-safe command | Allow | Allow | Allow | Allow |
| Routine | Ask | Allow | Allow | Allow |
| Flagged | Ask | Classifier: allow or ask (until 1.3f-3: ask) | Allow | Classifier: allow or refuse (until 1.3f-3: refuse) |

- **Ask card:** the call plus the reason: the rule that flagged it, and from
  1.3f-3 the classifier's reason. Anyone in the session can approve.
- **Refusal in Loop/Act:** the tool result reads: "This command was blocked as
  potentially dangerous: <reason>. Don't retry it or a variant. Find a safer
  way, or finish and report what you couldn't do."
- **Loop guard** (Claude Code's breaker): after 3 refusals in a row or 20 in a
  turn, the refusal tells the model to stop and finish now; the run's final
  message lists the refused calls, so the team sees what Lor skipped.
- **No separate decision table** (dropped 2026-10-21). `harness_log` keeps
  every call with its full input, and the rules are deterministic, so the
  check and outcome are recomputed from it with the current rules. A
  person's approve or reject is the `sandbox` approval row with the same
  tool call ID. Add a table only for classifier answers, which cannot be
  recomputed, and only for the calls the classifier saw.

**Classifier (1.3f-3), revised 2026-10-21:**

- **Scope:** flagged calls only, in Auto and Loop/Act. Routine calls never
  reach it.
- **Judge the action against what the person asked for.** Claude Code,
  Codex and Cursor all do; risk alone ignores authorization, and the main
  reported failure is consent misjudged.
- **Input:** the call, normalized, with its parsed subcommands; the working
  directory; a `git status` summary before destructive git; the bounded
  content of a session-written script the call runs; the latest messages of
  the person who started the turn (for a Loop, its saved prompt); the last few
  tool calls without their outputs; earlier denials. **Withhold** tool
  outputs, Lor's own text, connector and web content: they carry injected
  instructions, and Jev does not treat state as hostile.
- **Questions:** several narrow Jev Nouls in one request instead of one
  compound "could this cause harm" question (Jev's docs: one yes/no question
  per Noul, combined in code): sends data out, destroys existing work,
  changes an outside system, uses credentials, publishes or deploys, heavy
  resource use, and "the person explicitly asked for this action and named
  its target"; plus a severity Score. Combine in code: no hazard → allow; a
  hazard the person explicitly asked for → allow, unless data leaves to an
  untrusted host or severity is high; otherwise ask (interactive) or refuse
  (autonomous).
- **Thresholds** come from the eval: recall on the dangerous sets first, then
  the false-ask budget on real traffic. The autonomous bar is the same or
  stricter than the interactive one. Errors and `refusal` answers ask or
  refuse (fail closed). Pin the Jev version and re-tune when it changes. A
  second, reasoning stage on flagged calls before asking a person is an
  option if false asks are too high (Claude Code: 8.5% → 0.4%).
- **Cache** only allow verdicts, keyed by the normalized call, working
  directory and request; never across a changed request.

**Egress limits (1.3f-4, after a spike).** Blaxel filters each sandbox's
outbound HTTP by domain, with method and path rules
(`GET:POST:storage.googleapis.com`), and `firewall: { rulesets: ["proxy"] }`
forces all egress through its proxy. The firewall can only be set when a
sandbox is created, so this applies to new sandboxes. Target, as Codex's
"limited" mode: GET and HEAD to any host; other methods only to package
registries and a per-workspace trusted list. The spike must confirm that a
wildcard host works with a method rule, and how DNS, SSH, raw TCP and
`169.254.169.254` behave (private ranges and the metadata address bypass the
proxy by default). Later: credentials injected at the proxy, so they never
enter the sandbox (public preview).

**Sandbox classifier eval (required; revised 2026-10-21).** A classifier eval
framework next to the long-task eval (`packages/lor/src/eval/`), so thresholds
and rules are set from evidence, not guesses. Jacob runs it, like `eval:long`.
The set follows Anthropic's three-set design:

- **Real benign traffic** (sandbox calls from `harness_log`, re-checked
  with the current rules) for the false-ask rate.
- **Real overeager actions**, from Manual-mode rejections.
- **Synthetic dangerous calls**: exfiltration and destruction, with
  obfuscated variants (base64, `$IFS`, quoting, aliases, write-then-run,
  Unicode).
- **Injection cases**, with the payload in tool output and in user-like
  fields (Loop prompts, pasted text).
- **Consent pairs** ("clean up branches" vs "delete branch X"; "just run it,
  no need to check").
- **Route-around cases**: a denied command retried through a file edit or a
  script.
- **Metrics:** recall at a fixed false-ask rate per category, false refusals
  (autonomous), latency and cost per decision, per Jev version. Keep a
  held-out set that prompts are never tuned on. Run it before the switch and
  after any change to the rules, questions, model or thresholds.

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

**Decision (2026-10-20): Lor's own prompt.** Replace the system prompt with
Lor's prompt (today's base prompt, connector lines, LOR.md, plan rules and
trigger/Loop/voice sections) plus guidance for Pi's tools. Drop Pi's preamble,
Pi-docs section and context-file section. Lor is a team workspace agent, not
only a coding assistant.

**Mechanism (verified 2026-10-20):** `before_agent_start` runs on the prompt
path only, not on the approval-replay path (`agent.continue()`), so a resumed
approval turn would fall back to Pi's prompt. Pi's `DefaultResourceLoader`
accepts `systemPromptOverride`, which applies when the session is built, so it
covers both paths; the adapter passed only `appendSystemPromptOverride`. The
1.3a patch adds a `systemPrompt` getter that passes `systemPromptOverride`. With
an override Pi drops its preamble, tool list, rules and docs sections, so Lor's
prompt includes the tool guidance. Pi still appends the working-directory
section (stable), and context-file and skills sections unless the patched
`contextFiles: false` and `skills: false` are set; Lor sets both.

**Cache rules:** build the prompt from per-session inputs only, so it is
byte-identical across turns until LOR.md, connectors or rules actually change.
Put volatile state (plan state, delta, elapsed time, ambient messages) at the
end of the turn's user message or through the `context` hook at the end of the
context. A deterministic tool order keeps the tool section stable while the
list is unchanged; a changed list costs one uncached turn (§4.3 item 6). Send the
Lor session id to the Gateway (`providerOptions.gateway.sessionId` and
`x-session-id`, §4.5).

### 4.9 Adapter defaults Lor must override (G7)

Each item is verified in P/C source unless marked.

| Default | Risk | Required handling |
|---|---|---|
| Host-tool name set change rebuilds the session with an empty journal | Silent loss of conversation, but only within one live adapter session | Not reachable: each turn is a fresh session, whose first build restores the saved file; the load check catches a miss (§4.3 item 6) |
| Missing restored journal creates a fresh session | Silent loss of conversation | Postgres restore + load check (§4.3) |
| Without an `auth` record, Pi reads every `*_API_KEY`, `*_BASE_URL` and `VERCEL_OIDC_TOKEN` in the worker env and `~/.pi/agent/auth.json` | Worker credentials reach the runtime | Always pass an explicit request-scoped `auth` record |
| Context files: `noContextFiles` is not set, so AGENTS.md/CLAUDE.md are read from the working directory upward | Host files above the workspace mount reach the prompt | Disabled with the patched `contextFiles: false` (1.3a); repository instruction files are never workspace instructions (`agent-harness.md`) |
| No settings record: P uses `SettingsManager.inMemory()`; passing `agentDir` loads global settings **and** `<workspace>/.pi/settings.json` | A settings folder would let the model change Pi's settings by writing a workspace file | Phase 1 changes no settings, so never pass `agentDir`. If a setting must change later: `pnpm patch` the adapter to pass a settings record (`SettingsManager.inMemory(settings)` already accepts one) and send the same change upstream |
| `cacheWarming: "streaming"` default | Background requests (1-token replays near the cache expiry) | Keep the default. Evaluated 2026-10-20: C `CacheWarmer` warms only when the model has a cache lifetime (`promptCache`) and the expected saving is at least $0.05, and stops when the run settles. No Gateway model in pi-ai 1.3.0 has `promptCache`, so it stays inactive for Lor's models. Count `cache_warm` usage if it ever appears |
| Pi's system prompt opens as a coding assistant and lists the worker's Pi doc paths | Wrong role for team chat; worker paths in every prompt | Replace it with Lor's prompt through a patched `systemPromptOverride` option (§4.8) |
| Text starting with `/skill:` or `/` expands skills or extension commands | Team members trigger runtime commands by accident | Escape a leading `/` in user and ambient text; Lor editor slash actions stay separate |
| The journal lives in the sandbox HOME | Model can tamper with history | Save from the worker copy, restore from Postgres, load check, and `deniedRoots` for the file tools (§4.3) |
| The adapter patches `node:fs` for the whole process (it reassigns `node:fs` methods, then calls `syncBuiltinESMExports()`); mount paths include the session ID | Collisions with a fixed `workDir`. On Bun, `syncBuiltinESMExports` is a no-op and Pi uses named `fs` imports, so the patch does nothing: Pi cannot see workspace `.pi/skills`, `AGENTS.md` or `.pi/SYSTEM.md`. The journal, auth and tools use real paths or the sandbox API and are unaffected | Never set a fixed `workDir`. Bun verdict (source review, 2026-10-20): likely works for Lor, because Lor turns off context files and skills. Do not depend on the workspace view. Unverified: whether Bun allows assigning `fs.promises` methods; if not, `createSession` throws loudly. The first dev run in 1.3 confirms. Move to Node only on a concrete Bun failure |
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
- Capacity: changed 2026-10-21, see the decisions table. The archive
  delete is a delayed `delete-session-sandbox` maintenance job queued by the
  archive handler; it carries the archive time and does nothing if the
  session was unarchived or archived again since. A quota error fails the
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
| G1 Images | Supported in 1.0.159; mapping specified (§4.1) | Text-first prompt with labeled images; inline bytes; resume carries them; model compatibility checked |
| G2 Native state | Mechanism specified 2026-10-20 (§4.3) | Postgres save at every save point; restore + load check; stable tool list; crash re-runs the turn |
| G3 Approvals | Mapping and product calls decided (§4.2, §4.6) | Gates and `request_approval` mapped; pending set; per-user sandbox mode; exact decisions; no unapproved or duplicate execution after resume |
| G4 Compaction | Specified (§4.4): Pi's trigger, Lor instructions, window override | Lor instructions via `session_before_compact`; plan state re-injected; no overflow on a K3 fallback; entry and usage saved |
| G5 Gateway/budgets/retries | Specified (§4.5): payload hook, session id, spend-only limits | Routing on normal and summary requests; per-step counters; tool block near the deadline or spend limit; abort at the limit |
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

### Session core contract (defined in 1.1)

Code lives in `packages/lor/src/session-core/`. The core imports
`@ai-sdk/harness`, `@ai-sdk/harness-pi` and Pi types only; it never imports
`@repo/db`, channel or role logic, the brain, Loop policy or UI types. Lor
implements the ports in its integration layer (worker and `packages/lor`).

The harness state types are built (1.2): `HarnessBinding`, `HarnessHead`,
`SavedHarnessState`, `SaveHarnessStateInput`, the `HarnessStateStore` port,
`SessionCoreError` and `checkCompatibility`, in
`packages/lor/src/session-core/harness-state.ts`. The rest of the contract:

```ts
type TurnOutcome =
  | { kind: "completed"; text: string }
  | { kind: "awaiting_approval"; pending: PendingApproval[] }
  | { kind: "stopped"; reason: "user" | "spend" | "deadline" | "lease" }
  | { kind: "failed"; error: SessionCoreError }

// Ports Lor injects (HarnessStateStore is built).
interface WorkspacePort {     // Blaxel bridge
  sandboxSession(owner: HarnessOwner): Promise<SandboxSession>
  syncLogFile(path: string, text: string, sha256: string): Promise<void>
}
interface RunPolicy {         // stable tool list, grants, gates, spend/deadline
  tools(): ToolSet            // fixed per session
  toolApproval(): Record<string, ToolApprovalStatus>
  beforeTool(call: ToolCall): Promise<{ allow: true } | { allow: false; reason: string }>
  nearLimit(): boolean
}
interface UsageSink { step(usage: StepUsage): Promise<void> }   // per step
interface ContextPort {
  systemPrompt(): string      // byte-stable per session (§4.8)
  turnPrompt(): Promise<HarnessPrompt>   // text first, labeled images (§4.1)
  compactionInstructions(): string
}
interface EventSink { emit(part: HarnessStreamPart): void }   // UI stream

// Core API.
interface SessionCore {
  runTurn(input: { sessionId: string; claimGeneration: number }): Promise<TurnOutcome>
  continueAfterApprovals(input: {
    sessionId: string; claimGeneration: number
    decisions: ApprovalDecision[]   // the whole pending set (§4.2)
  }): Promise<TurnOutcome>
  stop(sessionId: string, reason: "user" | "spend" | "deadline"): void
}
```

Rules the core enforces: load and restore before `createSession`; the load
check at `agent_start` (§4.3); read the journal before any lifecycle call; one
`save` per outcome; never report `completed` without a successful save;
`reattachInProcess: false`; the gateway model list and Lor session id on every
request (§4.4, §4.5). The core owns no retries of its own (Pi retries; BullMQ
re-runs a crashed turn).

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
| `packages/db/src/schemas/profile-tool-access.ts`, `packages/connectors/src/tools.ts` | Add the Sandbox built-in group (§4.6). Pi's built-in tools stay out of the workspace approval-target vocabulary. |
| New per-user settings row in `packages/db/src/schemas/` (pattern: `user-notification-settings.ts`); user settings UI on web and mobile | The sandbox permission mode (manual, auto, bypass) and the auto classifier call (§4.6). |
| `packages/lor/src/eval/long/` | Move the long-task eval to the Pi path so Jacob can run it before the switch. |
| New sandbox classifier eval in `packages/lor/src/eval/` | Labeled calls, metrics per mode and a threshold sweep (§4.6). |
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
- [x] Pin exact versions (2026-10-20): `harness-pi` 1.0.160, `harness` 1.0.158,
  Pi 1.3.0 (direct dependency plus root pnpm override). Bun reviewed in source
  (§4.9): likely works; the first dev run in 1.3 confirms.
- [x] Upgrade `ai` repo-wide to 7.0.147 (2026-10-20). Type check passes in all 22
  packages and Biome is clean; no caller needed changes.
- [x] Journal save, restore and load check specified (§4.3): read the worker file
  before any lifecycle call; write into the sandbox before `createSession`;
  position check at `agent_start` with `ctx.abort()` on mismatch.
- [x] K3 overflow (§4.4): the gateway's overflow text is undocumented, so register
  DeepSeek's window as 1,000,000 through the adapter's `providers` option;
  overflow recovery stays a backup. Session affinity corrected (§4.5).
- [x] Approval mapping (§4.2): gates, pending set, partial batches, revocation,
  host-tool rebinding, argument binding. Three product calls are open (§4.2).
- [x] Budget limits decided (2026-10-20): spend only, no step/tool/token ceilings (§4.5).
- [x] Product decisions (2026-10-20): Lor's own system prompt, the Sandbox tool
  group, legacy deletion, `eval:long` before the switch, skills deferred.
- [x] Session core contract and ports defined (§6).
- [x] Approval calls decided (2026-10-20): only `bash`/`write`/`edit` can ask,
  under a per-user sandbox permission mode; `request_approval` pauses like a
  gate; a new message denies pending approvals; Stop denies and ends (§4.2, §4.6).
- [x] Sandbox-mode details decided (2026-10-20, §4.6): the turn starter's mode;
  anyone in the session approves; default auto; Loop and Act autonomous with the
  classifier only; per-session switch later.

Exit: every gate in §5 has a recorded seam; the focused upstream changes are
listed; no claim that unmodified stock APIs meet Lor's guarantees.

### 1.2 — Add harness state and explicit dispatch

- [x] Harness state schema (2026-10-20, `packages/db/src/schemas/harness-states.ts`;
  named with Jacob to avoid another meaning of "session"): `harness_state`,
  one row per conversation owner (an `agent_session` or a voice call's
  `voice_session`, exactly one, cascade on delete) with the harness `kind`,
  `adapterVersion`, `formatVersion` (Pi's `CURRENT_SESSION_VERSION`), the saved
  head, the verbatim `continuation` and `lastRunId`; `harness_log`, Pi's session
  file as append-only UTF-8 chunks, one per save. It replaces `agent_run_step`
  for Pi runs; workspace files are never stored here. Additive only; `db:push`
  owed (Jacob).
- [x] Guarded saves and checked loads (`apps/worker/src/lib/harness-state.ts`):
  `writeHarnessState(tx, …)` runs inside the caller's transaction so the turn's
  counters and stop reason commit with it; it checks the claiming run's lease
  at the same attempt (`FOR UPDATE`), compares-and-swaps the head on sha256 and
  length, and appends one chunk, or replaces the whole log after Pi converted an
  older format. `loadHarnessState` rebuilds the log and throws on a gap,
  reorder, length or hash mismatch. `WORKER_ID` moved to `worker-id.ts`.
- [x] Session-core types and upgrade rules
  (`packages/lor/src/session-core/harness-state.ts`, exported as
  `@repo/lor/session-core`): `HarnessBinding`, `HarnessHead`, the
  `HarnessStateStore` port, `SessionCoreError`, and `checkCompatibility`.
  Upgrades keep working: an older Pi format is converted by Pi (next save
  replaces the log); a pending continuation from another adapter version
  expires its approvals with a notice instead of failing. Only a different
  harness or a newer format (a downgrade) is refused. No Pi import yet; the
  binding values come from harness-pi `VERSION` and Pi
  `CURRENT_SESSION_VERSION` in 1.3.
- Moved to 1.3, next to the code that uses them: the approval-table changes
  (§4.2) and the per-user sandbox-mode row (§4.6). The legacy engine relies on
  the one-pending-per-run indexes until 1.6 deletes it.
- Source deduplication is the prefix check at save (§4.3 item 2); semantic
  activity deduplication lands with the projection in 1.5. Tool receipts keep
  `agent_run_tool_result` (same run across attempts).

Exit: storage review covers owner isolation, atomic save, retained payloads and
version rejection. No destructive history rewrite.

### 1.3 — Integrate the adapter and Lor services

Built in reviewable chunks (agreed with Jacob 2026-10-20). The Blaxel bridge
moved here from 1.4, because nothing runs without a sandbox.

- [x] **1.3a Adapter patch** (2026-10-20,
  `patches/@ai-sdk__harness-pi@1.0.160.patch`, registered in the root
  `package.json`; every app Dockerfile copies `patches/`). New `createPi`
  options: `systemPrompt` (a getter passed as Pi's `systemPromptOverride`, so it
  applies to new prompts and resumed approval turns alike); `contextFiles:
  false` (Pi's `noContextFiles`); `skills: false` (no workspace or harness
  skills); `builtinToolApproval`, a per-call callback `(call) => "allow" | "ask"
  | {type: "deny", reason}` that receives the tool's arguments. A decision
  delivered on resume is now checked before any policy. Without a callback the
  adapter keeps its `permissionMode` behavior. Upstream PR candidate.
- [x] **1.3b Blaxel sandbox bridge** (2026-10-20,
  `packages/lor/src/sandbox/session-sandbox.ts`): `openSessionSandbox(owner)`
  gets or creates `ses-{sessionId}` / `call-{voiceSessionId}` with no
  expiration policy, probes health, and returns `{ session, fresh, close }`.
  `fresh` is true on the first run and when the old sandbox was missing or
  answered unhealthy (replaced, logged); a probe that errors fails the run
  instead of deleting files. Quota exhaustion throws `SandboxCapacityError`.
  `close()` ends the connection so Blaxel can enter standby. The
  `SandboxSession` implementation: `run` wraps the command in `bash -c` (the
  adapter expects it; Blaxel does not document its shell), starts a named
  process with `keepAlive` and a 30-minute runaway timeout, and polls
  `process.get` with backoff from 50 ms to 1 s. This follows Blaxel's
  documented pattern for long work: its docs cap `waitForCompletion` at 60
  seconds, and the SDK's `wait()` always sleeps one full interval. Abort kills
  the process. Reads return `null` on 404; writes always pass bytes (Blaxel
  reads a string as a local path) and retry once after `mkdir -p`, since parent
  folder creation is undocumented; `spawn` polls process logs, because Blaxel's
  push log stream drops lines. The session sandbox gets no Gateway
  key. Showing the lost-files notice and the capacity error to people is 1.3c.
- [x] **1.3c Core turn**, in review chunks:
  - [x] **1.3c-1** (2026-10-20, `packages/lor/src/session-core/pi-runtime.ts`):
    `runPiTurn()` restores the saved log into the sandbox (skipped when the
    sandbox copy's sha256 matches), clears any stale worker copy, builds the
    `HarnessAgent` with every §4.9 override (explicit Gateway `auth` record via
    `piGatewayAuth()` in `models.ts`, `reattachInProcess: false`,
    `contextFiles: false`, `skills: false`, Lor's `systemPrompt`, the adapter's
    state folder in `deniedRoots`, the default per-session work folder
    `/workspace/pi-<sessionId>` on the persistent disk — never a shared fixed
    folder, see §4.9, and tool caches stay outside it), the window
    override (Lor's gateway models from Pi's catalog, each capped at
    `LOR_CONTEXT_WINDOW`), and a trusted extension that adds `models`, `order`
    and the Lor session id to every agent-loop request and runs the load check
    at `agent_start` (abort on mismatch). It streams parts to the caller, then
    reads the worker log before `destroy()` and returns the append (or the
    replace after a format conversion) plus the new head. Session affinity also
    rides `x-session-id`. `pi-ai` is now a direct dependency; the sandbox bridge
    defaults commands to `/workspace`.
  - [x] **1.3c-2a Memory tool rename** (2026-10-21, pulled forward from 1.3d):
    the adapter registers Pi's built-ins and host tools in one list, so Lor's
    `ls`/`read`/`write`/`edit` would collide and a Pi turn could not start. The
    brain tools are now `memory_ls`, `memory_read`, `memory_write`,
    `memory_edit` and `memory_link` ("memory" is the UI's word). With Jacob
    (2026-10-21): `tree` folded into `memory_ls` as an optional `depth`;
    `mkdir` and `move` removed (writes create folders; a move broke stored
    `[[/path]]` citations; fewer tools beside Pi's seven). Updated: tool keys and their
    execute contexts (`respond`, project archive), prompts and tool error
    texts, `toolLabel`/`toolDetail`, `SIDE_EFFECT_TOOLS` (so the export deny
    list), touches, the web and mobile trail icons, and the custom-tool
    reserved names, which now also hold `bash`, `read`, `write`, `edit`,
    `grep`, `find`, `glob` and `ls`. Brain tools are not approval targets, so no
    stored policy changes. Old messages keep their old tool names and show the
    generic icon.
  - [x] **1.3c-2b Pi turn wired in** (2026-10-21). `respond()` now runs one
    Pi turn and the `streamText` loop is gone. What it does:
    - Context building, grants, tools and Lor's system prompt stay; a sandbox
      line is added to the prompt.
    - The request is saved on the run before the turn, so a retried attempt
      sends the same request with a note that the earlier attempt may have
      changed files or connected services.
    - The first turn of a conversation sends the full initial message, now
      text-first with numbered images last (`initial-message.ts`).
    - Later turns send the delta since the run that last saved the
      conversation (`harness_state.lastRunId`; `buildTurnDelta`, and
      `buildVoiceDelta` for calls). The worker resolves the owner (the
      `agent_session` of the thread, or the call), loads the saved state and
      binds `RunHarness`.
    - `saveTurn` writes the Pi log and the run counters in one transaction
      under the lease. A lost lease exits silently.
    - If a retried attempt finds its own turn already saved, it delivers that
      answer (`savedTurnText`) instead of running the turn again.
    - A replaced sandbox adds a notice for the model and a trail row; a full
      sandbox quota shows a capacity message.
    - Deleted with the loop: the transcript replay (`replayChain`, approval
      replay, step checkpoints, compaction saves) and their tests; only the
      `formatDelta` tests remain.

    **First dev run (2026-10-21, worker on Node via `tsx watch`):**
    - A loop fire ran end to end: the sandbox was created, the turn streamed,
      2 tool calls ran, usage was billed and write-back ran. Gateway routing
      was not rejected.
    - A workspace with GitHub failed: `HarnessAgent` passes dynamic tool
      descriptions (`search_github`, `investigate_code`, `propose_code_change`)
      through as functions, and Pi cannot clone them. Fixed by resolving them
      in `runPiTurn`.
    - Still unverified: Bun (`pnpm dev` runs the worker on Node; `start` uses
      Bun), the second-turn load check, and Stop.

    **Temporary until later slices:**
    - Approval-gated tools are refused with a reason (1.3e).
    - Sandbox tools run as "bypass" (1.3f).
    - No mid-turn steering or ambient messages: a steered message reaches the
      next turn's delta (1.3g).
    - Pi's default compaction, without Lor's instructions (1.3g).
    - Usage is summed per step from `finish-step` parts, and the turn total
      is used when the turn finishes. So a stopped or timed-out turn still
      bills and counts its finished steps, because the total rejects on abort.
      The adapter also sends an early copy of a step while Pi waits on a Lor
      tool result (`rawFinishReason: "host-input"`, same usage), so those
      copies are skipped. There are no spend checks inside a turn; the wall
      clock and Stop abort the turn (1.3g).
    - Billing uses the requested model's rate: the harness fills
      `response.modelId` with the requested id, not the fallback that
      answered. Pi's assistant entries carry the real `model`; read it there
      (1.3g, with the per-step counters).
    - Delta images stay `[file:]` lines, as continuations were before.
    - No touches or context-meter data, because they read `agent_run_step`
      (1.5).
    - `eval:long` throws until 1.6 gives it a harness.
- [x] **1.3d-1 `share_file` and the end of `create_artifacts`** (2026-10-21,
  Jacob's call after the first dev run showed sandbox files stayed private):
  - **`share_file({ path })`** (`artifacts/share-file.ts`): resolves the path
    in the sandbox. A relative path starts at the conversation's work folder
    (`piWorkDir`). `realpath` must stay under `/workspace`, and the file must
    fit `LOR_WORKBENCH_MAX_FILE_BYTES`. The tool reads the bytes through the
    session sandbox the adapter passes to host tools, then commits them with
    `writeArtifactVersion`. The file appears in the Files panel and as a
    trail file chip, and re-sharing a path makes a new version.
  - It is not a side-effect tool, so a second share of an edited file is not
    deduplicated into the old receipt. `export_tool_result` refuses it.
  - It is bound on every channel run with a harness, with no profile group
    yet; the 1.3d Sandbox group will gate it with the sandbox tools.
  - **Removed:** `create_artifacts`, the workbench sandbox
    (`sandbox/workbench.ts`), its smoke step, and its standalone tool entry.
    The `artifacts` group key stays so saved profiles parse, and empty groups
    are hidden in settings.
  - **Prompts updated:** the sandbox line now covers sharing and downloading
    shared files, and the plan rules, attachment hints and export text point
    to the sandbox.
  - **Also changed:** `export_tool_result` is now bound on every channel run;
    it was tied to the `create_artifacts` grant. Unused env vars are gone
    (`LOR_WORKBENCH_MAX_TOTAL_BYTES`, `LOR_WORKBENCH_MAX_FILES`).
- [x] **1.3d-2 Sandbox tool group and tool order** (2026-10-21):
  - **The group:** `sandbox` is a third built-in group (`BUILTIN_TOOL_GROUPS`).
    Its catalog entries are `bash`, `read`, `write`, `edit`, `grep`, `glob`,
    `ls` and `share_file`; it is on by default (workspace mode) and switchable
    per workspace, category and channel. They are not approval targets:
    they are excluded from `builtinApprovalTool` and the approval-target list.
  - **Switched-off tools:** they are left out of the turn. Pi's tools go
    through `HarnessAgent` `inactiveTools`, and `share_file` is not bound.
  - **Prompt:** the sandbox line names only the tools the run has.
  - **Tool order:** `runPiTurn` sorts tools by name so an unchanged list keeps
    the cache.
  - **Other:** a terminal icon for the group in the web and mobile settings;
    touches list every sandbox tool, and `share_file` touches the artifact.
- [x] **1.3d-3 Trail rows and the tool contract** (2026-10-21):
  - **Execute contract, checked in source:** `HarnessAgent` runs Lor's tools
    through the AI SDK's `executeTool` with `context` from `toolsContext[name]`,
    checked against each `contextSchema`, plus `abortSignal`, `toolCallId`,
    `toModelOutput` and streamed (preliminary) output.
  - **Differences:** `messages` is always empty, and no Lor tool reads it.
    Tools also get `experimental_sandbox`. A thrown error returns
    `{ error }` to the model.
  - **Output limits:** Lor's guard wrappers (output limits, receipts, touch
    hints) still wrap every Lor tool. Pi's own tools truncate their output
    (read 2,000 lines or 50 KB; bash tail; grep, find and ls head) and do not
    count toward `toolOutputBytes`.
  - **Trail:**
    - Labels read `file_path` (`piToolLabel`).
    - `sandboxToolDetail` (`sandbox/pi-events.ts`) builds each row:
      - `write` is an all-added diff and `edit` an old→new diff, both from the
        call's arguments, because the adapter's results are plain text with
        no patch;
      - `bash` keeps the output tail and fails on a non-zero `(exit N)`;
      - searches keep the head;
      - a refused call shows "Not run: reason".
    - `tool-error` parts, which is how Pi's tools report failures, now mark the
      row failed.
    - Web and mobile render Pi's tools as flat `SubStepRow`s (file chip when the
      file was shared, diff counts, one expansion); `glob` gets the search icon.
    - Needs a visual check.
- [x] **1.3e Approvals**, in review chunks:
  - [x] **1.3e-1 Pause and continue** (2026-10-21; needs `db:push`):
    - **Schema:** the two one-pending indexes are gone. New: unique
      `(run_id, tool_call_id)`, `kind` (`policy` | `request`),
      `harness_approval_id` and `input_sha256`.
    - **Pause** (`runPiTurn`): a turn that ends with an unfinished turn
      reads the log, then calls `suspendTurn()`. The save stores the
      continue-turn state verbatim, and the worker files one approval row per
      pending call in the same transaction. A plan moves to
      `waiting_for_approval` after the save.
    - **Gates:** `toolApproval` is `user-approval` for gated tools and
      always for `request_approval`. In a call where nobody can approve, the
      call is refused, as before.
    - **`request_approval`:** now a real gate: the tool runs only after a
      person approves it, and a rejection reaches the model as not run. It
      no longer needs a plan. When a plan exists, its approval rows reference
      the plan.
    - **Resume:** the API serializes decisions on the paused run's row
      (`FOR UPDATE`), so exactly one decision sees the set complete. That
      decision starts the resume run (`resumeApprovalId`, as before). The
      resume run sends no prompt: `createSession({ continueFrom })`, then
      `continueStream` with one decision per pending approval.
    - **Checks before resume:** an approved call is denied with a reason
      when its tool is gone, its gate target changed, or its input sha256
      differs.
    - **Missing tools:** tools the paused turn listed but this run no longer
      binds get stubs that answer "no longer available". Without them, the
      harness throws.
    - **Writing instead of deciding:** any other run in the session first
      rejects what is still pending, with a reason that names the author.
      It finishes the paused turn in the same Pi session, then sends its
      own prompt. On voice, the waiting request ends.
    - **Queued resumes:** a resume queued behind a run that already
      finished the turn is skipped at drain (`resumeStillPending`).
    - **Cards:** web and mobile show one card per approval under the paused
      message.
    - **Trail:** calls that were not run show "Not run: reason".
    - **Removed:** `buildToolApproval`, `fileParkedApproval`, the
      `request_approval` decision line, and `LOR_TOOL_APPROVAL_SECRET`.
    - **Known gap:** if a finished paused turn pauses again before the new
      prompt goes out, that prompt is not sent. Its message is already
      covered by the run, so it does not reach a later delta either. This is
      rare, because the model has just been told to stop.
  - [x] **1.3e-2 Resolver, notices and Stop** (2026-10-21):
    - **Resolver check before resume** (`loadPausedDecisions`): an approval
      stands only while its approver could still give it. The check is the
      same rule the resolve endpoint applies: write access to the channel,
      plus the gate's resolver rule for policy rows. Otherwise the call is
      not run, and the model reads that the approver can no longer approve
      it.
    - **One notice per set** (`approval-notify.ts`): the requester and
      escalation rules still apply per row. Each person gets one notice per
      set, about the rows they can decide ("… (and N more)"). The
      escalation job covers the whole set.
    - **Stop while approvals are pending** (changed with Jacob 2026-10-21:
      Stop just ends the turn, with no reply, as it does for a running turn):
      - **Web and mobile:** Stop shows while the session's newest paused
        reply has pending approvals.
      - **Stop endpoint** (`stopPausedTurn`): closes every pending row of the
        set as rejected and sets `stopRequestedAt` on the paused run. Anyone
        who can write in the conversation may do this, as with a running
        turn. Nothing resumes.
      - **Voice:** cancelling a waiting request does the same, with the
        rows expired. This replaces `expireRunApproval`.
      - **The session's next run drops the stopped turn** (`dropPaused`). It
        resumes from the saved log instead of the continuation, so the
        unanswered calls read as "No result provided" (pi-ai
        `transformMessages`). Its prompt says who stopped the turn and that
        those actions did not run.
      - **Effect on approved calls:** approved calls in a partly decided set
        do not run either. A sibling call that already ran keeps its effects.
      - **A set that was already complete:** its resume is already under
        way; Stop on that run's reply stops it as usual.
    - **Plan header:** no change. The plan's `pendingApproval` is never
      rendered; only an optimistic cache patch reads it.
  - [x] **1.3e-3 Voice sets and upgrades** (2026-10-21):
    - **Voice sets:** Lor's window shows the set one approval at a time, in
      set order. The overlay UI is unchanged.
      - Every decision in a call queues the voice job. That job shows the
        next pending approval with its approvers and a new watcher, or
        resumes the request once the set is decided.
      - When nobody who can approve is in the call for the grace period, the
        watcher rejects the approval shown, and the next one takes its place.
        The model reads "Nobody who could approve this was available".
      - When the call ends, the whole set expires (`expireApprovalSet`).
    - **Adapter upgrades:** `pausedTurnExpired` detects a paused turn saved
      by another adapter version. The next run expires its pending rows and
      drops the turn, as Stop does (`pausedDropped: { reason: "upgraded" }`).
      Its prompt says Lor was updated and the actions did not run.
      - A resume run for such a turn runs as a normal turn with that note.
      - `runPiTurn` still throws `incompatible_state` if a caller tries to
        continue it.
- [ ] **1.3f Sandbox safety** (§4.6), in three chunks agreed with Jacob
  2026-10-21:
  - [x] **1.3f-1 Modes and asking** (2026-10-21; needs `db:push`):
    - **Setting:** `user_sandbox_settings` (one row per user; `manual` /
      `auto` / `bypass`, default `auto`). The API is
      `GET`/`PATCH /v1/sandbox-settings`. Web shows it in a "Sandbox"
      settings tab; mobile shows it on You → Sandbox.
    - **Frozen mode** (`turnSandboxMode`, worker): the turn's mode is saved
      as `sandboxMode` on the run's request, so a retry keeps it.
      - A resume keeps the paused turn's mode.
      - Loop and Act runs are `autonomous`.
      - Voice uses the speaker's mode.
      - Anything else uses the mode of the person whose message started it.
    - **Asking** (`sandboxToolApproval`, through the patched
      `builtinToolApproval`):
      - Read-only tools never ask.
      - `bypass` and `autonomous` allow every call.
      - `manual` asks for every `bash`, `write` and `edit`. Until 1.3f-2,
        so does `auto`; its settings text already describes the final
        behavior.
      - An ask pauses the turn like any approval. It is filed as a `sandbox`
        approval row with no gate target; the card reads "Run a command: …"
        or "Write/Edit <path>".
      - Anyone who can write in the session approves; in a call, anyone
        connected with write access.
      - On resume, an approved call is denied when the Sandbox group no
        longer binds its tool.
  - [x] **1.3f-2 Rules and autonomous runs** (2026-10-21; §4.6 policy as
    revised 2026-10-21):
    - **Parser** (`sandbox/shell-parse.ts`): tree-sitter-bash from
      `@vscode/tree-sitter-wasm` 0.3.1 (VS Code's prebuilt runtime and
      grammar; no install scripts), loaded once with `createRequire`.
      - It collects every command, including nested ones and `bash -c`
        scripts (re-parsed).
      - It unwraps `sudo`, `env`, `xargs`, `timeout`, `nice`, `find -exec`
        and others, up to depth 8.
      - It records write redirects.
      - It marks a script `plain` (Codex's grammar), or `hidden` when it
        hides what runs: a computed command name, `eval`, piping into a shell
        or interpreter, a computed script.
    - **Rules** (`sandbox/command-policy.ts`): `checkCommand` and
      `checkFileWrite` return hard, flagged, safe or routine with a reason.
      They cover the hard rules, Codex's last safe list without git, the
      flag categories, and protected paths for tool and shell writes.
      Paths are resolved lexically; `ln` is checked at both ends, so a
      symlink into a protected folder is flagged.
    - **Modes** (`sandbox/sandbox-approval.ts`): the §4.6 table.
      - A flagged call asks with its reason on the card ("Run a command: git
        push (pushes to a remote)").
      - Loop and Act refuse with the refusal text. Hard rules are denied with
        their own text.
      - After 3 denials in a row or 20 in a turn, the denial tells the model
        to stop and report.
    - **Records:** none of its own. The `sandbox_decision` table was built,
      then dropped the same day: `harness_log` and the `sandbox` approval
      rows hold the same facts (§4.6).
    - **Known limits:**
      - Option values count as positionals.
      - `env -S` strings are not unwrapped.
      - `rm -rf` of a build folder asks in Auto until the classifier lands.
      - Not run yet: the WASM load on Node and Bun is unverified.
  - [ ] **1.3f-3 Classifier:** Jev Nouls for flagged calls only, judged
    against the request, with tool outputs withheld; thresholds from the
    eval; fail closed; the reason on the ask card.
  - [ ] **1.3f-4 Egress limits:** a spike on Blaxel's method and domain rules
    and the `proxy` firewall ruleset, then GET/HEAD to any host and other
    methods only to registries and a trusted list, for new sandboxes.
- [ ] **1.3g Turn controls and eval:** the compaction handler, per-step counters,
  the tool block near the spend or deadline limit, ambient context, steering and
  stop; the sandbox classifier eval next to the long-task eval (§4.6).

Exit: source review follows every request, tool and summary through permission,
accounting and save points, including cold approval resume and a crashed turn.

### 1.4 — Attach session sandboxes and scoped resources

- [ ] The Blaxel bridge itself moved to 1.3b. Here: keep workspace identity,
  artifacts, checkout/publish policy and process fencing across every run kind.
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

- [ ] Delete the legacy engine. The `streamText` loop, transcript replay and
  step checkpoints went in 1.3c-2b; left: `compaction.ts` (write-back still
  uses `fitMessagesToBudget`), the `agent_run_step` readers (touches, context
  meter) and `LOR_TOOL_APPROVAL_SECRET`. Legacy tables keep their rows; nothing
  writes or reads them. Old sessions start from their visible history on their
  first Pi run. Passing a full messages array to `HarnessAgent` does not import
  history, so no import path is built.
- [ ] Move `packages/lor/src/eval/long/` to the Pi path. Jacob runs `eval:long`
  and the sandbox classifier eval, sets the thresholds from the classifier
  results, and reviews both before the switch.
- [ ] Update as-built docs (`agent-harness.md`, `context-continuation.md`,
  `approval-policies.md`, `artifacts.md`) and tick phase-1 items individually.

Exit: one engine. The Pi path keeps Lor's controls, per-turn native recovery and
activity; workspace limits stay explicit until Git checkpoints ship.

## 9. Verification, rollout and record

No tests, ad hoc test scripts, browser test harnesses or `pnpm run validate`,
per repository policy. Exception (decision 2026-10-20): Jacob runs `eval:long`
on the Pi path and the sandbox classifier eval (§4.6) before the switch. This revision is source and
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
| Per-turn saves, spend-only run limits, sandboxes for every run kind, interim lost-workspace behavior, unlimited capacity, Bun, `ai` upgrade, Lor's own system prompt, Sandbox tool group, legacy deletion, `eval:long` before the switch, skills deferred | Decided with Jacob 2026-10-20. |
| Gates G1–G7 | Findings and seams recorded; implementation not validated. |
| Implementation slices 1.1–1.6 | 1.1 done 2026-10-20; 1.2 built 2026-10-20 (`db:push` owed); 1.3a–1.3b built 2026-10-20; 1.3c–1.6 not started. |
| Upstream changes / SDK publication | None submitted. Patched locally (1.3a, `patches/@ai-sdk__harness-pi@1.0.160.patch`), ready to turn into `@ai-sdk/harness-pi` PRs: the `systemPrompt`, `contextFiles` and `skills` options (§4.8); the per-call `builtinToolApproval` callback that checks a delivered decision before any policy (§4.6). Further candidates: keep history when the host-tool list changes (`rebuildPiSession`); fail instead of a silent fresh start on a missing journal; a settings record if a setting must change; later a session store; `@ai-sdk/harness` `HarnessAgent._toToolSpecs` should resolve AI SDK v7 dynamic tool descriptions as `streamText` does (`resolveToolDescription`), instead of passing the function through, which Pi then cannot clone (worked around in `runPiTurn`, 2026-10-21). |

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
