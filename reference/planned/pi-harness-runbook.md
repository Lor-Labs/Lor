# Pi foundation migration runbook — phase 1

> Status: revised after independent adapter review, 2026-10-19. **Documentation
> only; implementation not started.** Implements phase 1 of
> [Shared harness sessions](harness-sessions.md). Repository baseline: `dev`
> at `7d663fdf`; planning branch: `codex/pi-harness-sessions`.
>
> **Runtime choice reopened:** the initial review omitted `pi-durable`. Its
> preliminary source review below requires a new comparison (G0) before selecting
> the runtime or implementing adapter repairs. Existing findings about
> `harness-pi`/`pi-coding-agent` do not describe Pi Durable.

Prefer **supported Vercel integration where it meets Lor's requirements**, native
Pi compaction and existing remote file/shell tools. Compare Pi Durable in G0
before selecting the runtime. Lor supplies application policy, storage and integration.
**Selection priority:** shared code and a consistent product across Pi, Claude Code
and Codex take precedence over convenience within the Pi implementation. Reject
Pi Durable if it makes adopting the other harnesses harder than the shared route.
The published adapter is a credible starting point, but is not yet a drop-in
replacement that satisfies all of Lor's recovery, image and execution-control requirements.
Close the concrete gates below before choosing a direct SDK fallback or enabling
Pi sessions. Do not infer production readiness from the common API alone.

## 1. Decisions and scope

The previous draft selected custom machinery too early. This revision removes
those defaults:

| Previous proposal | Revised decision |
|---|---|
| Direct Pi SDK by default | Evaluate `HarnessAgent` + `createPi` first; use supported configuration/extensions, then focused upstream changes. Direct SDK remains a conditional fallback. |
| New Pi-to-AI-SDK inference bridge | Start with Pi's existing Gateway provider; preserve routing using supported provider configuration/payload hooks where sufficient. No new transport unless a concrete gap remains. |
| Port Lor's summarizer into the new primary loop | Prefer Pi's native compactor. Lor supplies scoped context, authoritative plan/working-state inputs, budget permission and persistence. |
| Disable native retries and implement Lor retries | Configure and account for native retries, including compaction/provider retries. Add only missing controls; do not stack retry engines. |
| New native approval/batch replay dispatcher | Reuse harness approval/continuation state and Pi adapter replay. Lor retains policy decisions, resolver authorization and durable receipts. |
| New filesystem/shell tool implementations | Reuse the adapter's remote tools. If direct SDK is necessary, use Pi tool factories with explicit remote operations. |
| Zero sandbox allocation for plain chat | Every Lor agent chat gets an isolated sandbox, provisioned on its first run and reused across turns. Standby is part of the lifecycle; further cost optimizations are deferred. |
| Six prescribed new storage tables | Preserve required data/atomicity, but choose the minimum additive schema after the native-state contract is settled. Reuse existing runs, approvals and tool receipts where their semantics fit. |
| Session code mixed with product behavior | Keep an internal session core behind injected storage, policy and execution interfaces; no new published SDK or general plugin platform. |

The agreed product architecture remains:

- One session model for Lor chat/cowork/code, with Pi the Lor-funded primary
  runtime. Human channel chat remains human chat.
- Shared session orchestration, product behavior and Lor services must support
  official Claude Code/Codex adapters without a second architecture. Pi-specific
  task/document APIs must not become dependencies of the common product layer.
- Lor owns memory, permissions, approvals, plans, Loops, queues, budgets, billing,
  collaboration and durable identity. Pi owns the model/tool loop and native context.
- Postgres owns native Pi history and common durable activity. Private Git will
  own checkpoint file trees, joined through immutable checkpoint references.
- A completed user turn and a model/tool iteration are different boundaries.
  Mid-turn recovery must preserve committed context and avoid blindly replaying
  uncertain external effects. A moving branch name is not a historical checkpoint.
- Every Lor agent chat gets a sandbox, regardless of chat type or harness. Create
  it on the first agent run, reuse the same logical workspace across turns and
  allow standby between runs. Human-only channels do not create agent runtimes.
- Credentials and permission decisions are resolved afresh, not restored from
  snapshots. A sandbox does not grant permission to execute every available tool.

This is **phase 1 only**. Phase 2 adds private Git checkpoints and official
Claude Code/Codex adapters with eligible subscription authentication. Phase 3
adds forks/handoffs/strict rewind; phase 4 adds code collaboration. CLI, publishing
an SDK, direct subscription inference, an extension marketplace, a new terminal
UI and allocation cost optimizations are deferred. Do not use extraction-readiness
to expand this migration.

Until phase 2, native conversation recovery can survive worker loss, but a
workspace without a durable file revision cannot promise exact reconstruction
after disk loss. Preserve available files and report missing state explicitly.
Do not create an empty workspace and call it an exact resume.

## 2. Evidence baseline

Reviewed public documentation and downloaded published packages into `/tmp` for
source inspection; nothing was installed in this repository and no tests or
runtime experiments were run. Source-observed behavior is distinguished below
from candidate changes and unverified runtime guarantees.

| Component | Inspected version | Significance |
|---|---|---|
| `@ai-sdk/harness-pi` | `1.0.158` | Published adapter, not an assumed feature from repository `main`. |
| `@ai-sdk/harness` | `1.0.156` | Exact dependency of that adapter; itself depends on `ai@7.0.145`. |
| `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai` | `1.0.3` | Inspected matching Pi baseline; adapter declares `^1.0.3`, so implementation must lock the resolved family. |
| `@ai-sdk/provider-utils` | `5.0.63` | `SandboxSession` contract used by the adapter. |
| Existing Lor | AI SDK declaration `^7.0.11`; sandbox Pi `0.84.1` | Existing CLI image does not determine the new host adapter's version. Review dependency alignment and native format compatibility explicitly. |

Harness packages are still documented as experimental. These versions are the
**evaluation baseline**, not an instruction to upgrade the entire repository or
claim Bun compatibility. Review the final lockfile, worker runtime and package
exports before implementation enrollment. [Pi adapter documentation][pi-doc]

Source keys below refer to files inside these exact published archives:

- **P** — [harness-pi 1.0.158 archive][pi-package], files under `src/`: `pi-session.ts`,
  `pi-resume-state.ts`, `pi-tool-batch.ts`, `pi-utils.ts`, `pi-translate.ts`,
  `pi-auth.ts`, `pi-model-resolver.ts`, `pi-remote-ops.ts`, `pi-read-operations.ts`,
  `pi-workspace-mirror.ts`, `pi-harness.ts`; also the package-root `CHANGELOG.md`.
- **H** — [harness 1.0.156 archive][harness-package], files under `src/agent/`:
  `harness-agent-session.ts`, `harness-agent.ts`,
  `harness-agent-settings.ts`, `internal/run-prompt.ts`,
  `internal/to-harness-stream.ts`, `internal/turn-telemetry.ts`; also
  `src/v1/harness-v1-lifecycle-state.ts` and `src/v1/harness-v1-session.ts`.
- **C** — [Pi coding-agent 1.0.3 archive][coding-package], files under `dist/core/`:
  `agent-session.{js,d.ts}`, `sdk.js`, `session-manager.d.ts`,
  `settings-manager.d.ts`, `extensions/{types.d.ts,runner.js}`,
  `compaction/compaction.js` and `tools/*.d.ts`.
- **A** — [Pi AI 1.0.3 archive][ai-package]:
  `dist/providers/vercel-ai-gateway.js` and the provider/request APIs.
- **S** — [provider-utils 5.0.63 archive][utils-package]: `src/types/sandbox.ts`.

Use the named functions/types as searchable evidence anchors. Reinspect them if
versions change; a newer documentation example does not prove an older package
has that behavior.

### Additional candidate: Pi Durable — preliminary review

The user identified [Pi Durable][durable-post] after the initial review. This was
an omission in the candidate comparison. It is a separate experimental harness,
not an automatic durability upgrade to `pi-coding-agent`. The latest Vercel
adapter metadata checked here (`1.0.159`) still depends on `pi-coding-agent`, not
`pi-durable`; the detailed adapter findings below remain pinned to `1.0.158`.

Inspected `@earendil-works/pi-durable@1.3.0` from its [published archive][durable-package],
without installing or running it. Its `README.md`, `dist/types.d.ts`,
`dist/session/session.js` and `dist/harness/{generation,tool,compaction}.js` show:

- `Session` awaits atomic `Storage.commit` before adopting/publishing state;
  fatal storage errors fail the session. `ToolTask` commits intent before execution
  and recovers according to an explicit replay policy.
- Native tasks cover generation, tools, retries and compaction. Compaction
  settings, result placement and usage recording are built into this runtime.
- Typed documents, submission deduplication, conversation forks and committed
  activity views overlap with machinery proposed here. Remote `ExecutionEnv`
  implementations can supply built-in coding tools without worker-local access.

This makes Durable a serious alternative to repairing the coding-agent wrapper.
It is **not yet a completed Lor compatibility review**:

- Shipped storage includes memory, SQLite and JSONL/Cloudflare adapters; Postgres
  requires an implementation of `Storage`. One process owns a storage at a time,
  with no built-in cross-process locking. Map storage scope, worker ownership,
  fencing and atomic Lor accounting before choosing the topology.
- Approval hooks/memos are useful primitives, not proof of Lor's durable parked
  approval/resolver protocol. Recheck permissions on recovery. Ordinary hook
  errors may be reported and skipped; `beforeTool` fails closed. Budget gates
  must cover actual generation, retries and background compaction requests.
- Verify images, Gateway policy, resource/command support, UI/event mapping,
  worker runtime and version compatibility. Usage recording does not establish
  a hard budget or complete accounting for requests interrupted by a crash.
- Durable conversation forks do not snapshot external files or undo side effects.
  Keep Postgres/Git checkpoints, current permission checks and every-chat sandboxes.
  If selected, persist Durable's native records/tasks/documents, not an invented
  conversion to coding-agent `SessionManager` journal entries.

**G0 decision:** compare a supported Vercel integration, focused Vercel adapter
changes and direct use of this upstream durable harness behind the internal
session boundary. Prefer the supported option that preserves Lor's contract with
the least new machinery across all three harnesses, not just the Pi path. Durable
is acceptable only as an implementation detail that preserves shared integration
and does not make Claude Code/Codex adoption harder. Do not assume Vercel already
wraps Durable, replace the
runtime without comparison, or build duplicate durability/compaction engines.
The four product phases and the no-implementation status remain unchanged.

## 3. Requirement findings and decisions — coding-agent adapter baseline

### Images: prompt support is a concrete adapter blocker

**Observed:** P `extractUserText` rejects every non-text user content part and
`doPromptTurn` passes only text. C `AgentSession.prompt` accepts an `images`
option. P's remote `read` now delegates to Pi's read-tool factory and returns
image blocks; host-tool `toModelOutput` images also have a conversion path. These
are separate capabilities. [Pi limitations][pi-doc]

**Lor impact:** `packages/lor/src/index.ts` includes images directly in initial
conversation input and exposes `view_image`. Preserving only image-reading tools
would change the existing experience and does not close prompt-image support.

**Decision:** prefer a focused adapter change carrying authorized image content
through prompt normalization, Pi invocation and native resume. An inline extension
cannot intercept a prompt rejected before Pi receives it. A tool-based image
workaround is not equivalent and is not the migration default. Confirm MIME,
byte/URL handling, size limits, model support and attachment retention at the
same boundary Lor uses today. Do not silently discard images or switch engines
within a Pi session.

### Approvals/resume: reuse the supplied machinery

**Observed:** H persists pending approvals, client tool results, completed host
results and frozen turn settings in lifecycle state. P persists pending native
batches including completed results and native approval decisions. Its cold
replay reuses completed results and suppresses duplicate visible output; replayed
assistant usage is zeroed while original native entries remain. Built-in approval
requests and custom host-tool approvals are supported. `reattachInProcess: false`
selects persisted restoration instead of depending on a live process. Sources:
H lifecycle types/session/`run-prompt`; P `pi-resume-state`, `pi-tool-batch`,
`requestBuiltinToolApproval` and `doContinueTurn`.

**Decision:** keep this protocol. Remove the proposed Lor native batch replayer,
synthetic stop protocol and manual insertion of approval tool results. Lor maps
its existing policy targets and exact tool arguments to harness approval IDs,
persists decisions, checks current grants and resumes using the supplied
continuation APIs. Preserve resolver authorization, voice restrictions and
plan waiting states.

**Open:** persistence of the complete journal plus continuation envelope must
satisfy the next section. Adapter replay is not proof of exactly-once effects
across a crash during a remote mutation. H supports multiple pending approvals;
Lor currently has one pending approval per run/plan. Prefer serializing presentation
of an opaque pending set and submitting decisions through supported APIs; compare
that with a supported sequential policy. Do not prescribe a new executor or
silently approve/drop sibling calls. Confirm partially answered batches, revocation
and host-tool context rebinding before enrollment. [Harness lifecycle][harness-doc]

### Persistence: stock durability is weaker than Lor requires

**Observed, concrete gaps:**

- P `persistSessionFileToSandbox` copies a local native journal into a private
  sandbox directory. Resume JSON contains a filename and pending-batch data,
  not all native bytes. Persisting only that JSON in Postgres is insufficient.
- P `doStop`/`doSuspendTurn` catch journal-copy failures as best effort. A missing
  restored file can lead to fresh `SessionManager.create` instead of a failed
  resume. Lor must never silently lose native context this way.
- H lifecycle callbacks use `Promise.allSettled`; callback errors do not stop
  execution. P's high-level `piSession.subscribe` forwards events through a void
  emitter; waiting while consuming the result stream does not itself stop Pi.
- H `stopWhen` can suspend a result at a step boundary, but Pi's event emitter has
  no corresponding awaited producer acknowledgment. It is not evidence that a
  DB commit finishes before the next native model request or built-in tool.
- C extension handlers are awaited but common event/payload handler exceptions
  are reported and swallowed. An extension that merely throws on a failed save
  is not a reliable durability barrier. C emits `message_end` extensions before
  appending the message to its session journal.

Sources: P `pi-resume-state`, `rebuildPiSession`, `doStop`, `doSuspendTurn`,
`piSession.subscribe`; H `notify`, `toHarnessStream`, `run-prompt`; C
`_handleAgentEvent`, `ExtensionRunner.emit` and `emitBeforeProviderRequest`.

**Decision:** prefer a focused adapter/native integration improvement that offers
strict native load/save and awaited dispatch/checkpoint hooks with propagated
failure. Required boundaries are initial input, finalized assistant before tool
execution, tool result before further effects, compaction before subsequent
inference, approval suspension and completed turn. Preserve upstream native
replay semantics. This is a proposed extension surface, not an existing API.

**Compare before choosing:** a trusted extension can read native state and help
projection, but needs a proven failure latch/abort path for every operation;
a `SandboxSession` decorator can copy lifecycle files to Postgres, but alone
cannot fix swallowed saves or mid-turn advancement; a thin direct-SDK adapter
can access low-level awaited listeners, but must still preserve compaction,
recovery and file-tool behavior. Prefer the focused upstream surface if it meets
the contract; do not use filesystem watchers or monkey-patched private fields
as the authority. No upstream change has been submitted or accepted by this plan.

### Compaction: native algorithm, Lor policy and durable results

**Observed:** H sessions expose compaction and P `doCompact` calls
`AgentSession.compact(customInstructions)`. C implements native summary/tail
selection, compaction entries, threshold and overflow recovery, plus
`session_before_compact`, `session_compact`, context and system-context hooks.
A successful native compaction entry includes usage. P's normalized compaction
event currently exposes summary/trigger/token information, not that usage, and
`doCompact` discards the returned native result. Sources: P `doCompact`,
`translatePiEvent`; C `compact`, `_runAutoCompaction`, `_runDefaultCompaction`,
`completeSummarization` and extension types.

**Decision:** reuse Pi's native compactor; keep Lor's Postgres brain and
write-back distinct. Supply working-state requirements and authoritative plan
context through supported instructions/context hooks. Keep important IDs,
external-action receipts and current plan state available without relying only
on generated prose. Retain original native history and the selected compaction
boundary. Retire the old Lor summarizer only on the Pi path after these behaviors
are mapped; legacy runs keep their current compactor.

**Open:** `compact(customInstructions)` is available, but the automatic
`session_before_compact` result supports cancellation or a replacement compaction,
not a documented general instructions/settings override. Compare a controlled
manual invocation at a safe boundary with a small adapter option for native
compaction instructions/settings. Avoid replacing the summary algorithm merely
to add Lor's prompt. Capture native compaction usage and commit the native entry
before further work. Cancel a compaction when budget/ownership is unavailable;
if existing context cannot fit, stop explicitly. Do not launch manual compaction
as a fire-and-forget task while another operation owns the turn.

### Gateway, retries and budgets: preserve policy without a new transport

**Observed:** P has isolated auth/credential stores, provider configuration and
Gateway model resolution. A's Gateway provider uses the Anthropic Messages API.
Gateway supports `providerOptions.gateway` on that API, including routing options;
C provides payload/header hooks and provider registration. This gives us a
plausible existing route for Lor's `models`, `order` and `caching` options without
a Pi-to-AI-SDK message bridge. [Gateway routing][gateway-options]

**Limits:** `createPi` does not itself expose Lor's existing Gateway-options
object. C installs normal request payload hooks on the agent; native summarization
uses the stream function with separate request options. Do not assume a normal
request extension also covers compaction. Pi `cacheRetention` is not the same
setting as Gateway automatic caching. Default base URLs/protocols also differ
from the existing sandbox CLI configuration. Sources: P `pi-auth`,
`pi-model-resolver`, `PiHarnessSettings`; C `sdk.js`, `_runDefaultCompaction`,
`completeSummarization`; A Gateway provider.

**Decision:** map existing `packages/lor/src/models.ts` policy onto Pi's native
provider and supported hooks first. Verify model IDs, fallback/provider order,
cache semantics, reasoning, image support, resolved-model attribution and usage.
Use explicit request-scoped credentials; no ambient provider or subscription
fallback. Keep auxiliary AI SDK services. Add a transport bridge only if this
route and a focused provider/adapter improvement demonstrably cannot preserve
required behavior.

**Retries:** prefer configured Pi retry/backoff and provider retry settings, with
one Lor run deadline and cumulative budget. C's native summarizer also retries;
do not retain an outer Lor retry loop that multiplies those attempts. Expose
missing settings through a focused adapter option or isolated application-owned
settings input before inventing a scheduler. Settings files must be generated
from explicit Lor configuration, never inherited from a worker user's home.

**Budget gap:** `stopWhen`, observability callbacks and an abort signal are useful
but do not constitute a strict pre-dispatch gate for every Pi operation. Native
summarization can issue multiple requests and retries, and not all of its usage
appears in the common stream. Require a shared request/tool gate and native
usage accounting, covering initial calls, retries, compaction and optional children.
A narrow provider/stream middleware that delegates to the existing transport is
less work than a new transport; compare its coverage with a focused upstream
request hook. No gap may reset counters, treat unknown usage as zero, permit
unbounded retry or silently bill another identity.

Specify what each ceiling guarantees. A pre-dispatch check cannot undo the cost
of an admitted in-flight request. Preserve output limits and reserve allowance
where required; do not claim an exact spend cap from delayed usage events alone.

### File/shell tools: reuse remote implementations

**Observed:** P already routes file/shell operations through `SandboxSession`.
Its read path uses Pi's `createReadToolDefinition` with remote operations; other
adapter tools include their own compatible wrappers. Do not claim every adapter
tool is literally Pi's factory. C exports file/shell factories with injectable
operations, including read, write, edit, bash, grep, find and ls. Sources:
P `buildBuiltinToolDefinition`, `pi-remote-ops`, `pi-read-operations`; C `tools/*.d.ts`.

**Decision:** use the adapter's existing tools. If direct SDK is selected, reuse
Pi's factories and supply every filesystem/process operation remotely. Lor
implements a thin Blaxel `SandboxSession` bridge, not new edit algorithms, output
parsers or tool schemas. Keep Lor brain tools under unambiguous names such as
`memory_read`; canonical approval/grant identity survives model-facing aliases.

**Boundaries:** no fallback to worker-local operations. Trusted runtime scratch
and resource mirrors may live in isolated temporary directories; model tools
cannot inspect arbitrary worker files. P disables filesystem extension discovery,
but trusted inline extensions execute in the host. Do not load user/repository
code extensions there or register native MCP paths that bypass Lor's scoped
connector wrappers. File-root policy does not constrain `bash`; preserve actual
sandbox isolation, grant separation, credential exclusion and host-controlled
Git publishing. Inspect real path/symlink handling and stale process termination.

### Every chat gets a sandbox: provision once, reuse and allow standby

**Observed:** H `createSession` resolves sandbox working-directory/home metadata
and performs setup; P checks host/workspace correspondence, resolves home and
private state paths, loads native files and mirrors resources. These operations
use the supplied sandbox before the first model-requested execution tool. This
fits the agreed first-run provisioning model. Sources: H `createSession`; P `createPiSession`,
`syncHostWorkspaceFromSandbox`; S `SandboxSession`.

**Decision, agreed 2026-10-19:** every Lor agent chat gets an isolated sandbox,
including ordinary chat, cowork and code sessions across supported harnesses.
Provision on the first agent run; retain its logical workspace across messages,
worker attempts and approval continuations. Empty chat creation/history viewing
does not itself start a run. Do not create a new sandbox per message or wait for
the first file/shell tool. The user-facing contract is the same for every chat.

At safe turn/approval boundaries, persist native progress and settle active work
before releasing connections so Blaxel can enter standby. On the next run,
reattach to that workspace and restore the committed native state. Blaxel manages
standby automatically; it retains working state and still charges for storage.
Expiration/deletion removes state and is a separate operation. [Blaxel lifecycle][blaxel-lifecycle]

**Recovery:** Postgres remains authoritative for Pi history; private Git provides
file checkpoints in phase 2. Standby snapshots do not replace either. Reclaim or
replace a workspace only with explicit recovery guarantees; missing files fail
visibly rather than silently producing a fresh workspace. Review current idle
deletion policies and unhealthy-sandbox replacement before enrollment.

**Deferred:** zero-VM plain chat, virtual-to-remote promotion and special deferred
bootstrap infrastructure. Startup sandbox I/O is no longer an adapter blocker or
a reason to choose direct SDK integration. Accept provisioning/storage overhead
for a consistent product; observe capacity and usage, then optimize costs later.
Image support and strict persistence/request gates remain required independently.

## 4. How to choose the integration

Use this order **per gap**, not a blanket rewrite:

| Option | Appropriate use | Limit / decision trigger |
|---|---|---|
| Existing adapter configuration and harness APIs | Auth, tools/filtering, scoped skills, approvals, lifecycle envelopes, compaction entry point, UI stream | Preferred wherever source supports the required semantics. |
| Trusted inline Pi extension | Context/instructions, resource policy, provider payload customization, native observations | Does not fix rejection before Pi receives input; exception swallowing and compaction coverage must be accounted for. |
| Thin Lor bridge/decorator | Blaxel operations, scoped host tools, durable policy/accounting and projections | Reuse provider algorithms; do not describe a best-effort lifecycle copy as a strict checkpoint. |
| Upstream Pi Durable harness | Existing durable tasks, storage commits, compaction, forks and execution environments | Accept only if contained behind the same runtime boundary without making Claude Code/Codex adoption harder; assess total integration work, not Pi savings alone. |
| Focused upstream adapter/Pi change | Prompt images; strict state store and awaited checkpoints; full request/usage hooks; compaction/retry settings | Define narrow contract, affected functions and compatibility cost. A candidate patch is not an available feature or a promised upstream release. |
| Direct Pi SDK inside the same session boundary | Specific remaining blocker demonstrably costly or impossible to solve above | Record the blocker and maintenance tradeoff. Retain native compactor, retry/tool implementations and provider transport wherever possible. |
| Custom compactor, tool replay or inference transport | Only a separately evidenced unmet requirement | Not authorized by the preference for Pi, and not default work in this runbook. |

**Provisional target:** Vercel adapter plus Lor's policy/storage/Blaxel bridges,
subject to the Pi Durable comparison in G0. **Readiness:** runtime selection open;
not approved for production enrollment. Do not route image turns to one runtime and
text turns to another inside the same session to disguise a capability gap.

**Cross-harness acceptance:** before selecting the Pi runtime, map Pi, Claude Code
and Codex onto the same session lifecycle, sandbox operations, scoped Lor tools,
approval authority, activity/UI contract, accounting and checkpoint references.
Identify shared code versus adapter-specific work and compare both candidates'
maintenance cost. This is a design/source review in phase 1; building the official
provider adapters stays in phase 2.

Native authentication, resume payloads and capability limits can differ behind
that boundary. Common product/queue/storage code must not require Pi Durable's
task graph or documents. Do not rebuild an official harness's internal loop inside
Pi Durable to claim compatibility. Reject Durable if it requires a separate
product approval, UI or recovery coordinator, or complicates the other adapters. A common API
does not guarantee identical native capabilities: record unsupported behavior
honestly, while preserving Lor's required permissions and recovery guarantees.

Close these gates before selecting the final implementation dependency set:

| Gate | Current status | Acceptance evidence required |
|---|---|---|
| G0 Runtime comparison | Open; cross-harness consistency is the deciding constraint | Map Pi/Claude Code/Codex onto shared lifecycle, policy, activity and checkpoint code; reject Durable if it makes other-harness adoption harder. Compare total integration/maintenance cost and close required recovery/control gaps. |
| G1 Images | Confirmed stock prompt limitation | Native image prompt + tool-image + resume paths retain authorized content and model compatibility. |
| G2 Durable native state | Confirmed sandbox-copy / best-effort gap | Postgres-authoritative load and incremental commits; missing state fails; every required boundary blocks further dispatch until committed. |
| G3 Approvals | Reusable upstream protocol; Lor mapping open | Persist full native/envelope state, exact decisions, multiple pending calls and completed receipts; resume without unapproved/duplicate execution. |
| G4 Compaction | Native algorithm available; policy/usage/persistence open | Working notes/plan/context survive; native result and all summary usage committed; no second compactor. |
| G5 Gateway/budgets/retries | Native transport available; coverage open | Existing routing semantics and cumulative ceilings cover each actual dispatch, retry and summary; unknown usage remains explicit. |
| G6 Sandbox lifecycle | Every-chat provisioning agreed; lifecycle integration open | First run provisions an isolated sandbox for every agent chat; later runs reuse it; safe standby, ownership and explicit recovery/expiration handling preserve state. Startup allocation is not a blocker. |
| G7 Isolation/runtime | Source mechanisms available; compatibility open | No worker-local model tools, untrusted host extensions or grant bypass; actual worker runtime/dependency compatibility reviewed. |

For each unresolved gate record: current source behavior, chosen supported seam
or proposed focused change, remaining limitation, and why the alternative costs
more or weakens requirements. Resolve these decisions before implementation
slices that depend on them. No upstream PR, dependency patch or application code
is included in this documentation task.

## 5. Internal architecture and durable contract

Keep the implementation within `packages/lor` initially, with a small internal
`session-core/` (or equivalent) boundary. Do not create/publish a new package.

| Internal layer | Owns | Must not depend on |
|---|---|---|
| Session core | Runtime binding/version, lifecycle orchestration, committed cursor, native state references, typed activity, cancel/steer/resume interfaces | Lor DB schema, channel roles, brain implementation, Loop policy, UI components, global credentials or Pi Durable task/document types |
| Runtime integration | `HarnessAgent`/Pi configuration and native-state conversion; supported capabilities | Product authorization decisions or rendering |
| Injected ports | Native-state store, ownership/dispatch gate, sandbox operations, usage sink, approval decisions, resources and scoped tools | A promise to support arbitrary third-party plugins in phase 1 |
| Lor integration | Postgres transactions, queue/lease ownership, context/memory/tools, approval authority, budgets, billing and current UI mapping | A second model/tool loop |

The core may use Vercel's public types rather than duplicating every event or
schema. Keep native payloads versioned/opaque where appropriate and capabilities
explicit. This supports future extraction without designing a public SDK, CLI,
new wire protocol or second product session model now.

### Data to retain

Extend existing session/run records and add only data that cannot fit safely:

- Sticky runtime binding and exact adapter/native-format versions; product owner,
  logical workspace reference, original input/turn identity and frozen run config.
  Approval successors keep logical turn identity; worker attempts remain separate.
- Native header, entries/IDs/ancestry, active leaf and compaction state, plus the
  **complete harness continuation envelope**: pending approvals/results/batches,
  frozen turn settings and completed result receipts. None is replaced by visible
  messages or a sandbox filename.
- Immutable recovery references, expected parent/head, input/steering coverage,
  cumulative counters and per-claim writer generation. Native entry sequence is
  not `agent_run.steps`. Replayed native branches may change entry IDs; dedupe
  semantic tool calls using original runtime/call identity and source provenance.
- Common durable activity, preferably projected from native entries, including
  messages, available tools/results, file-change metadata, approvals, usage and
  terminal states. `agent_run_event` TTL data cannot be its sole source.
- Retained instruction/resource/context content and artifact references.
  Credentials are resolved afresh. Keep private history out of code exports.

Do not store an independently maintained full AI SDK transcript beside each Pi
journal. Store native entries incrementally and version control-envelope snapshots;
reference source payloads from UI projections. Keep legacy `agent_run_step`
readable. A bounded compatibility projection for existing write-back is allowed.

At a recovery boundary, atomically commit native progress/envelope, operation
receipts, activity, coverage/accounting and the new head under expected-parent
and claim-generation checks. Stage large durable payloads first. Failure stops
progress; a lost lease cannot advance the head. Before a replacement writer
uses the same workspace, fence/stop old remote processes. If termination cannot
be established, block workspace recovery. No DB check can retroactively undo an
already executed external action.

Receipts reduce replay but cannot provide exactly-once arbitrary API mutations.
Reuse current caching/approval records where suitable, add native call identity
and durable intent/result state as needed, and reconcile unknown outcomes using
provider IDs/idempotency keys. Identical arguments in two intentional calls are
not the same operation. Imported historical results never execute or bill anew.

### Required lifecycle behavior

1. Enqueue with a sticky runtime selection; claim with a generation. Existing
   session/thread, voice and Act/Loop scope rules remain authoritative.
2. Load the selected committed native state and envelope from Postgres. Reject
   missing, incompatible or corrupt state explicitly. Bind current credentials,
   permissions and scoped services without changing historical inputs. Provision
   the session sandbox on its first run or reconnect to the existing workspace;
   enforce ownership and explicit recovery if the physical sandbox is missing.
3. Commit initial/delta inputs and steering coverage before inference uses them.
   Use the selected integration's awaited gates for requests and tools.
4. Feed scoped Lor tools through harness APIs; reuse built-in remote operations.
   Use upstream approval suspension/continuation; persist the complete native
   state and settle active work before releasing the worker and sandbox
   connections. No lease is held while waiting for a user; standby may retain the
   workspace for the continuation.
5. Let Pi compact/retry within Lor's allowed budget. Commit native compaction and
   usage before its context is used by another request. A hard stop prevents
   further dispatch; partial output and unknown effects remain distinguishable.
6. Publish the completed user-turn boundary and final Lor message. Preserve the
   worker answer/write-back phase so recovery does not regenerate a finished
   answer or duplicate memory effects.

A stopped process may lose an in-flight generation; recovery resumes from a
committed boundary, not an exact token-stream freeze. Do not confuse that limit
with permission to lose completed tools or committed conversation state. Do not
label approval pauses or failed/budget-stopped iterations as completed turns.

## 6. Repository implementation map

| Current code | Preserve / change |
|---|---|
| `packages/lor/src/index.ts`, `run.ts` | Extract scoped setup and UI callbacks; separate legacy transcript recovery from native runtime/envelope references; persist the final assistant message even when its iteration has no tool calls. |
| `packages/lor/src/brain.ts`, `compaction.ts`, `plans.ts` | Retain brain, retrieval, write-back, notes requirements and authoritative plan state. Pi path uses native compaction; legacy path retains its existing implementation. |
| `packages/lor/src/models.ts`, `usage.ts` | Preserve model/routing and credit semantics; adapt to existing native provider hooks and capture auxiliary usage. |
| `packages/lor/src/tool-guard.ts`, `approval-policy.ts` | Keep grants, targets, output limits and exact execution context. Map to harness approval APIs; strengthen receipts only where required. |
| `apps/worker/src/lib/agent-run.ts`, `run-continuation.ts` | Native dispatch, generation fencing, guarded progress/accounting and fresh-process restore; retain legacy readers. |
| Worker `jobs/lor-respond.ts`, `voice-request.ts`, `lib/run-queue.ts` | Preserve queued successors, stop/steering, approval resumes, voice limits and answer/write-back phases. |
| Realtime `services/lor.ts`, API `lib/scope-runs.ts`, Lor `act-runs.ts`, `agent-sessions.ts` | Audit every run producer; bind provisional Act runs to their eventual session before native state creation. |
| API `routes/v1/approvals/handlers.ts`, DB approval schema | Preserve resolver checks, plan/voice rules and resolution/enqueue idempotency; reconcile pending-set presentation. |
| `packages/db/src/schemas/agent-sessions.ts`, `agent-runs.ts` | Add minimum native/envelope/receipt/activity storage and runtime references without replacing legacy history. |
| `packages/lor/src/sandbox/{blaxel,workbench,code-session}.ts`, `code.ts`, artifact services | Thin remote operation bridge, sandbox binding for every agent chat, standby/expiration handling and process fencing; reuse artifact/Git helpers. No silent unhealthy-sandbox recreation or output-directory reset that destroys session work. |
| Shared session/realtime types and current web/mobile consumers | Preserve events, approvals, tool details and files; expose only supported commands/resources. Current editor slash actions remain distinct. |

Retain existing connector/MCP wrappers rather than simultaneously migrating them
to Pi-native MCP. Preserve permissions, cancellation, per-tool context and cleanup.
Remove obligatory child coding/artifact dispatch only after equivalent primary
capabilities exist. Optional child delegation retains its own usage and recovery
requirements; it does not justify a second default session architecture.

## 7. Implementation slices — all within phase 1

Keep enrollment off until required gates close. The first slice is a bounded
integration decision, not approval to build every candidate workaround.

### 1.1 — Select the minimum integration and close contract gates

- [ ] Reconfirm exact adapter/Pi/AI SDK versions and worker runtime compatibility.
- [ ] Complete G0, including Pi Durable's native task/storage model, before
  committing to coding-agent adapter repairs or a custom durability layer.
- [ ] Map all three harnesses to shared product/coordinator code and record
  provider-specific work. Reject a Pi choice that complicates Claude Code/Codex
  adoption; do not implement the later-phase adapters in this slice.
- [ ] Resolve G1–G7 for the selected runtime using §4. Record candidate upstream changes
  separately from shipped APIs and accepted product tradeoffs.
- [ ] Select native-state/persistence and request-gating surfaces before schema or
  engine implementation. Preserve upstream approvals/replay and native compaction.
- [ ] Define the internal core/ports and versioned lifecycle contract. Record why
  any direct-SDK fallback is necessary; do not prebuild two implementations.

Exit: concrete integration decision, complete list of focused changes still
needed, and no claim that unmodified stock APIs already meet Lor's guarantees.

### 1.2 — Add native state and explicit dispatch

- [ ] Add only required schema/references from §5; preserve legacy defaults/readers.
- [ ] Implement expected-head/claim-generation transactions, source deduplication,
  native/envelope storage and operation/accounting identity.
- [ ] Separate legacy/Pi resume and sticky enrollment selection. Missing native
  data fails explicitly; flags cannot change the engine of an existing run.

Exit: storage/code review covers owner isolation, atomic coverage/counters/head
updates, retained payloads and version rejection. No destructive history rewrite.

### 1.3 — Integrate the selected adapter and existing Lor services

- [ ] Extract context/tool setup from `respond`; keep the legacy path during rollout.
- [ ] Wire scoped tools, exact execute context, output limits, image paths, existing
  Gateway transport/configuration and current event/result consumers.
- [ ] Reuse harness approval/continuation APIs with Lor policy and durable decisions.
- [ ] Integrate native compaction, retries, steering and stop with the approved
  persistence/dispatch/accounting boundaries. Keep auxiliary services unchanged.

Exit: source review follows every request/tool/summary through permission,
accounting and durability gates, including cold approval resume and final text.

### 1.4 — Attach remote workspace operations and scoped resources

- [ ] Implement the thin Blaxel operations bridge using the selected supported
  tools; provision a sandbox on the first run of every agent chat and reconnect
  to its workspace on later runs, independent of chat type or harness.
- [ ] Preserve stable workspace identity, artifacts, checkout/publish policy,
  process fencing and explicit missing-workspace handling. Release connections
  at safe boundaries; review expiration/replacement against retained state.
- [ ] Supply scoped, versioned skills and supported commands through existing
  resource APIs. Keep editor actions, Lor product commands and runtime commands
  distinct; no untrusted host extension discovery.
- [ ] Replace mandatory child dispatch only after primary capability coverage.

Exit: every agent chat has an isolated sandbox from its first run, with reuse and
safe standby/recovery. Execution tools cannot access worker files or bypass Lor
tool/credential policy. Further allocation cost optimization is deferred.

### 1.5 — Wire producers and durable activity

- [ ] Audit every production `agentRun` insert and `respond` caller, including
  voice, Loops, Act, approval successors and provisional scope adoption.
- [ ] Project completed semantic history from retained native/envelope sources
  with stable origin IDs; token deltas remain transient.
- [ ] Preserve current web/mobile tool, memory, plan, approval and message
  behavior; add only required capability/resource discovery and invocation.

Exit: no Pi run enters a legacy continuation reader, and completed history does
not disappear when transient stream rows expire.

### 1.6 — Enroll, review and document

- [ ] Start with new internal sessions; drain legacy runs/approvals on legacy.
- [ ] Support explicit old-session import only at an idle boundary without pending
  approvals/unknown effects, using authorized context and native-supported import
  or an explicitly labeled bootstrap. Passing a full messages array to
  `HarnessAgent` does not import that history. Keep provenance and old records.
- [ ] Expand enrollment after gates/review close. Keep existing Pi sessions on a
  compatible Pi build during rollback; never silently downgrade their native state.
- [ ] Update as-built harness/context/artifact/approval docs only as code ships,
  and mark phase-1 checklist items individually. Later-phase work remains planned.

Exit: the shared primary path preserves Lor controls, native recovery and activity;
workspace restore limits remain explicit until coordinated Git checkpoints ship.

## 8. Verification, rollout and record

No tests, ad hoc test scripts, smoke/eval commands, browser test harnesses or
`pnpm run validate`, per repository policy. This revision is based on source and
documentation review, not runtime proof. For later implementation use focused
code/SQL review, lint, type checking and builds that do not execute tests. Inspect
scripts before invoking aggregate tasks.

Record code references for each gate and trace normal/failure/recovery paths:
input/steering deduplication; images; multiple approvals; uncertain side effects;
compaction/retry usage; stop/lease loss; stale workspace processes; final text-only
output; event expiry; every run producer; and cold restore with no local native
files. A successful ordinary chat does not establish these guarantees.

Deploy additive schema before compatible workers/API/realtime, keeping enrollment
off while incompatible versions are mixed. `db:push` is a mutation, not validation;
prepare/review the schema diff and intended target before deployment. Do not run
it as part of this documentation task.

Observe normal internal use for stuck runs/approvals, missing usage, persistence
failures and workspace recovery blocks. Disable new enrollment on regression;
pause affected Pi execution separately when needed. Preserve native data and a
compatible reader/build. No automatic fallback to fresh history.

| Record | Status |
|---|---|
| Initial adapter review | Completed for coding-agent path; Pi Durable was omitted, so runtime selection is reopened. |
| Pi Durable comparison (G0) | Preliminary `1.3.0` source review recorded; full Lor compatibility comparison outstanding. |
| Every-chat sandbox decision | Agreed 2026-10-19; replaces zero-allocation plain-chat requirement. Provision on first run, reuse and allow standby; optimize costs later. |
| Integration gates G1–G7 | Findings recorded; implementation solutions not yet validated. |
| Implementation slices 1.1–1.6 | Not started. |
| Upstream changes / SDK publication | None submitted; publishing deferred. |

[pi-doc]: https://ai-sdk.dev/providers/ai-sdk-harnesses/pi
[harness-doc]: https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent
[gateway-options]: https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
[blaxel-lifecycle]: https://blaxel.ai/blog/understand-the-lifecycle-of-a-blaxel-sandbox
[durable-post]: https://earendil.com/posts/pi-durable/
[durable-package]: https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.3.0.tgz
[pi-package]: https://registry.npmjs.org/@ai-sdk/harness-pi/-/harness-pi-1.0.158.tgz
[harness-package]: https://registry.npmjs.org/@ai-sdk/harness/-/harness-1.0.156.tgz
[coding-package]: https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.0.3.tgz
[ai-package]: https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-1.0.3.tgz
[utils-package]: https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-5.0.63.tgz
