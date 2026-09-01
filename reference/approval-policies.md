# Approval policies (LOR-81 / LOR-83) — execution runbook

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 2 of `reference/self-configuration.md`. Approval moves
from prompt etiquette to execution physics: the run harness pauses gated tool
calls, policy says which tools are gated and who may resolve, and resolver
authority is written in the pillar-1 vocabulary (`reference/custom-roles.md`).

> **DRAFT** — decisions below are proposed, not locked. Lock with Jacob before
> starting P1, then delete this banner.

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
  existing census of externally-visible tools (replay-dedup, not approval) —
  the seed list for gate groups.
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

## Proposed decisions (LOCK WITH JACOB before P1)

| Topic | Proposal |
|---|---|
| Gate unit | **Approval groups**, not raw tool names. A typed registry in `packages/merlin` maps group → tool names (compile-checked against the tool sets, same exhaustiveness idiom as the connector registry). Proposed groups: `connector_write` (Linear writes today; future Attio/Notion writes join by registry edit), `code_publish` (the `authorizePublish` seam), `custom_tools` (all custom API tools + all MCP tools — mirrors the `customTool` statement merge), `messaging` (`post_channel_message`, `react_to_message`), `artifacts` (`create_artifacts`). Sandbox-internal fs tools and read-only tools are ungated. Per-tool / per-MCP-server granularity deferred. |
| Policy home | **Workspace-level** `approval_policy` table: one row per `(workspaceId, group)` → `{ required: boolean, resolver }`. No row → registry default. Per-channel / per-profile overrides deferred (same "workspace-wide v1" call as webhook/agentProfile grants). Alternative considered: columns on `agent_profile` (per-channel for free, but N profiles duplicate policy and there's no obvious home for workspaces with no profile). |
| Defaults | `connector_write` and `code_publish` **required by default** (vision doc: side-effecting connector writes default-gated). `custom_tools`, `messaging`, `artifacts` default off. Defaults live in the registry, not in rows, so new workspaces need no seed. |
| Resolver spec | Tagged union stored on the policy row: `{ kind: "permission" }` (anyone whose authority grants `approval: ["resolve"]` — owner/admin/custom roles; **this is where the reserved statement gets enforced**) · `{ kind: "role", role }` (static or custom role name) · `{ kind: "user", userId }` · `{ kind: "anyMember" }` (channel write access, today's behavior). Default: `permission`. |
| `request_approval` stays | The discretionary tool remains (model judgment for un-modeled risks) and becomes the SAME row shape + surfaces. Its resolver follows a workspace-level default resolver setting (proposed: `anyMember`, preserving today's task flow) — this closes the "any member resolves agent approvals while LOR.md needs admin" asymmetry by making it explicit configuration instead of accident. |
| Pause mechanics | Reuse the park pattern: policy gate returns `user-approval` → persist the approval row (now WITH payload: `toolCallId`, `toolName`, `input`, group) in the same checkpoint transaction that persists the approval-request step → run ends cleanly (new `stopReason: "awaiting_approval"`). Task runs also park the task `waiting_for_approval` (unchanged). Non-task runs park on the run row alone. |
| Resume mechanics | Approve/reject → continuation run in the same scope. `run-continuation.ts` gains an approval branch: predecessor ended `awaiting_approval` + resolved row → replay chain + append the `tool-approval-response` (approved/denied) + normal delta. Approved → the tool executes with the HMAC-bound input; denied → the model gets the denial and explains/adjusts. The human-readable "✅ Approved…" thread message stays (it's the audit trail + the delta trigger). |
| Resolution authority enforcement | Resolve handlers get the workspace-auth treatment: first statement resolves authority (`resolveWorkspaceAuthority` — tasks routes stay on `sessionAuthMiddleware`) and checks the row's resolver spec. Channel write access remains a floor for all kinds. |
| One pending per run | Partial unique index on `approval(run_id) where status='pending'` joins the existing per-task one. A run parks at its first gate; there is never a second pending gate for the same run. |
| Realtime | New workspace-room events `approval:created` / `approval:updated` (payload = serialized approval + channel/thread pointers) so resolvers see cards without a task-status side channel. Task card liveness via `task:updated` stays. |
| Surfaces | Generalize the task-thread `ApprovalCard`: render pending approvals on ANY run placeholder (channel, thread, loop, triggered) from the run trail + `approval:*` events. Buttons only for users who pass the resolver spec (server enforces regardless). |
| Push (LOR-83) | `sendApprovalPush` mirrors `sendInstructionsProposalPush`: data-only deep link to the channel/thread, sent to the resolver set (capped — e.g. skip push for `anyMember` beyond the run's channel members), presence-independent. Never resolve from the push. |
| Policy UI | Settings dialog section (near Agent profiles): table of groups → require toggle + resolver picker (person / role incl. custom / anyone with the approvals permission / any member). Roles-UI matrix un-hides the `approval: resolve` checkbox once enforcement lands (P3). |
| Env | `MERLIN_TOOL_APPROVAL_SECRET` (≥32 bytes) in `packages/env` serverSchema — worker + API share it. Mirror into `TEST_ENV` in `apps/api/vitest.config.ts` (test-env coupling). |
| Out of scope | Per-channel/per-profile policy overrides; per-tool granularity inside a group; approval expiry/timeouts (enum value exists, unused); Merlin proposing policy changes (pillar 3); LOR.md flow changes; batch/multi-gate approvals. |

### Open questions for Jacob

1. Policy home: workspace-level table (proposed) vs. per-agent-profile?
2. Group list + defaults above look right? (Notably: should `custom_tools`
   default to required? Unknown third-party side effects argue yes; friction
   argues no.)
3. Discretionary `request_approval` resolver default: keep `anyMember`
   (today's behavior) or tighten to `permission`?
4. Should `investigate_code` (read-only but $$ sandbox) get a `sandbox` gate
   group? It would double as the still-owed sandbox cost guard.

## Spike items (verify in P2 before building on them)

- The `tool-approval-request` part flowing through our step checkpoint: the
  parked assistant message (tool call + approval request) must land in
  `agent_run_step.messages` so replay reproduces it. Verify shape.
- Mixed step: model emits a gated call + ungated calls in one step — confirm
  SDK behavior (do ungated calls execute before the pause?).
- Compaction interaction: a compaction baseline that projects away the parked
  tool call would break resume. The parked step must survive replay verbatim
  (likely: never compact past the newest `awaiting_approval` step, or park
  always ends the run before compaction can run again — confirm).
- Tool-guard wrapper (`wrapTools`) composing with `toolApproval` — gate should
  fire before the wrapper executes anything.

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked.

---

### [ ] P1 — registry + schema + env (~350 LOC)

- `packages/merlin/src/approval-groups.ts`: group registry (group → tool
  names, label, description, default `{required, resolver}`), typed exhaustive
  over the gated tool sets; `custom_tools` group matches by provenance (any
  non-builtin tool), not by name list.
- `packages/db/src/schemas/approvals.ts`: typed `payload` columns
  (`toolCallId`, `toolName`, `group` — real columns, not a jsonb bag), keep
  `payload` jsonb for the raw input; partial unique index on
  `(run_id) where status='pending'`.
- New `packages/db/src/schemas/approval-policies.ts`: `approval_policy`
  (`workspaceId`, `group`, `required`, `resolverKind`, `resolverRole`,
  `resolverUserId`, timestamps; unique `(workspaceId, group)`).
- `agent_run.stopReason` enum gains `awaiting_approval`.
- `packages/env`: `MERLIN_TOOL_APPROVAL_SECRET` + `TEST_ENV` mirror.
- Resolver-spec type + `canResolveApproval(authority, spec)` helper in
  `packages/auth/src/lib/permissions.ts` (pure, shared web/api) + tests.
- **db:push owed after this step** (Jacob).

### [ ] P2 — merlin gate wiring (~450 LOC)

- Spike items above, first.
- `respond()`: resolve workspace policy once (alongside capabilities), build
  `toolApproval` from registry × policy; `experimental_toolApprovalSecret`
  from env.
- Park path: on approval-request part → insert approval row (with payload +
  group + runId + taskId when present) in the checkpoint transaction; run ends
  `awaiting_approval`; task runs also set `waiting_for_approval`; emit
  `approval:created` (worker is the seq/event writer).
- `authorizePublish` seam: `code_publish` group routes through the same gate
  (delete the hardcoded `"publish"`).
- `request_approval` keeps its flag-park but writes the same enriched row
  shape (group `discretionary`).

### [ ] P3 — resolve + resume (~450 LOC)

- Approvals routes move out of `routes/v1/tasks/` into `routes/v1/approvals/`
  (task-less approvals exist now). Handler: first statement resolves authority
  via `resolveWorkspaceAuthority` + `canResolveApproval(authority, spec)`;
  channel write access stays the floor; CAS + resolution message unchanged.
- Generalize `startTaskContinuationRun` → shared continuation starter that
  works for channel/thread/loop scopes (the harness doc already flags the
  run-creation recipe triplication — extract now, `packages/` or
  `apps/api/src/lib/`).
- `run-continuation.ts`: approval branch — predecessor `awaiting_approval` +
  resolved row → replay chain + `tool-approval-response` + delta. Denied path
  returns the denial to the model.
- Emit `approval:updated` on resolution. Tests: resolver-spec matrix (each
  kind × allow/deny), CAS conflict, dangling-role resolver degrades safely.

### [ ] P4 — web surfaces (~450 LOC)

- `approval:created/updated` in `packages/realtime-types` + realtime relay.
- Generalized `ApprovalCard` on any parked run placeholder (channel + thread),
  fed by run trail replay + live events; task-thread header keeps its card.
- Buttons gated by `canResolveApproval` mirror (custom roles via
  `use-workspace-roles`); non-resolvers see who can resolve.
- Policy settings UI: groups table, require toggle, resolver picker (member
  picker / role picker incl. custom / permission / any member). Gate the
  section like billing (owner/admin).
- Roles matrix: un-hide `approval: resolve` checkbox (enforcement is live).

### [ ] P5 — push + mobile (LOR-83) (~350 LOC)

- `sendApprovalPush` in `packages/messaging` (resolver set, data-only deep
  link to channel/thread; dedupe against presence like message pushes).
- Mobile: generalized approval card in channel/thread (reuse task card
  pattern), resolver gating from `use-member-moderation`-style authority
  (custom-grant gap noted in `reference/mobile-parity-todo.md` applies —
  member-tier fallback hides buttons, server enforces).
- Update `reference/mobile-parity-todo.md`.

### [ ] P6 — validation sweep + live QA

Manual QA checklist (live, after db:push):
1. Default policy: in a fresh workspace, ask Merlin (task) to create a Linear
   issue → run parks, approval card appears in-thread, `task:updated` +
   `approval:created` both observed.
2. Approve as admin → continuation run executes the EXACT bound input (verify
   the created issue matches the parked card's description); trail shows the
   gate.
3. Reject → model acknowledges, does not retry the same call blindly.
4. Resolver spec `role: support` (custom role) → member without the role sees
   the card but no buttons and gets 403 on direct POST; role holder resolves.
5. `permission` resolver: custom role WITH `approval:resolve` granted via the
   roles matrix can resolve; plain member cannot.
6. Non-task gate: channel @Merlin "post a message in #general" with
   `messaging` required → parks and resumes in channel scope.
7. Policy off: toggle `connector_write` off → same ask executes without a
   gate.
8. Discretionary `request_approval` still round-trips (task flow regression).
9. Push received by resolver on device; tap deep-links to the thread; card
   already resolved elsewhere shows resolved state (CAS 409 path).
10. Crash-recovery: kill worker mid-parked-run creation → dead-run sweep +
    approval row consistency (no orphan pending rows blocking the scope).

## Decisions & deviations log

- 2026-08-31 — Runbook drafted from verified current-state map (approval
  machinery, harness replay, AI SDK toolApproval). Decisions are PROPOSED —
  awaiting Jacob's lock on: policy home, group list + defaults,
  discretionary-resolver default, sandbox gate group.
