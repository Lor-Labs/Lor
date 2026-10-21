# Shared harness sessions — Pi first

> Status: finalized architecture and phased implementation plan, not built.
> Updated 2026-10-19 after reviewing the current repository and upstream
> documentation. The product direction in §1 is agreed, including Postgres-owned
> Pi state and private Git workspace revisions (§4). Implementation gates remain in §7.
> First implementation: replace Lor's main model/tool loop with Pi while retaining
> Lor's application controls. The [phase-1 implementation runbook](pi-harness-runbook.md)
> is written for review; implementation has not started. This document supersedes
> the separate coding-agent runtime and late harness phase in the original
> [code-channel design](code-channels.md).
> Runtime decided 2026-10-20 (runbook G0): Vercel `HarnessAgent` +
> `@ai-sdk/harness-pi`; Pi Durable is rejected for phase 1. Phase 1 saves native
> Pi state per completed turn. Product decisions remain agreed.

## 1. Agreed direction

- Ordinary Lor chat/cowork and code sessions use the same session model and coordinator. Code sessions add repository/workspace capabilities. Human channel chat remains human chat, per [workspace-model.md](../workspace-model.md).
- Pi is the default harness for Lor-funded sessions. Eligible personal subscription modes use the provider's official harness, initially Claude Code and Codex. Direct subscription-funded inference outside those harnesses is deferred.
- Lor owns permissions, memory, tools, approvals, plans, Loops, queues, budgets, billing, collaboration and durable session identity. The selected harness owns the model/tool loop and its native context.
- Harness selection, native-state persistence and capability differences belong in the first phase. Additional provider adapters can follow the Pi conversion; they must not require a second session architecture.
- Shared code and consistent behavior across Pi, Claude Code and Codex take priority over a Pi-only simplification. On this basis the runtime is `HarnessAgent` + `@ai-sdk/harness-pi` (2026-10-20): Vercel's Claude Code and Codex adapters share that harness spec. Pi Durable is Pi-only and is rejected for phase 1.
- A user-visible checkpoint follows a completed user turn, including all its model/tool iterations. Recovery inside that turn remains a separate requirement.
- Fork and rewind preserve both conversation state and workspace state. Rewind creates another branch and excludes later branch context. It does not undo external actions.
- Every Lor agent run gets its session's isolated sandbox, regardless of chat type or harness, including voice, Loop and Act runs. Provision on the session's first agent run, reuse the logical workspace across turns and allow standby between runs or while awaiting approval. A new request must not create a new empty workspace or discard native history. If the sandbox itself is lost (crash or deletion), phase 1 continues the session in a new empty sandbox and Lor tells the model and the people in the session that earlier files are gone; phase 2 checkpoints rebuild it from the last completed turn instead. Further allocation cost optimization is deferred.
- Postgres owns native Pi session/checkpoint state and a common activity history for every harness. Private Git stores workspace revisions when files are involved; an immutable checkpoint joins them. A Lor CLI is deferred; future local/cloud transfer follows the import rules in §5.

## 2. What changes in the current code

Verified against the working tree on 2026-10-19. The coding child already runs Pi;
the main Lor loop does not. Merely replacing `runPi` would not achieve this plan.

| Current seam | Retain | Change for Pi |
|---|---|---|
| [`packages/lor/src/index.ts`](../../packages/lor/src/index.ts), `respond()` | Context construction, scoped tools, output/event contract | Replace `streamText`, `prepareStep`, `stopWhen` orchestration with a Pi adapter and explicit coordinator gates |
| [`packages/lor/src/run.ts`](../../packages/lor/src/run.ts) | Run identity, counters, callbacks, stop/steering contract | Add versioned native recovery state; stop assuming every engine resumes from `ModelMessage[]` |
| [`apps/worker/src/lib/agent-run.ts`](../../apps/worker/src/lib/agent-run.ts) | Queue ownership, leases, usage accounting, durable publication | Persist native progress and gate further execution on persistence; extend ownership to workspace writers |
| [`apps/worker/src/lib/run-continuation.ts`](../../apps/worker/src/lib/run-continuation.ts) | Existing run history and legacy continuation | Delete the legacy replay with the legacy engine (no users yet, 2026-10-20). Pi continuations resume native state; old sessions start from their visible history, with no import |
| [`packages/lor/src/tool-guard.ts`](../../packages/lor/src/tool-guard.ts), [`approval-policy.ts`](../../packages/lor/src/approval-policy.ts) | Output limits, tool grants, approval records, retry receipts | Adapt Lor tools into Pi; bind approval continuations to native tool IDs and validate grants again on resume |
| [`packages/lor/src/brain.ts`](../../packages/lor/src/brain.ts), [`compaction.ts`](../../packages/lor/src/compaction.ts) | Scoped memory service, working notes, plan-aware context policy | Expose memory tools with unambiguous names; translate compaction into Pi's supported context/session hooks |
| [`packages/db/src/schemas/agent-sessions.ts`](../../packages/db/src/schemas/agent-sessions.ts) | Existing `agent_session`, channel/thread anchor, origins | Extend with runtime/branch/workspace bindings; do not introduce an unrelated top-level `code_session` |
| [`packages/lor/src/sandbox/`](../../packages/lor/src/sandbox/) | Provisioning, artifact handling, host-controlled Git publishing | Make filesystem/shell execution available to the primary harness; child coding agents become optional delegation |
| [`packages/lor/src/models.ts`](../../packages/lor/src/models.ts) | Model registry and auxiliary services | Resolve harness, model and paying identity per run instead of one global main model |

The current sandbox image pins `@earendil-works/pi-coding-agent@0.84.1`.
`sandbox/pi-config.ts` disables skills, extensions, templates and context-file
discovery. Therefore the proposed command/skill experience requires deliberate
resource loading; it is not enabled by today's Pi subprocess.

## 3. Runtime boundary and product controls

```text
Lor session (chat / cowork / code)
  -> coordinator: scope, lease, queue, budget, approvals, persistence
     -> selected runtime: Pi | official Claude Code | official Codex
        -> Lor services: memory, connectors, plans, artifacts
        -> isolated session sandbox: files/shell, provisioned on first run
  -> common events and messages -> existing Lor UI
```

Use Vercel's `HarnessAgent` with `@ai-sdk/harness-pi`, with policy, storage and
remote execution supplied at explicit boundaries. The [runbook](pi-harness-runbook.md)
records the comparison (Pi Durable and Vercel's `durable-harness` were rejected
for phase 1), the pinned versions and the adapter defaults Lor must override.
Prompt images are supported upstream since `harness-pi` 1.0.159. The adapter's
native-state handling cannot be Lor's authority: Lor saves native state to
Postgres per completed turn and verifies it on restore. Compaction settings,
gateway routing, budgets, approvals and sandbox lifecycle map onto supported
hooks. Prefer configuration, extensions and focused upstream changes before a
direct Pi SDK fallback or custom machinery.

The adapter needs start/resume, input/steer, stop, event delivery, durable native
state references, resource/command discovery and declared fork capabilities.
Keep native operations available rather than forcing every runtime into one
lowest-common-denominator method. Vercel's harness/sandbox APIs do not replace
Lor's coordinator or guarantee native-state portability. Keep the internal session
core separate from Lor policy/UI through injected storage, execution and policy
interfaces; publishing an SDK is deferred. In particular, `HarnessAgent` consumes
the latest user message rather than importing an entire supplied history.
[HarnessAgent history](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)

Recommended Pi topology: trusted SDK/coordinator in the worker, with explicit
filesystem and shell tools targeting the session sandbox. Audit every default
tool, resource loader and extension for host filesystem/process access. Never
point a built-in local shell at the worker by accident. Untrusted workspace
extensions must not execute with worker credentials. If an isolated Pi service
is needed instead, retain the same control contract over RPC.

| Concern | Required behavior |
|---|---|
| Memory | Retain Lor's scoped Postgres brain and retrieval tools. Pi session history is working context, not a replacement for shared memory. Use names such as `memory_read` where native file tools would collide. |
| Compaction | Pi's native compactor with its default trigger, plus Lor's instructions (copy IDs and citations exactly) through `session_before_compact`, with plan state re-injected. Capture summary usage and save the compaction entry with the turn. One compaction owner; no competing Lor summarizer on the Pi path. |
| Write-back | Retain the existing memory write-back policy and audit trail. Small classifiers, embedding, reranking and other auxiliary API calls need not become interactive harness sessions. |
| Tools and approvals | Lor service calls remain scope checked and approval gated. Native shell/tools need their own execution policy; wrapping Lor's tools does not intercept arbitrary Bash/network side effects. |
| Budgets and usage | Spend is the only run limit: no step, tool-call or token ceilings, so long code turns are not cut short. Target: the workspace balance with auto top-up and an admin monthly cap; a run stops gracefully only when the balance cannot be refilled. Keep Stop, a high wall-clock backstop and per-step usage counters. Count automatic compaction usage. Treat missing usage as unknown. Subscription quota failure must not silently switch the bill to Lor. |
| Steering/stop | Preserve ordered input and exactly-once consumption of durable steering rows. Stop/lease loss must prevent the next request/tool dispatch; handle already-running tools explicitly. |
| Recovery | Phase 1 saves native state per completed turn and at approval/stop boundaries; a failed save fails the run. A worker crash mid-turn re-runs that turn from the last save. An event listener that reports/swallows errors is not a durability gate. Mid-turn native recovery is deferred. |
| Skills/commands | One scoped resource catalogue and version manifest. Lor owns product commands such as fork/rewind/share; runtime-native commands are capability advertised. Terminal-only commands need not exist in the web UI. |
| Identity | Each turn resolves its starter, runtime and paying credential owner. Anyone in the session can start a turn; there is no single driver. Forks never copy credentials. Managed Loops use an authorized workspace billing mode; personal subscription use remains personal. |

The current tool-result cache reduces duplicate side effects but has best-effort
writes. Do not describe it as exactly-once execution, and do not automatically
replay an uncertain external mutation after a crash.

## 4. Agreed storage: Postgres session state, private Git workspace files

Decision confirmed 2026-10-19: Postgres is the durable authority for Lor's native
Pi sessions and checkpoint graph. A checkpoint references an immutable private
Git commit whenever a versioned file workspace is involved. This is Lor's chosen
architecture, not a claim that Git-based conversation storage is impossible.

**A restorable Pi checkpoint with files requires both stores:** native context in
Postgres (messages, tool calls/results, compaction and branch state) **plus** the
matching workspace commit in private Git, joined by the checkpoint manifest.
Resource/configuration versions and any external artifact references are part of
that manifest too. “Native Pi state in Postgres” names the conversational/runtime
portion, not the whole restorable workspace. A text-only session without workspace
files does not require Git solely for its conversation history.

| Data | Owner | Representation |
|---|---|---|
| Messages displayed in Lor, comments, permissions, subscriptions/unread, approvals, branch metadata, search projections, billing and external-action receipts | Postgres | Keep the existing app model. Native-derived message/tool views are projections; user-authored product records remain authoritative here. |
| Exact Pi execution history, selected branch/leaf, compaction and runtime restoration data | Postgres | Versioned native entries and immutable checkpoint references. Persist incrementally rather than copying the entire transcript per model step. |
| Official Claude Code/Codex native state | Runtime-specific durable payload referenced by a Postgres checkpoint | Preserve each harness's supported native format and required related state. The adapter may need opaque blobs; their physical storage is an implementation detail. Do not substitute visible messages for native recovery data. |
| Workspace files | Private Git host; artifact references for excluded large outputs | Pin an exact commit SHA. Include eligible additions/deletions; exclude credentials and dependency caches. Pierre Code Storage and Cloudflare Artifacts remain candidates. |
| Checkpoint publication | Postgres manifest/head pointer | Join native state, visible history boundary, workspace revision, resource versions and external receipts at one logical boundary. |

Restore selects a checkpoint ID, loads the exact native context through its
recorded boundary, and checks out its file revision if present. A branch name
selects a line of work; its moving tip is not an immutable historical checkpoint.
A new fork creates a new branch from that checkpoint. Text-only sessions need no
Git repository merely to support conversation forks and rewind.

The database must preserve Pi's native context, including tool results, compaction
and branch state, not only user/assistant display messages. Keep a versioned
persistence interface so SDK changes do not leak into every product reader.
Do not create a second full raw `ModelMessage[]` archive for Pi runs. Existing
legacy rows stay in place, but nothing reads them after the legacy engine is
deleted. Local native files are runtime copies, not a competing authority for
the shared branch.

Some text will exist in both native entries and UI/search projections. This is
intentional and does not require another complete transcript in Git. Keep private
history out of code clones and GitHub exports. A Lor CLI fetches authorized native
state separately through Lor's API; a code-clone credential alone does not grant
transcript access.

Cloudflare's alternative remains technically valid: it explicitly describes
versioning files and history together, sharing sessions and coworker forks. The
old single-player dismissal was incorrect. Lor chooses the database/file split
to retain its application controls and queryable Pi state; migrating native Pi
history into Git is no longer part of this plan. [Cloudflare's session pattern](https://blog.cloudflare.com/artifacts-git-for-agents-beta/)

### A common activity history for every harness

All adapters, including Claude Code and Codex, persist the available semantic
history into Postgres. This is the durable product record for inspection, search,
collaboration and cross-harness handoff. It is separate in purpose from native
resume data, even where Pi can share the underlying stored payloads.

| Record | Postgres stores | Larger or authoritative payload |
|---|---|---|
| User/assistant messages | Ordered content blocks, role, author and source identity; partial/completed status | Attachment references as needed |
| Tool calls/results | Tool identity, available input/output, execution status, ordering, parent/subagent relationship and source IDs | Large outputs can use durable blob references; record truncation/unavailability explicitly |
| File edits | Reported operation, paths, result, originating tool/item and diff references where available | Git stores the actual checkpoint file tree; artifact storage handles excluded large files |
| Approvals, usage and lifecycle | Requests/decisions, observed usage, errors, compaction markers and checkpoint linkage | Native compaction/recovery data remains in the runtime's authoritative store |

Persist semantic items as they occur and finalize them when their authoritative
completion arrives. Do not require a permanent database row per token delta.
Streaming fragments can be coalesced and retained briefly; completed activity
must outlive the current `agent_run_event` TTL. The existing transient run-event
table alone is insufficient for this new durable cross-harness history.

Deduplicate using adapter-specific stable source identity, including native
thread/session, turn, item and content-block identity where applicable. A message
ID alone is not necessarily unique per emitted block. Reconcile stream gaps from
supported history APIs/native data where possible; retain an explicit incomplete
status otherwise. We can record what the harness exposes, not promise hidden
state or every internal filesystem write. Git snapshots capture included file
state at checkpoint boundaries even when a shell-generated edit has no individual
file-edit event. They do not recreate all intermediate file states within a turn.

For Pi, derive this common view from its stored native entries where possible
instead of keeping two independent raw archives. For Claude/Codex, retain both
the common activity view and their native recovery payload. The view alone does
not replace a native session or guarantee exact resume. This is the same logical
split for every harness, with more control over the Pi implementation.

Upstream interfaces expose the needed categories: Codex has item lifecycle,
command/file-change events and history reads; Claude exposes message/content
blocks and tool activity. Preserve their native boundaries in the adapters.
[Codex app server](https://learn.chatgpt.com/docs/app-server),
[Claude streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output),
[Claude sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

## 5. Checkpoints, forks and rewind

### Two durability boundaries

- **Recovery progress:** current `agent_run_step` is one model/tool iteration. In phase 1, Pi saves native state per completed turn (and at approval/stop); usage counters and tool receipts still update per step. A crash mid-turn re-runs that turn. Mid-turn native recovery can return later through an upstream session-store option.
- **Product checkpoint:** a completed user turn, or a committed human workspace change. It can contain many recovery steps. Persist one even if files did not change; reuse the previous file revision in that case.

A checkpoint manifest needs:

```text
id, session_id, branch_id, parent_checkpoint_id
input/visible_history_boundary, run/recovery_boundary
harness_kind, harness_version, native_state_ref, native_leaf_id
workspace_revision, artifact_refs
instructions/resource_versions, context/memory_revision_refs
external_effect_receipt_refs, status, writer_generation
```

Opaque session IDs alone are insufficient. The referenced state must survive
destruction of the process and sandbox, including any child-session data needed
to resume. Native persistence must preserve valid structure; apply redaction and
retention at explicit boundaries, not by corrupting arbitrary native JSONL.

### Publish a consistent checkpoint

1. Finish the user turn and stop starting new work under the current workspace lease. Wait for active tools/child writers, or stop them and record an incomplete turn; a background writer cannot quietly outlive the boundary.
2. Briefly pause/queue all workspace writes, including human edits and pushes. Flush accepted Yjs operations to files. Record the revision/operation boundary.
3. Capture the native branch at that boundary and the workspace file set. Save immutable native state and Git/artifact objects, then verify durable references.
4. In a lease/generation-guarded database transaction, publish the manifest and advance the branch head only if its expected previous head still matches. Couple visible completed status to this publication.
5. Resume queued writes as the next turn/change. Failed publication leaves the old checkpoint current; unreferenced stored objects can be collected later. Retain incomplete work for recovery when available, without advertising it as a completed checkpoint.

Use a single publication path and conditional Git ref updates. Immutable candidate
objects are preferable to treating a mutable remote branch tip as the truth before
the DB publishes it. Reconcile a crash between remote writes and publication;
never let an unrelated push silently redefine an existing checkpoint.

This preserves completed checkpoints, not every keystroke or running process.
Git does not restore an OS image, active processes or excluded files.

### What “fence writers” means

Suppose worker A is editing the workspace, pauses, and loses its lease. Worker B
takes over. If A wakes up, it must not keep writing or publish an old checkpoint.
Assign each ownership period a generation number; every accepted mutation and
publication must carry the current generation. Reject the old one.

A database check alone cannot stop an old shell process writing a shared disk.
Stop/verify termination of that process before reusing the disk, or give B a
separate restored workspace and refuse A's publication. Human writes, watchers,
formatters, subagents and local pushes must go through the same ownership and
snapshot boundary. A fast-forward push check does not see uncommitted agent edits.

### Fork guarantees

| Operation | What Lor can promise |
|---|---|
| Same harness, compatible version | Fork native state at a supported completed boundary, plus workspace revision; preserve native context as supported by that harness. Rebind credentials, permissions and workspace paths. |
| Different model/provider within Pi | Keep the Pi session where supported; allow Pi's model-change handling. Model-specific reasoning, tokenization and behavior need not transfer identically. |
| Pi → Claude Code, Claude Code → Codex, etc. | New native session seeded with an authorized transcript/brief through the chosen checkpoint and the same files. Lor can display the full inherited public history; the actual new model context is bounded and may be lossy. |

Cross-harness forks are **handoffs**, not conversion of proprietary session files.
Preserve decisions, goals, relevant tool results, plan, referenced artifacts and
working notes; mark their source and boundary. Use a supported import path or an
explicit bootstrap input. Passing an old message array to `HarnessAgent` does not
import it. Do not transfer hidden reasoning, credentials, pending tool calls or
approval grants. Resolve/stop active work first. The person who forks uses their
own authorized tools; inherited visibility must not exceed the parent's scope.

### Strict rewind and memory

Rewind creates a branch from checkpoint N. It uses N's file revision, native leaf
and context projection. Later conversation, summaries, steering rows, working
notes and branch-specific memories must not be automatically reintroduced.
Pi can summarize an abandoned branch during navigation; disable that import for
strict rewind. [Pi compaction and branch summaries](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/compaction.md)

Pin the memory/context revisions used at N where available and track provenance
for later retrieval. Shared memory changes are external effects: do not revert
them for the whole team. A fresh read of live shared memory or a connector can
observe newer facts and must be treated as new input after rewind. Thus strict
rewind means historical session state, not a rollback of the outside world.
Always revalidate current authorization; never restore a revoked permission.

Claude's native file rewind covers selected file-edit tools and omits Bash edits
and most subagent edits. It also leaves conversation context intact. Therefore
Lor needs its own coordinated file/history checkpoint rather than treating that
API as a complete rewind. [Claude checkpoint limitations](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)

### Lor CLI: local and cloud execution of the same checkpoint

The CLI is deferred, with no implementation scheduled in the initial phases.
The import/checkpoint contract should allow this future capability without
requiring the CLI now. A plain Git clone/push transfers files; a future Lor CLI
also uses an authenticated session API for history, native state and ownership.

1. **Cloud to local:** choose an authorized checkpoint, create a local fork or transfer the active writer role, fetch its file commit and native state, then materialize a compatible runtime with the user's own credentials. No whole-database replication is needed.
2. **Continue locally:** run the same Pi adapter/resource contract where supported, using Lor's authorized services for shared memory and connectors. Other harnesses follow their own restore capabilities; unsupported native restore becomes an explicit context handoff.
3. **Local to cloud:** upload file objects and native progress, validate the parent checkpoint and current scope, and publish a new checkpoint through Lor's coordinator. Then the cloud runtime restores that checkpoint and acquires the writer role.
4. **Concurrent changes:** reject a stale active-branch publication or preserve it as a separate fork. Never overwrite a newer cloud conversation or file revision. Ownership transfer must stop the previous writer or isolate its workspace.

The transfer bundle carries versioned session state, file/artifact references and
resource configuration, not provider credentials or a running process image.
Pin runtime compatibility and remap workspace paths through supported APIs. Code
history can be cloned through Pierre or another suitable Git host; conversation
transport and coherent handoff remain Lor responsibilities.

### Reconciling a local upload

Upload is a validated import through Lor's API, not direct database replication
or replacing the cloud transcript with whichever file is newest.

| Situation | Import behavior |
|---|---|
| Local work descends from cloud checkpoint C; cloud is still at C | Under valid writer ownership, append/deduplicate missing native and common activity records, store file objects, then conditionally publish the new checkpoint against C. |
| Both local and cloud continued after C | Preserve the local continuation as a separate branch from C. Do not automatically interleave messages, tool executions or compaction state. Code merging and any context synthesis are separate explicit operations. |
| Local session started outside Lor, or common ancestry cannot be verified | Create a new imported session with source provenance. Import only supported history/native formats and available files; use an explicit context handoff if native resume is unsupported. |
| Interrupted/repeated upload | Stage objects and deduplicate by stable origin IDs and content checks; retries must not duplicate messages, tool results or checkpoint publication. Keep the current cloud head until all required references validate. |

Use the parent checkpoint and content identity rather than wall-clock timestamps
to establish ancestry. Validate current access and the native format/version,
then persist the missing records in Postgres and publish the corresponding file
revision. Imported tool results describe past actions: importing must not execute
those actions again, create fresh approvals, or charge Lor inference for the
historical local work. Preserve source-reported usage separately with provenance.

An external transcript may contain many turns but only today's working files.
In that case, import the history and current file snapshot, but mark older file
checkpoints unavailable. Do not invent historical file trees or promise full
rewind to every imported turn. Completed local checkpoints containing both native
state and matching files can carry the stronger restore guarantee.

## 6. Implementation sequence

### Phase 1 — Convert the current main Lor harness to Pi

Execution detail: [Pi foundation migration runbook](pi-harness-runbook.md).
Its steps 1.1–1.6 are slices of this phase only, with adapter selection, storage
contracts, lifecycle gates, approval/recovery mapping and legacy-engine deletion.
They do not bring the later Git, official-provider or fork/rewind work into phase 1.

- [ ] Introduce runtime kind/version and native-state references on the existing session/run model. Define capabilities for native forks, approvals and persistence now.
- [x] Choose the runtime (2026-10-20): `HarnessAgent` + `@ai-sdk/harness-pi`.
- [ ] Pin exact Vercel adapter/Pi/AI SDK versions and apply the runbook's adapter overrides (stable tool list, explicit auth, no host context files, no workspace-controlled settings). Prefer supported extensions or focused upstream changes; record the blocker before choosing direct SDK integration. Preserve the current event/UI contract.
- [ ] Retain scoped tools, memory, context, plans, steering, stop and usage/budget enforcement. Reuse upstream approval continuation, native compaction/retries, provider transport and remote file/shell tools where they meet the contract. Do not bypass grants or expose worker files through native tools.
- [ ] Save native Pi state to Postgres per completed turn and at approval/stop boundaries, under lease and expected-head checks; a failed save fails the run. Restore in a fresh process from Postgres and verify the loaded state, rather than trusting a surviving local or sandbox session file. A crash mid-turn re-runs the turn.
- [ ] Materialize the common durable message/tool/activity view from Pi entries, with source IDs and checkpoint boundaries. Keep completed history independent of transient streaming-event retention; define the same adapter contract for Claude/Codex.
- [ ] Give every agent run its session's isolated sandbox from the session's first run, including voice, Loop and Act runs, with stable workspace identity, reuse across turns and safe standby independent of chat type or harness. Session sandboxes get a 2 GB disk, are deleted after 7 days idle, and are deleted 10 minutes after their session is archived (changed 2026-10-21 for Blaxel's ephemeral-volume quota; loop sessions excepted). Until phase 2 checkpoints, a lost sandbox continues empty with a visible notice; quota errors fail visibly. Defer further allocation cost optimization. Retain useful workbench/artifact plumbing; remove obligatory child coding dispatch from the default path only after direct tool coverage exists.
- [ ] Replace Pi's coding-assistant system prompt with Lor's own. Add a Sandbox tool group (on/off per workspace, category and channel through agent profiles) and a per-user sandbox permission mode for `bash`, `write` and `edit`: manual, auto (classifier, the default) or bypass. Read-only tools never ask, and Pi's built-in tools are not workspace approval targets. Anyone in the session can approve. Loop and Act runs are autonomous: classifier only, and a flagged call is refused so the model tries a safer way.
- [ ] Delete the legacy engine (decision 2026-10-20: no one uses the app yet). No flag, drain or import; old sessions start from their visible history on their first Pi run.
- [ ] Review the actual execution, recovery, approval and scope paths; use focused type checking/lint/builds without tests, per repository policy. Jacob runs `eval:long` on the Pi path and the sandbox classifier eval before the switch. Update as-built docs only when the implementation lands.

Scoped skills and slash-command discovery moved out of phase 1 (2026-10-20), to the self-configuration work.

Exit conditions: ordinary chat/cowork and code-capable sessions use the same Pi
runtime path; existing Lor tools/memory/approval/plan/budget controls are preserved;
native state survives runtime replacement; unsupported provider capabilities are
explicit; the legacy engine is gone. The Git vendor and complete fork UI need not
block this phase.

### Phase 2 — Durable workspace checkpoints and official harness adapters

- [ ] Choose the private Git host and any opaque payload storage required by official harness adapters using restore behavior, access isolation and retention requirements. Native Pi state remains in Postgres. Revisit the dated vendor comparison in [code-channels.md](code-channels.md).
- [ ] Implement the manifest, workspace writer generation, consistent finalization, conditional publication and sandbox rebuild at a completed-turn boundary.
- [ ] Add official Claude Code/Codex adapters to the phase-1 contract. Validate their native persistence/fork boundaries and resource paths individually; no generic JSONL rewriting.
- [ ] Persist their available message/tool/file activity into the same Postgres view, reconcile missing stream items where supported, and retain native recovery payloads separately from that view.
- [ ] Expose eligible personal authentication using each provider's supported flow and current commercial terms. Keep credentials out of snapshots; never share one person's subscription with other people in the session. Subscription access is not a prerequisite for shipping managed Pi.

### Phase 3 — Fork, handoff and strict rewind

- [ ] Add checkpoint parent pointers, active branches and native forks, with branch-scoped context and workspace isolation.
- [ ] Add cross-harness handoffs with visible fidelity labeling and an authorized bootstrap context. Forks do not inherit pending approvals.
- [ ] Add historical views, external-effect receipts and the “cannot undo” explanation. Preserve abandoned branches and define retention/deletion independently.

### Phase 4 — Code collaboration surfaces

- [ ] Deliver step permalinks, diffs, mentions/comments, local clones and gated human pushes, subchannels, fork comparison and PR publishing.
- [ ] Add opt-in co-editing with Yjs rooms scoped to session + branch + workspace epoch. Flush through the checkpoint coordinator; live state must not cross a rewind boundary.

The Lor CLI and its local/cloud transfer UI remain deferred. The future importer
uses the reconciliation rules in §5; it is not required to ship these phases.

The code index is an independent improvement. It is not a prerequisite for the
Pi migration or a reason to create a separate code-session runtime.

## 7. Decisions to settle during implementation

No additional product decision blocks finalizing this architecture or beginning
phase 1. The following are implementation gates to resolve before the relevant
capability ships. Verify the Pi lifecycle controls first, choose storage before
durable file checkpoints, and validate provider restore/auth before enabling each
official harness. Routine choices stay within this plan; a finding that changes
the agreed behavior should be brought back as a concrete tradeoff.

- Exact compatible dependency set and the remaining runbook gates G1–G7: image mapping, per-turn save and restore check, approvals, the overflow check on a fallback model, Gateway routing, adapter overrides and Bun verification. The runtime (G0), per-turn saving, spend-only run limits, Pi's compaction trigger, sandboxes for every run kind (one per voice call), unlimited sandbox capacity, Bun, the repo-wide `ai` upgrade, Lor's own system prompt, the Sandbox tool group, legacy deletion and `eval:long` before the switch are decided.
- Private Git vendor, official-harness opaque payload storage, retention, and how transcript deletion affects forks/backups. Postgres ownership of native Pi state is decided.
- CLI transport/version compatibility and local/cloud ownership-transfer UX; precise commands are not yet specified.
- Full filesystem snapshot allowlist, large artifacts, child-session persistence and runtime-specific restore path handling.
- How much historical context a cross-harness handoff imports, with clear user-visible limits.
- **Model selection (shape decided 2026-10-21; admin setting details open).** No model picker in ordinary chat and cowork sessions: most people should not have to choose a model. A workspace admin setting picks the default main and small model for the built-in Lor harness, from open-weight and proprietary models, with each model's charges shown. Code sessions show harness and model pickers. People who connected a personal subscription (Claude, ChatGPT) also see a harness picker in chat sessions, so their own plan pays for ordinary chat. The harness is fixed per session and the credential is resolved per turn ([code-channels.md](code-channels.md) §2 "Modes and repos"). Today one global main/small model comes from env (`packages/lor/src/models.ts`), and no picker exists. This changes the earlier plans: `workspace-model.md` decision 6 (amended) and the "real per-session picker" later-work item in `workspace-model-runbook.md`.
- Provider-specific hosted authentication eligibility. The Vercel adapters' subscription modes read the host user's own credential files (single developer). Anthropic's Agent SDK docs state that third parties may not offer claude.ai login or rate limits without prior approval, and OpenAI requires an interest form for remotely hosted apps; confirm with both vendors before planning phase 2 around personal subscriptions. Direct subscription inference remains deferred, irrespective of that eligibility.

## Sources and scope

Upstream behavior was checked on 2026-10-19; pinned dependency behavior must be
verified when implementation starts. Public docs are not evidence that Lor has
implemented these guarantees.

- [Pi SDK](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/sdk.md), [extensions](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/extensions.md), [RPC commands](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/rpc-commands.md).
- [Vercel Pi adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi): chosen integration (2026-10-20), with the overrides and gates in the [runbook](pi-harness-runbook.md); it does not erase runtime capability differences. Vercel's [Claude Code](https://ai-sdk.dev/providers/ai-sdk-harnesses/claude-code) and [Codex](https://ai-sdk.dev/providers/ai-sdk-harnesses/codex) adapters share its harness spec.
- [Codex app server](https://learn.chatgpt.com/docs/app-server): native thread lifecycle and completed-turn fork boundaries.
- [Claude session storage](https://code.claude.com/docs/en/agent-sdk/session-storage): native storage and restore requirements need adapter-specific handling.
- [Provider billing/authentication distinctions](pricing-and-billing.md#6-byo-api-keys-and-subscriptions), [Claude hosted use terms](https://code.claude.com/docs/en/legal-and-compliance).
