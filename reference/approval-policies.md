# Approval policies (LOR-81 / LOR-83) — execution runbook

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 2 of `reference/planned/self-configuration.md`. Approval moves
from prompt etiquette to execution physics: the run harness pauses gated tool
calls, policy says which tool targets are gated and who may resolve, and
resolver authority is written in the pillar-1 vocabulary
(`reference/custom-roles.md`).

## Current architecture (2026-10-15)

Approval rules now target individual tools, matching connector and profile tool
selection. Tool access and approval remain independent: a policy never enables
an otherwise disabled tool.

- Built-in tools: `tool:<reviewed_name>` (connector tools plus the individual web
  and artifact tools). Core messaging, memory, and run bookkeeping stay ungated.
- Custom HTTP tools: `custom_tool:<uuid>`, unchanged in granularity.
- Custom MCP tools: `mcp_tool:<server_uuid>:<encodeURIComponent(tool_name)>`.
  Names are scoped to their server, encoded canonically, and never form a
  whole-server rule. A rename is a different tool identity.
- Settings show one row per service (Web, Artifacts, each connector, API
  tools, each MCP server) with an "N of M need approval" summary. A row opens
  to the same Read/Write checklist as tool settings: a checked tool needs
  approval, and a group checkbox gates or clears the whole group. A gated
  tool's row shows its approver picker. MCP groups trust only provider Read
  only hints; API tools have none. Hints do not bypass approval.
- Every change goes through one atomic `PUT /approval-policies/bulk` request
  with explicit keys, applied optimistically in the cache. Enabling preserves
  existing resolvers and assigns Any member only to new rules. New tools never
  inherit a group rule.
- Connectors that aren't connected sit in a separate "Not connected" section;
  their rules still save and apply once connected. MCP choices use saved
  enabled names and metadata; listing policies performs no MCP handshakes.
  Missing/disabled tools and unsupported keys appear under "Unavailable rules"
  for explicit removal.
- Single saves, bulk saves, and approved configuration proposals verify workspace
  ownership and MCP enabled names. A new MCP server has no discovered tools yet,
  so proposals may gate its tools only after connection and tool review. Created
  references for approval rules now point only to custom HTTP tools.
- Main runs, bulk-export restrictions, background archive reads, and voice use
  individual target identities. Approved continuations persist tool name and
  target, including crash recovery, and refuse execution if the bound source
  changed or the tool became unavailable. SDK input/signature checks remain.
- Capability groups are gone entirely: the `lor_capability` enum, `grants_all`
  and `agent_profile_custom_tool` are removed. Profiles hold all tool access in
  `tool_access` (built-in web/artifacts, connectors, MCP servers, API tools),
  where a missing entry follows the workspace. See `connector-tools.md`.

### Breaking rollout

Once per environment, in this order:

1. Stop the API and workers.
2. Preview, then run
   [`migrate-tool-access.ts`](../packages/db/src/scripts/migrate-tool-access.ts):
   `pnpm --filter @repo/db exec tsx src/scripts/migrate-tool-access.ts --dry-run`,
   then the same command without `--dry-run`.
3. `pnpm db:push` (it should find nothing left to change for this work).
4. Deploy the API, web and workers together.
5. Recreate the approval rules you want, per tool, in Settings → Approvals.

The script moves each profile's old web, artifacts and API tool grants into
`tool_access` (kept grants follow the workspace; missing ones become off or a
custom API tool list), rewrites pending profile proposals the same way, then
drops `capabilities`, `grants_all`, `agent_profile_custom_tool` and the enum. It
deletes old capability and whole-MCP approval rules, expires pending approvals
for those keys, and moves their plans to `waiting_for_input`. One transaction,
safe to rerun. Approval rules get no automatic conversion. Historical
approval/run records stay intact.

Old parked actions start a fresh request; old target keys cannot authorize an
approval resume. Policy rows whose key no longer parses (for example a renamed
catalog tool) are skipped with a warning and listed under Unavailable tools for
removal. MCP rules for temporarily disabled names remain inert and take effect
again if those names are re-enabled.

Validation is focused review, lint, and type checking/builds. No test suites,
evals, browser harnesses, or authenticated provider mutations are run.

The original rollout and implementation history below describe the earlier
group-based model; this section supersedes those target/group details.

## Historical starting state (verified 2026-08-31)

- **Approval is prompt discipline today.** `taskRulesSection`
  (`packages/lor/src/tasks.ts:242`) *instructs* the model to call
  `request_approval` before consequential writes. Nothing enforces it — a run
  can call `create_linear_issue` directly and it executes.
- **`approval` table exists** (`packages/db/src/schemas/approvals.ts`):
  `workspaceId`, `taskId` (nullable), `runId` (audit), `action` (free-text
  slug), `description`, `payload` (jsonb, **declared but never written**),
  `status` (`pending|approved|rejected|expired`), `resolvedBy/At`. Partial
  unique index: one pending approval per task.
- **Single producer**: the `request_approval` tool (`tasks.ts:156`) — task
  runs only. It inserts the row, parks the task `waiting_for_approval`, and
  trips a flag so `prepareStep` forces `toolChoice: "none"` (same mechanism as
  budget ceilings, `packages/lor/src/index.ts:2261`). **The run ends
  cleanly; no lease waits on a human.**
- **Resolution** (`POST /v1/approvals/:id/approve|reject`, routes live in
  `apps/api/src/routes/v1/tasks/`): CAS-resolve the row → post "✅ Approved…"
  into the task thread AS the resolver → `startTaskContinuationRun`
  (`apps/api/src/lib/task-runs.ts:146`). The gate is **channel write access
  only** — `resolveChannelAccess`, no authority check; the handlers run under
  `sessionAuthMiddleware`, so `c.var.authority` is not populated there.
- **`approval: ["resolve"]` statement is reserved and inert**
  (`packages/auth/src/lib/workspace-statements.ts:11`; owner/admin hold it,
  member does not; excluded from the roles-UI matrix). Zero enforcement reads
  it. This runbook is where it becomes real.
- **Tool gating today is capability-only**: `resolveChannelCapabilities` →
  spread-gated `builtinTools` (`packages/lor/src/index.ts:1883–1908`),
  custom tools + MCP bound after. No approval hook anywhere;
  `streamText`'s `toolApproval` is unused in the repo.
- **`SIDE_EFFECT_TOOLS`** (`packages/lor/src/tool-guard.ts:12`) is the
  existing census of externally-visible tools (replay-dedup, not approval).
- **Pre-built seam for code publish**: `authorizePublish` in
  `packages/lor/src/code-actions.ts:44` hardcodes `"publish"`; the
  `prepareCodeChange`/`publishCodeChange` split
  (`sandbox/code-session.ts:317`) exists so an approval can sit between them.
- **Continuation replay is byte-identical** (`reference/agent-harness.md`):
  transcript = run `context` + `agent_run_step` rows; `replayChain` walks
  `continuedFromRunId`; the prefix is deliberately byte-stable (prompt cache).
  This is exactly the property `toolApproval`'s stateless resume requires.
- **No approval realtime event, no push.** Task approval cards go live only
  via `task:updated` → query invalidation (`use-channel-tasks.ts`). Loops,
  triggered runs, and channel runs have no approval surface at all.
- **LOR.md is separate machinery** (`workspace_instructions` version rows) —
  stays separate; do not merge.

### Verified AI SDK mechanics (`ai@7.0.11`, LOR-13, 2026-08-31)

- `toolApproval` on `streamText`: per-tool functions or a generic catch-all;
  receives input, `toolCallId`, `messages`, tool context. Statuses:
  `not-applicable` / `approved` / `denied` / `user-approval`.
- On `user-approval` the loop emits a `tool-approval-request` part instead of
  executing and the stream ends. Resume is **stateless**: append a
  `tool-approval-response` message and call again with the same prefix — no
  `@ai-sdk/workflow`, no waitpoint. Our end-run + continuation-run pattern is
  already this shape.
- `experimental_toolApprovalSecret` (≥32 bytes, shared env across workers)
  HMAC-binds the approval to the exact tool name + call id + input,
  fail-closed, and re-evaluates the policy function on resume. The approved
  input executes verbatim — the model cannot swap arguments after approval.

## Locked decisions (Jacob, 2026-09-01 — do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Gate unit | **Individual tool**: `tool:<name>`, `custom_tool:<id>`, `mcp_tool:<server_id>:<encoded_name>`. Read/Write are bulk-selection conveniences. Core messaging/memory remain ungated. Supersedes the 2026-09-01 coarse groups. |
| Policy storage | **Computed, own table.** `approval_policy`: a row exists only where the workspace opted in — row existence = gate ON; delete the row to turn it off. No `required` column, no seeding, no backfill when new connectors land. The settings UI renders the full target list from the registry and overlays existing rows. |
| Defaults | **Everything off.** Out of the box Lor behaves exactly as today; every gate is an explicit admin opt-in. No default-on connector writes, no default-on code publish. |
| Resolver spec | Per policy row: `role` (static or custom role name) · `user` (specific person) · `any_member` (channel write access, today's behavior); **teams join as a resolver kind once they exist**. ~~`permission` kind~~ REMOVED 2026-09-02 (Jacob: a blanket approvals permission is hacky — resolvers are named per gate, never granted). Column default `any_member` — pre-filled when a gate is enabled. **Owner always resolves** (escape hatch — a named resolver may have left). Channel write access stays the floor for every kind. |
| No underlying-permission matching | Resolver authority never fragments across an approval's subject matter (Jacob: no "5 of 6 approvals" splits) — a resolver named on a gate approves that gate, full stop. The `approval` statement now carries only `manage` (the settings page); `resolve` was removed with the permission kind. |
| `request_approval` stays | The discretionary tool remains (model judgment for un-modeled risks), same row shape + surfaces, target null. Resolver: **any channel member**, not policy-configurable in v1 (the model asked for *a* human, any human answers). |
| Pause mechanics | Reuse the park pattern: policy gate returns `user-approval` → the approval row (with `toolCallId`, `toolName`, `target`, raw input in `payload`) is filed by `respond()` **after the post-loop checkpoint sweep** (the parked step must be durable first; not the same transaction — see 2026-09-02 deviation) → run ends cleanly (`stopReason: "awaiting_approval"`), and only if the row was actually filed. Task runs also park the task `waiting_for_approval` (unchanged). Non-task runs park on the run row alone. |
| Resume mechanics | Approve/reject → continuation run in the same scope. `run-continuation.ts` gains an approval branch: predecessor ended `awaiting_approval` + resolved row → replay chain + append the `tool-approval-response` (approved/denied) + normal delta. Approved → the tool executes with the HMAC-bound input; denied → the model gets the denial and explains/adjusts. The human-readable "✅ Approved…" thread message stays (audit trail + delta trigger). |
| Resolution authority enforcement | Resolve handlers get the workspace-auth treatment: first statement resolves authority (`resolveWorkspaceAuthority` — routes stay on `sessionAuthMiddleware`) and checks `canResolveApproval(authority, spec, userId)`. |
| One pending per run | Partial unique index on `approval(run_id) where status='pending'` joins the existing per-task one. A run parks at its first gate; never a second pending gate for the same run. |
| Realtime | Channel-room events `approval:created` / `approval:updated` carry **ids only** (approvalId/channelId/taskId/status) and just invalidate the channel-approvals query — cards load through `GET /channels/{id}/approvals` (see P4 as-built). Task card liveness via `task:updated` stays. |
| Surfaces | Generalize the task-thread `ApprovalCard`: render pending approvals on ANY run placeholder (channel, thread, loop, triggered), fed by the durable `GET /channels/{id}/approvals` query; `approval:*` events only invalidate/refresh it. Buttons only for users who pass the resolver spec (server enforces regardless). |
| Push (LOR-83) | `sendApprovalPush` mirrors `sendInstructionsProposalPush`: data-only deep link to the channel/thread, sent to the resolver set (for `any_member`, cap to the run's channel members), presence-checked at send time — push is the offline complement of the socket notification (P5 as-built). Never resolve from the push. |
| Policy UI | Settings dialog section (near Agent profiles): full target list computed from the registry — capabilities, this workspace's custom tools and MCP servers — each with an on/off switch + resolver picker. Gate the section like billing (owner/admin). |
| Env | `LOR_TOOL_APPROVAL_SECRET` (≥32 chars, **optional**) in `packages/env` serverSchema — worker + API share it. Optional so deploys don't break; P2 decides unset behavior (gates still enforce, secret hardens the binding). Optional → no `TEST_ENV` mirror needed. |
| Out of scope | Per-channel/per-profile policy overrides; per-tool granularity inside a capability; resolver customization for discretionary approvals; seeded policy rows; approval expiry/timeouts (enum value exists, unused); Lor proposing policy changes (pillar 3); LOR.md flow changes; batch/multi-gate approvals; forced sandbox-cost gate (`code_intelligence` is gateable generically if a workspace opts in). |

## Spike results (verified against `ai@7.0.11` dist, 2026-09-01)

All four spike items resolved by reading the installed SDK source. Two of the
findings change the design; they are folded into the steps below.

- **Parked step in the transcript** ✅ `toResponseMessages` pushes
  `{type:'tool-approval-request', approvalId, toolCallId, isAutomatic?,
  signature?}` into the assistant message of `step.response.messages`, so our
  existing `checkpointStep` persists it with **no change**. The part is
  stripped before the provider call (`convertToLanguageModelMessage` filters
  it), so it costs no tokens and cannot disturb the cached prefix.
- **Mixed step** ✅ Ungated sibling calls in the same step **do execute** — the
  approval check runs per `tool-call` chunk and only the gated one is withheld
  from `toolCallsToExecute`. A parked step can therefore carry real side
  effects; the checkpoint records them normally, and the UI must not imply
  "nothing happened".
- **How the loop ends** ✅ (new) The continuation predicate is
  `clientToolCalls.length === clientToolOutputs.length +
  deniedToolApprovalResponses.length`. A `user-approval` call satisfies
  neither, so the stream **finishes on its own with no further model call** —
  `stopWhen` is never consulted. We need no ceiling-flag trick for policy
  gates (unlike `request_approval`). Consequence: the model gets **no closing
  text**, so the approval card must carry the explanation, not model prose.
- **Compaction** ✅ Safe by construction: the park ends the stream immediately,
  so `prepareStep` (where compaction lives) never runs again in that run. On
  resume, `collectToolApprovals` runs at the very top of `streamText`, before
  any step, so the approved tool executes before compaction can touch the
  messages.
- **Tool-guard composition** ✅ The gate fires on the `tool-call` chunk, before
  `executeToolCall` reaches the wrapped `execute`. A parked call spends
  nothing and writes nothing.
- **Resume ordering constraint** ⚠️ (new, load-bearing)
  `collectToolApprovals` only inspects `messages.at(-1)` and requires
  `role === "tool"`. The continuation's message array must therefore **end**
  with the approval-response tool message — we cannot append the usual delta
  user message after it (provider tool_use/tool_result adjacency forbids it
  anyway). The human's accompanying words instead arrive through the existing
  step-boundary steering/ambient injection, which needs no new machinery.
- **Revalidation on resume** ✅ `validateApprovedToolApprovals` re-verifies the
  HMAC (throws if the secret is set and the signature is missing/invalid),
  re-validates input against the tool schema, and re-runs the policy function;
  only a `denied` result blocks. So turning a gate off while a run is parked
  still executes the approved call, and re-parking never happens.
  **Operational note:** enabling or rotating `LOR_TOOL_APPROVAL_SECRET`
  invalidates in-flight parked approvals (unsigned requests then throw) — do
  it when nothing is pending.
- **Recovery hazard** ⚠️ (new, for P3) A transcript ending in an unanswered
  approval request throws `MissingToolResultsError` if replayed without the
  response. Narrow window (worker dies between the park and the run going
  terminal). P3's continuation must detect a parked predecessor: append the
  response when a resolved row exists, otherwise fall back to a fresh context.

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked.

---

### [x] P1 — targets + schema + resolver helper (~300 LOC) — built 2026-09-01, db:push owed

- `packages/connectors`: approval-target vocabulary — `ApprovalTarget` union
  (capability / customTool / mcpServer), key format
  `capability:<key>` · `custom_tool:<id>` · `mcp_server:<id>` ·
  `approvalTargetKey` / `parseApprovalTargetKey` (validates
  capability keys against `CAPABILITIES`, excludes `custom_tools`), core
  target labels for the UI.
- New `packages/db/src/schemas/approval-policies.ts`: `approval_policy`
  (`workspaceId`, `target`, `resolverKind` enum
  `any_member|role|user` default `any_member` (was `permission|…` — see
  2026-09-02 deviation), `resolverRole`,
  `resolverUserId` set-null so a deleted named resolver fails closed to
  owner-only; unique `(workspaceId, target)`).
- `packages/db/src/schemas/approvals.ts`: `toolCallId`, `toolName`, `target`
  columns (null for discretionary); partial unique index on
  `(run_id) where status='pending'`.
- `agent_run` stop reason enum gains `awaiting_approval`.
- `packages/env`: optional `LOR_TOOL_APPROVAL_SECRET` (min 32 chars).
- `packages/auth/src/lib/permissions.ts`: `ApprovalResolverSpec` +
  `canResolveApproval(authority, spec, userId)` (owner bypass; exact match for
  `role`/`user`; `any_member` true; the `permission` kind was removed
  2026-09-02) + tests.
- **db:push owed after this step** (Jacob): `approval_policy` table, three
  `approval` columns + index, `agent_run_stop_reason` enum value.

### [x] P2 — lor gate wiring (~400 LOC) — built 2026-09-01

- `packages/lor/src/approval-policy.ts`: `loadApprovalGates` (one query,
  **deliberately uncaught** — a policy read failure fails the run rather than
  executing gated actions ungated), `ToolTargetMap`, `buildToolApproval`
  (returns `undefined` when the workspace opted into nothing, so zero
  overhead by default), `fileParkedApproval`.
- `respond()`: gates loaded alongside capabilities; tool→target mapping built
  at assembly time from the source tool sets (capability groups),
  custom tools and MCP tools by id (`messageActionTools` gating was removed 2026-09-02);
  `toolApproval` + `experimental_toolApprovalSecret` passed to `streamText`
  only when present.
- Park path: `tool-approval-request` with `isAutomatic !== true` captured from
  the stream; after the post-loop checkpoint sweep (so the parked step is
  durable first) the approval row is filed with `toolCallId`/`toolName`/
  `target`/raw input, the task parks `waiting_for_approval`, and the run trips
  `awaiting_approval` **only if the row was actually filed**.
- Plumbing: `RunHandle.runId` added (approval rows reference the run);
  `workspaceCustomTools` returns `{tools, toolIds}`; `McpServerSessions.servers`
  carries `id`; `updateTask` exported; worker's empty-answer fallback says
  "⏸️ Waiting for approval before I continue."
- Tests: `approval-policy.test.ts` (target mapping, gate selectivity —
  reads stay ungated when writes are gated, single custom tool gated alone).

Deferred out of P2 (see log): `approval:created` socket event moved to P4
with the rest of the realtime types; `authorizePublish` left as-is —
`capability:code_actions` now gates `propose_code_change` through the normal
path, making the hardcoded seam redundant rather than wrong.

### [x] P3 — resolve + resume (~450 LOC) — built 2026-09-01 (no new schema)

- Approvals routes move out of `routes/v1/tasks/` into `routes/v1/approvals/`
  (task-less approvals exist now). Handler: first statement resolves authority
  via `resolveWorkspaceAuthority` + `canResolveApproval`; channel write access
  stays the floor; CAS + resolution message unchanged. Discretionary rows
  (target null) resolve as `any_member`. **Changed 2026-10-10 (Jacob):** no
  resolution message posts any more; it read to Lor as a person's message on
  top of the approval response. The continuation answers the parked run's
  own reply (`agent_run.messageId`) with `resumeApprovalId` set: policy gates
  resume with the AI SDK `tool-approval-response` alone (the documented
  flow), and discretionary `request_approval` rows get one "Approval" line
  in the delta (`approvalDecisionTurn`). A resume queued behind an active run
  rides the queue on that reply but never shows in the queue UI. The card
  stays on the reply as the record: session pages list approvals in any
  state (`?threadRootId=`), and a resolved card shows "Approved by …" /
  "Rejected by …". Old message-less runs still get a posted resolution.
- Generalize `startTaskContinuationRun` → shared continuation starter that
  works for channel/thread/loop scopes (the harness doc already flags the
  run-creation recipe triplication — extract now).
- `run-continuation.ts`: approval branch — predecessor `awaiting_approval` +
  resolved row → replay chain + a trailing `role:"tool"` message holding the
  `tool-approval-response`. **It must be the last message** (spike finding);
  the human's accompanying words arrive via the existing step-boundary
  steering injection instead of a trailing delta. Denied path returns the
  denial to the model. Guard the recovery hazard: a parked predecessor with
  no resolved row falls back to a fresh context rather than replaying an
  unanswered tool call.
- Emit `approval:updated` on resolution. Tests: resolver-spec matrix (each
  kind × allow/deny), CAS conflict, dangling-role resolver degrades safely.

**As built.** `apps/api/src/lib/task-runs.ts` became `scope-runs.ts`:
`startScopeContinuationRun` takes a scope (`workspaceId`, `channelId`,
`scopeKey`, `threadRootId`, optional `resumeApprovalId`, optional
`onAbandoned`) and `startTaskContinuationRun` is now a thin task-flavoured
wrapper; `postTaskThreadMessage` became `postScopeMessage` and broadcasts into
the thread room or the channel room. Approvals moved to
`routes/v1/approvals/` (paths unchanged); `serializeApproval` and
`loadApprovalResolver` live in `apps/api/src/lib/approvals.ts`, and the
serialized row now carries `target` + `toolName`.

Resolution order in the handler: channel write access (the floor) → membership
→ `resolveWorkspaceAuthority` → `canResolveApproval`. A missing policy row for
a still-open approval falls back to `any_member` (the gate is off, the
action is no longer restricted); a
policy row whose named resolver is gone (custom role deleted, resolver user
removed) resolves to owner-only rather than opening up.

The resume is **explicit, not scope-inferred**: `resumeApprovalId` rides
`LorRespondJobData`, so `buildApprovalContinuation` replays the run named by
the approval row and works in a plain channel scope where the delta path does
not exist. The SDK's own `approvalId` is read back out of the replayed
transcript (`findApprovalId`) instead of being stored — it only ever exists
there, and deriving it from the same array we send is what keeps the response
and the request consistent.

Guards: the ordinary delta path now refuses any predecessor whose stop reason
is `awaiting_approval` (its transcript ends in an unpaired tool call), and
`buildApprovalContinuation` returns null — falling back to a fresh context —
for a pending approval, a non-parked predecessor, or a request part that got
trimmed out of the replay.

**New spike finding (verified against ai@7.0.11 dist, 2026-09-01):** an
approved tool executes at the top of `streamText` and its result message lands
in `initialResponseMessages`, which is **outside every step's
`response.messages`**. Checkpointing steps alone would persist a tool call with
no result and break every later replay. `prepareStep` now folds
`responseMessages` into `pendingInjected` at `steps.length === 0`, so the
result rides the first checkpoint. Also confirmed: the prompt converter drops
`tool-approval-request`/`-response` parts before the provider and filters the
resulting empty tool message, and `approvedToolCallIds` lets an
approval-response stand in for a missing tool result during the
`MissingToolResultsError` pairing check.

### [x] P4 — web surfaces (~450 LOC) — built 2026-09-02

- `approval:created/updated` in `packages/realtime-types` + realtime relay.
- Generalized `ApprovalCard` on any parked run placeholder (channel + thread),
  fed by run trail replay + live events; task-thread header keeps its card.
- Buttons gated by a `canResolveApproval` mirror (custom roles via
  `use-workspace-roles`); non-resolvers see who can resolve.
- Policy settings UI: computed target list (capabilities + this workspace's
  custom tools and MCP servers + core messaging), on/off switch + resolver
  picker (any member / role incl. custom / person). Gate the
  section like billing (owner/admin).
- Roles matrix: expose the `approval: manage` action (policy CRUD gate;
  `approval: resolve` was removed 2026-09-02 with the permission resolver
  kind — resolvers are named per gate, never granted).

**As built.** New statement action `approval: manage` (admin/owner inherit via
the grants spread; custom roles can be granted it in the matrix) gates the
policy CRUD: `routes/v1/approval-policies/` (GET list returns policy rows +
the computed target list; PUT upserts by target with resolver validation —
id-shaped targets must belong to the workspace, named resolvers must exist;
DELETE by policy id). Targets are listed regardless of connection state — a
gate on a disconnected connector is inert, not invalid.

Card data path (deviation from the run-trail sketch): a durable
`GET /channels/{id}/approvals` query (pending gated approvals joined to their
run's messageId/threadRootId, resolver spec + resolver user name attached) +
id-only `approval:created`/`approval:updated` events that just invalidate it.
`approval:created` is emitted by the worker only after the run is terminal —
the resolve endpoint refuses a run that hasn't finished parking.
`ApprovalGateCard` (components/chat/approval-card.tsx) is the one card: task
header keeps it, and `MessageApprovalCard` hangs it under any run reply
(`lorTriggerMessageId` marks those live and on reload). Buttons are gated
by the shared `canResolveApproval` (authority built client-side from active
member + ownerId + custom-role grants); non-resolvers see who can resolve.
`getTask.pendingApproval` was enriched with `resolver`/`resolverUserName` so
the task card gates identically. The resolve mutation moved from use-task to
use-approvals. Settings section "Approvals" is nav-gated at the billing tier
(admin/owner) — a custom role holding `approval:manage` can hit the API but
won't see the nav item; cosmetic, logged below.

### [x] P5 — push + mobile (LOR-83) (~350 LOC) — built 2026-09-02

- `sendApprovalPush` in `packages/messaging` (resolver set, data-only deep
  link to channel/thread).
- Mobile: generalized approval card in channel/thread (reuse task card
  pattern); resolver gating degrades member-tier without custom-grant data
  (server enforces; gap noted in `reference/mobile-parity-todo.md`).
- Update `reference/mobile-parity-todo.md`.

**As built.** Fan-out rules locked with Jacob (2026-09-02), implemented in
`apps/worker/src/lib/approval-notify.ts`: with E = the eligible resolver set
(owner fallback when empty/dangling) and R = the run's trigger author (null
for loops/triggered runs) — R ∈ E → ping only R immediately and schedule a
2-minute escalation (BullMQ delayed job on the maintenance queue) that
re-checks the row and pages E∖{R} only if still pending; R ∉ E → ping E
immediately plus a "waiting on <resolver>" notice to R; no R → ping E
immediately. `any_member` never pages beyond R — the in-channel card and the
run's own message are the surface. Each ping is one surface per person:
user-targeted `notification:approval` socket event (web/desktop render the OS
notification client-side via `use-browser-notifications`, wording shared
through `buildApprovalNotificationContent` in realtime-types) and
`sendApprovalPush` (packages/messaging) for the offline complement —
presence-checked at send time, deliberately no mute/settings filtering
(directed, rare). The push's `type: "approval"` data deep-links through
mobile's existing message target.

Mobile: `dynamicAccessControl` enabled in the auth client, new
`use-workspace-roles` + `use-approvals` hooks (query keys mirror web),
shared `ApprovalGateCard`/`MessageApprovalCard` (task header + any parked run
reply in `message-row.tsx`), channel + thread screens mount the live query.
Mobile approval buttons now gate on real custom-role grants.

### [ ] P6 — validation sweep + live QA

Manual QA checklist (live, after db:push):
1. Fresh workspace, no policy rows: Lor creates a Linear issue with NO
   gate (defaults-off regression check).
2. Enable `Write to Linear` gate → same ask parks the run; approval card
   appears; `approval:created` observed.
3. Approve as admin → continuation run executes the EXACT bound input; trail
   shows the gate.
4. Reject → model acknowledges, does not retry the same call blindly.
5. Resolver `role: support` (custom role) → member without the role sees the
   card but no buttons, direct POST 403s; role holder resolves; owner can
   always resolve.
6. Turn a gate off while its approval is pending → any member can still
   resolve the stale card (gate-off fallback).
7. Non-task gate: a capability gate tripped by a plain channel @Lor (no
   task) → parks and resumes in channel scope.
8. MCP server gate: one switch parks any tool from that server.
9. Turn a gate off (delete row) → next run executes ungated.
10. Discretionary `request_approval` still round-trips; any member resolves.
11. Push received by resolver on device; tap deep-links to the thread; a card
    already resolved elsewhere shows resolved state (CAS 409 path).
12. Crash-recovery: kill worker mid-parked-run creation → dead-run sweep +
    approval row consistency (no orphan pending rows blocking the scope).

## Decisions & deviations log

- 2026-08-31 — Runbook drafted from verified current-state map (approval
  machinery, harness replay, AI SDK toolApproval).
- 2026-09-02 — `permission` resolver kind + `approval:resolve` grant REMOVED
  (Jacob: "feels hacky and unnecessary" — resolvers are a member, a role, or
  a future team, never a blanket permission). Enum is now
  `any_member|role|user` with column default `any_member` (free edit: db:push
  had not run). Fallbacks updated everywhere: gate deleted while pending →
  `any_member` (the action is no longer gated); dangling named resolver →
  owner-only, unchanged. `approval: ["manage"]` stays (ordinary
  settings-management vocabulary). Worker fan-out lost its permission-holders
  audience branch; the settings picker is now Any member / roles / people.
- 2026-09-02 — P5 deviations: notification fan-out is requester-aware with a
  2-minute escalation (Jacob's design — see P5 as-built), not a flat
  "push the resolver set". The `instructions-proposal` push remains
  presence-independent while approval pushes are offline-only — inconsistent,
  left as-is deliberately. Mobile custom-role grants are fetched for approval
  cards only; moderation/channel-permission hooks still degrade to member
  tier (tracked in mobile-parity-todo).
- 2026-09-02 — `core:messaging` target REMOVED entirely (Jacob: "no one
  should have to approve this" — messaging is the core product). The
  ApprovalTarget union has no core kind, `messageActionTools` stays unmapped,
  and the policy page has no Core actions group. No schema impact (no rows
  existed; db:push still pending).
- 2026-09-02 — Queue-ride resume fix (CodeRabbit review): new
  `agent_run_queue.resume_approval_id` column (db:push owed) — an approval
  resolved while its scope is busy rides the queue, and the completion drain
  now forwards the resume into the follow-up job so the parked transcript
  replays instead of degrading to a fresh-context re-ask.
- 2026-09-02 — Doc reconciliation (CodeRabbit review): the locked-decision
  table now matches shipped behavior — the approval row is filed by
  `respond()` after the checkpoint sweep, not inside the checkpoint
  transaction (durability ordering: parked step first, then the row, then
  `awaiting_approval`); realtime events are id-only invalidations; approval
  pushes are presence-checked at send time; the policy UI target list has no
  core messaging group.
- 2026-09-02 — P4 deviations: cards are fed by a channel-approvals query +
  invalidation events, not run-trail replay (simpler, survives reload, no
  per-card socket state). `approval:created` carries ids only. New
  `approval:manage` statement action added to the P1 vocabulary — policy CRUD
  needed its own gate and "like billing" had no statement to mirror. Settings
  nav visibility stays admin-or-owner (matrix-granted `approval:manage`
  custom roles reach the API but not the nav item — fix opportunistically).
- 2026-09-01 — P3 deviations: `approval:updated` landed here (P4 keeps
  `approval:created` and the UI); its payload is scope-shaped
  (`approvalId`/`channelId`/`taskId`/status), emitted to the channel room. The
  shared continuation starter was generalized as planned, and the file was
  renamed `task-runs.ts` → `scope-runs.ts` to stop the name lying. Resolver
  enforcement is API-side only for now — the web still shows the buttons to
  everyone until P4 mirrors `canResolveApproval` in the UI. `AgentRunContext`
  gained `approvalResume` (no migration: it is a jsonb field).
- 2026-09-01 — P2 deviations: the `approval:created` socket event moved to P4
  (its types and relay live there; the task path already goes live via
  `task:updated`). `authorizePublish` left in place — the generic
  `capability:code_actions` gate now covers `propose_code_change`, so the
  hardcoded seam is redundant, not wrong; deleting it is P4-or-later hygiene.
  Approval rows are filed by `respond()` (matching `request_approval`'s
  existing pattern) rather than by the worker, so the row is durable even if
  the worker dies before settling the run.
- 2026-09-01 — Jacob locked all open decisions: policy home = own
  workspace-level table; storage = computed (rows only for opt-ins, row =
  gate on); defaults = EVERYTHING off, explicit opt-in only (rejected
  default-on connector writes); gate unit = coarse per-capability + per
  custom tool + per MCP server + core messaging; discretionary
  `request_approval` resolver = any member; no forced sandbox gate;
  `approval:resolve` is a blanket permission with no underlying-permission
  matching (no fragmented "5 of 6" approvals).
