# Approval policies (LOR-81 / LOR-83) — execution runbook

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 2 of `reference/self-configuration.md`. Approval moves
from prompt etiquette to execution physics: the run harness pauses gated tool
calls, policy says which tool targets are gated and who may resolve, and
resolver authority is written in the pillar-1 vocabulary
(`reference/custom-roles.md`).

## Current state (verified 2026-08-31)

- **Approval is prompt discipline today.** `taskRulesSection`
  (`packages/merlin/src/tasks.ts:242`) *instructs* the model to call
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
  budget ceilings, `packages/merlin/src/index.ts:2261`). **The run ends
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
  spread-gated `builtinTools` (`packages/merlin/src/index.ts:1883–1908`),
  custom tools + MCP bound after. No approval hook anywhere;
  `streamText`'s `toolApproval` is unused in the repo.
- **`SIDE_EFFECT_TOOLS`** (`packages/merlin/src/tool-guard.ts:12`) is the
  existing census of externally-visible tools (replay-dedup, not approval).
- **Pre-built seam for code publish**: `authorizePublish` in
  `packages/merlin/src/code-actions.ts:44` hardcodes `"publish"`; the
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
| Gate unit | **Coarse: one switch per capability** (`capability:<merlin_capability>` — every capability is targetable, reads included; "Linear writes" is one switch covering all three write tools). Plus **per custom tool** (`custom_tool:<id>`), **per MCP server** (`mcp_server:<id>` — one switch covers everything the server exposes), and one core target `core:messaging` (Merlin posting/reacting in channels). The `custom_tools` *capability* is grant vocabulary, not an approval target — individual tool/server rows replace it here. No per-tool granularity inside a capability. |
| Policy storage | **Computed, own table.** `approval_policy`: a row exists only where the workspace opted in — row existence = gate ON; delete the row to turn it off. No `required` column, no seeding, no backfill when new connectors land. The settings UI renders the full target list from the registry and overlays existing rows. |
| Defaults | **Everything off.** Out of the box Merlin behaves exactly as today; every gate is an explicit admin opt-in. No default-on connector writes, no default-on code publish. |
| Resolver spec | Per policy row: `permission` (anyone whose authority grants `approval: ["resolve"]` — owner/admin/custom roles; the reserved statement's enforcement point) · `role` (static or custom role name) · `user` (specific person) · `any_member` (channel write access, today's behavior). Column default `permission` — pre-filled when a gate is enabled. **Owner always resolves** (escape hatch — a named resolver may have left). Channel write access stays the floor for every kind. |
| No underlying-permission matching | `approval:resolve` is a **blanket** grant. Approving a Linear write requires no Linear/connector permission — resolver authority never fragments across an approval's subject matter (Jacob: no "5 of 6 approvals" splits). |
| `request_approval` stays | The discretionary tool remains (model judgment for un-modeled risks), same row shape + surfaces, target null. Resolver: **any channel member**, not policy-configurable in v1 (the model asked for *a* human, any human answers). |
| Pause mechanics | Reuse the park pattern: policy gate returns `user-approval` → persist the approval row (with `toolCallId`, `toolName`, `target`, raw input in `payload`) in the same checkpoint transaction that persists the approval-request step → run ends cleanly (`stopReason: "awaiting_approval"`). Task runs also park the task `waiting_for_approval` (unchanged). Non-task runs park on the run row alone. |
| Resume mechanics | Approve/reject → continuation run in the same scope. `run-continuation.ts` gains an approval branch: predecessor ended `awaiting_approval` + resolved row → replay chain + append the `tool-approval-response` (approved/denied) + normal delta. Approved → the tool executes with the HMAC-bound input; denied → the model gets the denial and explains/adjusts. The human-readable "✅ Approved…" thread message stays (audit trail + delta trigger). |
| Resolution authority enforcement | Resolve handlers get the workspace-auth treatment: first statement resolves authority (`resolveWorkspaceAuthority` — routes stay on `sessionAuthMiddleware`) and checks `canResolveApproval(authority, spec, userId)`. |
| One pending per run | Partial unique index on `approval(run_id) where status='pending'` joins the existing per-task one. A run parks at its first gate; never a second pending gate for the same run. |
| Realtime | New workspace-room events `approval:created` / `approval:updated` (payload = serialized approval + channel/thread pointers) so resolvers see cards without a task-status side channel. Task card liveness via `task:updated` stays. |
| Surfaces | Generalize the task-thread `ApprovalCard`: render pending approvals on ANY run placeholder (channel, thread, loop, triggered) from the run trail + `approval:*` events. Buttons only for users who pass the resolver spec (server enforces regardless). |
| Push (LOR-83) | `sendApprovalPush` mirrors `sendInstructionsProposalPush`: data-only deep link to the channel/thread, sent to the resolver set (for `any_member`, cap to the run's channel members), presence-independent. Never resolve from the push. |
| Policy UI | Settings dialog section (near Agent profiles): full target list computed from the registry — capabilities, this workspace's custom tools and MCP servers, core messaging — each with an on/off switch + resolver picker. Gate the section like billing (owner/admin). Roles-UI matrix un-hides the `approval: resolve` checkbox once enforcement lands (P3). |
| Env | `MERLIN_TOOL_APPROVAL_SECRET` (≥32 chars, **optional**) in `packages/env` serverSchema — worker + API share it. Optional so deploys don't break; P2 decides unset behavior (gates still enforce, secret hardens the binding). Optional → no `TEST_ENV` mirror needed. |
| Out of scope | Per-channel/per-profile policy overrides; per-tool granularity inside a capability; resolver customization for discretionary approvals; seeded policy rows; approval expiry/timeouts (enum value exists, unused); Merlin proposing policy changes (pillar 3); LOR.md flow changes; batch/multi-gate approvals; forced sandbox-cost gate (`code_intelligence` is gateable generically if a workspace opts in). |

## Spike items (verify in P2 before building on them)

- The `tool-approval-request` part flowing through our step checkpoint: the
  parked assistant message (tool call + approval request) must land in
  `agent_run_step.messages` so replay reproduces it. Verify shape.
- Mixed step: model emits a gated call + ungated calls in one step — confirm
  SDK behavior (do ungated calls execute before the pause?).
- Compaction interaction: a compaction baseline that projects away the parked
  tool call would break resume. The parked step must survive replay verbatim
  (likely: park always ends the run before compaction can run again — confirm).
- Tool-guard wrapper (`wrapTools`) composing with `toolApproval` — gate should
  fire before the wrapper executes anything.

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked.

---

### [x] P1 — targets + schema + resolver helper (~300 LOC) — built 2026-09-01, db:push owed

- `packages/connectors`: approval-target vocabulary — `ApprovalTarget` union
  (capability / customTool / mcpServer / core:messaging), key format
  `capability:<key>` · `custom_tool:<id>` · `mcp_server:<id>` ·
  `core:messaging`, `approvalTargetKey` / `parseApprovalTargetKey` (validates
  capability keys against `CAPABILITIES`, excludes `custom_tools`), core
  target labels for the UI.
- New `packages/db/src/schemas/approval-policies.ts`: `approval_policy`
  (`workspaceId`, `target`, `resolverKind` enum
  `permission|role|user|any_member` default `permission`, `resolverRole`,
  `resolverUserId` set-null so a deleted named resolver fails closed to
  owner-only; unique `(workspaceId, target)`).
- `packages/db/src/schemas/approvals.ts`: `toolCallId`, `toolName`, `target`
  columns (null for discretionary); partial unique index on
  `(run_id) where status='pending'`.
- `agent_run` stop reason enum gains `awaiting_approval`.
- `packages/env`: optional `MERLIN_TOOL_APPROVAL_SECRET` (min 32 chars).
- `packages/auth/src/lib/permissions.ts`: `ApprovalResolverSpec` +
  `canResolveApproval(authority, spec, userId)` (owner bypass; blanket
  `approval:resolve` for `permission`; exact match for `role`/`user`;
  `any_member` true) + tests.
- **db:push owed after this step** (Jacob): `approval_policy` table, three
  `approval` columns + index, `agent_run_stop_reason` enum value.

### [ ] P2 — merlin gate wiring (~450 LOC)

- Spike items above, first.
- `respond()`: resolve workspace policy rows once (alongside capabilities);
  map bound tools → target keys at assembly time (the spread sites already
  know which capability each tool set belongs to; custom/MCP tools carry
  their ids; `messageActionTools` → `core:messaging`); build `toolApproval`
  from the map; `experimental_toolApprovalSecret` from env when set.
- Park path: on approval-request part → insert approval row (payload = raw
  input) in the checkpoint transaction; run ends `awaiting_approval`; task
  runs also set `waiting_for_approval`; emit `approval:created` (worker is
  the seq/event writer).
- `authorizePublish` seam: `capability:code_actions` gating routes through
  the same gate (delete the hardcoded `"publish"`).
- `request_approval` keeps its flag-park but writes the same enriched row
  shape (target null).

### [ ] P3 — resolve + resume (~450 LOC)

- Approvals routes move out of `routes/v1/tasks/` into `routes/v1/approvals/`
  (task-less approvals exist now). Handler: first statement resolves authority
  via `resolveWorkspaceAuthority` + `canResolveApproval`; channel write access
  stays the floor; CAS + resolution message unchanged. Discretionary rows
  (target null) resolve as `any_member`.
- Generalize `startTaskContinuationRun` → shared continuation starter that
  works for channel/thread/loop scopes (the harness doc already flags the
  run-creation recipe triplication — extract now).
- `run-continuation.ts`: approval branch — predecessor `awaiting_approval` +
  resolved row → replay chain + `tool-approval-response` + delta. Denied path
  returns the denial to the model.
- Emit `approval:updated` on resolution. Tests: resolver-spec matrix (each
  kind × allow/deny), CAS conflict, dangling-role resolver degrades safely.

### [ ] P4 — web surfaces (~450 LOC)

- `approval:created/updated` in `packages/realtime-types` + realtime relay.
- Generalized `ApprovalCard` on any parked run placeholder (channel + thread),
  fed by run trail replay + live events; task-thread header keeps its card.
- Buttons gated by a `canResolveApproval` mirror (custom roles via
  `use-workspace-roles`); non-resolvers see who can resolve.
- Policy settings UI: computed target list (capabilities + this workspace's
  custom tools and MCP servers + core messaging), on/off switch + resolver
  picker (permission / role incl. custom / person / any member). Gate the
  section like billing (owner/admin).
- Roles matrix: un-hide `approval: resolve` checkbox (enforcement is live).

### [ ] P5 — push + mobile (LOR-83) (~350 LOC)

- `sendApprovalPush` in `packages/messaging` (resolver set, data-only deep
  link to channel/thread).
- Mobile: generalized approval card in channel/thread (reuse task card
  pattern); resolver gating degrades member-tier without custom-grant data
  (server enforces; gap noted in `reference/mobile-parity-todo.md`).
- Update `reference/mobile-parity-todo.md`.

### [ ] P6 — validation sweep + live QA

Manual QA checklist (live, after db:push):
1. Fresh workspace, no policy rows: Merlin creates a Linear issue with NO
   gate (defaults-off regression check).
2. Enable `Write to Linear` gate → same ask parks the run; approval card
   appears; `approval:created` observed.
3. Approve as admin → continuation run executes the EXACT bound input; trail
   shows the gate.
4. Reject → model acknowledges, does not retry the same call blindly.
5. Resolver `role: support` (custom role) → member without the role sees the
   card but no buttons, direct POST 403s; role holder resolves; owner can
   always resolve.
6. Resolver `permission`: custom role WITH `approval:resolve` granted via the
   roles matrix resolves; plain member cannot.
7. Non-task gate: channel @Merlin with `core:messaging` enabled → parks and
   resumes in channel scope.
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
- 2026-09-01 — Jacob locked all open decisions: policy home = own
  workspace-level table; storage = computed (rows only for opt-ins, row =
  gate on); defaults = EVERYTHING off, explicit opt-in only (rejected
  default-on connector writes); gate unit = coarse per-capability + per
  custom tool + per MCP server + core messaging; discretionary
  `request_approval` resolver = any member; no forced sandbox gate;
  `approval:resolve` is a blanket permission with no underlying-permission
  matching (no fragmented "5 of 6" approvals).
