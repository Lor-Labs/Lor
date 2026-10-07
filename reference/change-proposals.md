# Workspace change proposals — execution runbook (pillar 3)

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 3 of `reference/planned/self-configuration.md`. Lor can
already be *gated* (LOR-81 approval policies) and authority is a real object
(LOR-57/82 custom roles). This pillar gives Lor the one sanctioned way to
change the workspace itself: a **reviewable change set** — typed operations, a
rationale, evidence — that a human approves and the system applies atomically.
Lor never silently widens its own authority; everything applied is
versioned and attributable. Playbooks build on this later
(`reference/planned/playbooks.md`).

## Current state (verified 2026-09-02)

Two proposal patterns already work in production shape:

- **`workspace_instructions`** (the versioned template,
  `packages/db/src/schemas/workspace-instructions.ts`): immutable version
  rows; ONE active enforced by a partial unique index (state = 'active'), not
  a boolean; `baseVersion` optimistic concurrency (approve conflicts when the
  active version moved, `handlers.ts:246`); at most one pending — a new
  proposal supersedes the previous pending (`instructions.ts:82`); approval
  gated `instructions: ["approve"]`; activation is just flipping the row —
  injection reads the active row lazily. `ProposalRaceError` rolls back the
  supersede if the pending row was resolved concurrently.
- **`propose_loop`** (the draft-row pattern, `packages/lor/src/loops.ts:120`
  → `apps/worker/src/lib/lor-loop.ts:23`): the tool validates, the executor
  posts a `loop_card` message THEN inserts the `draft` loop row (card-message
  FK + compensation delete on failure), human presses **Create Loop** →
  CAS activate (`loops/handlers.ts:143`, `where status = 'draft'`), with a 422
  `requires_confirmation` round-trip for sub-hourly cadences.

What a proposal would drive, and where that logic lives today — **all of it is
inline in Hono route handlers; there is no HTTP-free service layer**:

| Resource | Create/update today | Notes |
|---|---|---|
| Channel | `channels/handlers.ts:106` create, `:365` update | private-audience membership resolution; `agentProfileId` assignment lives on channel update (`:386`) |
| Channel webhook | `webhooks/handlers.ts:234` | needs `INTEGRATION_ENCRYPTION_KEY`; token generated server-side; inserts `integrationConnection` (provider `webhook`) + `connectorTrigger` in one tx; per-channel cap via `SELECT FOR UPDATE` |
| Loop | created ONLY by the worker executor (draft), activated via `loops/handlers.ts:76` | no POST /loops exists |
| Event trigger | `integrations/handlers.ts:828` | upsert on (connectionId, event); `channelId: null` deletes |
| Agent profile + grants | `agent-profiles/handlers.ts:233/:315` | capability grantability + tool/MCP ownership validation |
| Instructions | `instructions/handlers.ts:102/:207` | the versioned flow above |
| Workspace role | **client-side better-auth only** (`roles-section.tsx:106`) | no server-side creation path exists |
| Approval policy | `approval-policies/handlers.ts:90` | upsert by (workspaceId, target) |

Lor tools that already mutate Lor config: `propose_instructions`,
`propose_loop`, `create_task`, `set_plan`/`complete_task`, `request_approval`,
`complete_loop`, brain writes, `react_to_message`, `post_channel_message`
(full list with lines: tool-guard census `tool-guard.ts:12`).

Notification surfaces available: `loop_card`/`task_card` message types +
web/mobile card renderers; `instructions:proposal` socket event +
`instructions-approval-alert.tsx`; the LOR-83 approval notify path
(user-targeted socket event + offline push) is reusable machinery.

## Locked decisions (Jacob, 2026-09-02 — do not relitigate without logging a deviation)

| Topic | Proposal |
|---|---|
| Object shape | Two tables. `change_proposal`: workspace, channelId + cardMessageId (the card is the surface, like loops), author (user\|agent + userId), rationale, evidence (message/task/run ids), status `pending\|approved\|rejected\|applied\|failed`, resolvedBy/At, appliedAt. `change_proposal_operation`: proposalId, position, `kind` enum, typed `spec` jsonb (discriminated union in `@repo/proposals` — typed, never a free bag), `result` (created resource id after apply), per-op error text on failure. |
| Op vocabulary v1 | `create_channel` · `create_webhook` · `set_trigger` (connector event → channel routing incl. effects) · `create_loop` · `update_loop` (edit an existing loop's name/instructions/schedule) · `update_instructions` (full content, like today) · `create_agent_profile` · `assign_channel_profile` · `create_custom_tool` · `create_mcp_server` · `set_approval_policy` (**upsert only, never delete** — Lor may propose gating a tool/action, especially one it is proposing to create, when the user asks; it never proposes loosening a gate). **Deferred: roles (no server-side creation path), deleting anything, generic updates beyond loops.** |
| Custom tool / MCP wrinkles | Proposed custom tools are researched first — the prompt directs Lor to verify the target API (endpoint, method, body shape) via web search before proposing, and the card shows the full template. **Secrets are collected from the approver at approve time, never through Lor**: the op declares `requiredSecrets` (names its template references), the card renders a password field per name, values ride the approve request and are encrypted into the tool row inside the apply transaction — never stored on the proposal, never echoed, never model-visible. The approver may skip → tool created with empty secrets + a persistent "finish setup in Settings → Tools" chip on the card. MCP servers: apply creates the row in its existing not-yet-authorized state; the applied card pings the approver with a Connect button into the existing OAuth flow; deferring is fine (row sits inactive, chip stays). |
| Post-apply code integration | Approving a proposal posts a resolution message into the card's thread as the approver (mirrors task-approval resolution), carrying the apply results — incl. values that only exist after apply, like the webhook URL. That reply triggers Lor's normal thread continuation, where the prompt directs it to finish codebase integration via `investigate_code` / `propose_code_change` (e.g. PR wiring the webhook URL into the user's repo). Existing `code_actions` capability + approval gates apply unchanged. Reused for onboarding later (Jacob). |
| Who approves | The approver's authority must cover **every** operation in the set — the union of the per-resource manage permissions the ops touch (channel:create, webhook:manage, connector:manage, agentProfile:manage, instructions:update). All-or-nothing gate on the person, not fragmented partial approval. Owner/admin always qualify. No new permission statement. |
| Apply semantics | One DB transaction, all ops or none. Every op re-validates at apply time exactly like its handler does today (name collisions, ownership, caps, content rules). On any failure: transaction rolls back, proposal → `failed` with the failing op's error, nothing half-applied. The approve endpoint applies inline (the approver's request context) — no worker hop. |
| Partial approval / editing | Neither, in v1. Approve all, or reject with a note — Lor revises and files a new proposal (supersede semantics like instructions: one pending proposal per channel scope). Editing ops in the UI is a later layer. |
| Rollback v1 | Provenance only: each op records what it created/changed (ids, prior values where cheap). No automated rollback path yet — undo is manual through the normal UI, findable because everything is attributed. First-class rollback arrives with Playbooks. |
| Instructions overlap | An `update_instructions` op applies directly on proposal approval (one human approval, not two) — it writes the new active version through the same transaction/CAS logic as the human PUT. The standalone instructions flow stays for standalone use. Jacob: LOR.md changes should be rare (it shapes every channel) — the capability exists, the prompt should treat it as a last resort. |
| Lor surface | New `propose_workspace_change` tool (conversational runs, like propose_loop): typed op list + rationale + evidence. Executor posts a `proposal_card` message then inserts the rows (loop-card ordering + compensation). Prompt rule: workspace config changes go through a proposal, never piecemeal tools. |
| Apply engine home | `apps/api/src/lib/change-proposals/` — per-op appliers extracted from (or shared with) the existing handlers, so route behavior and proposal behavior can't drift. Extraction is the bulk of P2's work. |
| Notifications | Reuse the LOR-83 shape: card in channel (ambient), user-targeted socket + offline push to people whose authority covers the proposal (bounded set: owner + admins + qualifying custom roles). Requester-first/escalation NOT needed here — proposals are not blocking a parked run. |

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked and the decisions table above is locked.

---

### [x] P1 — op vocabulary + schema + read/reject API (~350 LOC) — built 2026-09-03

- Op vocabulary in `packages/db/src/schemas/change-proposals.ts` (with the
  tables): zod schemas per op kind, `ChangeOperation` discriminated union,
  `proposalPermissions(ops)` → the permission set an approver must hold
  (custom tool + MCP ops → `customTool: ["manage"]`; `set_approval_policy` →
  `approval: ["manage"]`).
- `packages/db/src/schemas/change-proposals.ts`: `change_proposal` +
  `change_proposal_operation` per the decisions table; `proposal_card` message
  type enum value.
- API: GET a proposal (with ops), GET channel pending proposals, POST reject
  (CAS, resolution note). No apply yet.
- db:push note for Jacob at the end of the step.

**As built.** Vocabulary lives IN `packages/db/src/schemas/change-proposals.ts`
alongside the tables (Jacob folded the short-lived `@repo/proposals` package —
db already carries domain validation per the workspace-instructions precedent,
and api/lor already depend on db):
`changeOperationSchema` (11 kinds), `resourceRefSchema`
(existing-id | created-at-op-position), `proposalEvidenceSchema`,
`OperationResult`, `proposalPermissions()` (statement union; loop ops map to
none — channel write access is their floor, matching the live API). DB:
`change_proposal` (+status/author enums, card FK set-null like loops,
`resolutionNote` doubles as reject note / failure summary) +
`change_proposal_operation` (`kind` is a pg enum — Jacob prefers the migration
cost over a loose text column; a `satisfies` guard + enum-typed write sites keep
it in lockstep with the union — spec/result typed jsonb, unique
(proposalId, position)); `proposal_card` message type.
API `routes/v1/proposals/`: GET one, GET channel pending, POST reject — reject
enforces channel-write floor + the authority union, CAS-resolves, posts the
note into the card thread as the rejecter and starts the revision continuation
via `startScopeContinuationRun` (un-resolves the CAS if the post fails).
Responses carry `requiredPermissions` so clients mirror the gate without
recomputing. (Vocabulary test removed 2026-09-03 — Jacob: no new tests; db's vitest setup reverted.)
**db:push owed (Jacob):** `change_proposal` + `change_proposal_operation`
tables, `change_proposal_status` + `change_proposal_author` +
`change_operation_kind` enums, `proposal_card` value on `message_type`.

### [x] P2 — apply engine + approve endpoint (~500 LOC) — built 2026-09-03

- `apps/api/src/lib/change-proposals/appliers/*` — one applier per op kind,
  sharing validation with the existing handlers (extract the reusable core
  where needed: channel create, webhook create, trigger upsert, profile
  create/assign, instructions activate, loop create/update reusing the
  draft+activate semantics, custom tool create sharing the SSRF/template
  validators from `packages/lor/src/custom-tools.ts` with an EMPTY secrets
  map, MCP server create sharing the mcp-servers route validation, approval
  policy upsert sharing the approval-policies handler validation).
- POST approve: authority-union check first statement; request body may carry
  `secrets: { [opPosition]: { [name]: value } }` for custom-tool ops
  (validated against the op's declared `requiredSecrets`, encrypted in-tx,
  never persisted on the proposal); single transaction over all ops;
  provenance written per op; proposal → `applied`; resolution message posted
  into the card thread as the approver with the apply results (webhook URL,
  created ids) — this is also what triggers Lor's follow-up continuation;
  failure path → `failed` + per-op error; socket emit `proposal:updated`.

**As built.** `apps/api/src/lib/change-proposals.ts`: one `applyOperation`
switch over all 11 kinds inside a single `db.transaction`, ops in position
order (a `created` ref can only point backward — forward refs read an empty
slot and fail with a named error). Re-validates like the live routes: webhook
channel-row lock + 10-cap, loop cron/timezone via `validateLoopSchedule` +
`nextRunAt` recompute, instructions CAS-supersede + max(version)+1 (authorType
`agent`, `approvedByUserId` = approver, rationale from the proposal),
capability grantability incl. the EXA web gate, custom-tool SSRF/template/
reserved-name checks + template-secret-refs ⊆ requiredSecrets, MCP
`initialMcpServerOAuthStatus`, approval-policy resolver validation. Loops are
created ACTIVE (approving the card is the high-frequency consent — no draft
step, no 422 round-trip). Approver secrets: `approve` body carries
`secrets[position][name]` (validated against the op's declared names, 400
otherwise), encrypted in-tx, never persisted elsewhere. Failure path: tx rolls
back, proposal → `failed` + `resolutionNote`, failing op row gets `error`, and
the failure is posted into the card thread (which triggers Lor's revision
continuation) — success posts "Approved and applied…" with per-op
`operationSummary` lines incl. the webhook URL and setup notes, then the same
continuation. `authorizeResolution` shared by approve/reject (floor +
authority union), CAS pending→approved/rejected, `proposal:updated` emitted to
the channel room (realtime-types event added).

### [x] P3 — lor tool + card + notify (~400 LOC) — built 2026-09-03

- `propose_workspace_change` tool (typed ops input mirrored from
  `packages/proposals`), conversational binding, SIDE_EFFECT_TOOLS entry,
  prompt section; executor in worker (card message → rows → compensation);
  supersede prior pending proposal in the same scope.
- Notify qualifying approvers via the LOR-83 socket+push shape.
- Prompt guidance: research custom-tool APIs via web search BEFORE proposing;
  after a proposal is applied, continue in-thread and finish codebase
  integration via code tools (PR) when the change needs it; LOR.md ops are a
  last resort.

**As built.** `packages/lor/src/proposals.ts`: `propose_workspace_change`
(input = rationale + evidence + the shared `changeOperationSchema` array,
max 15 ops; `refIssue()` statically rejects forward/wrong-kind `created` refs
so the model gets a fixable error, not a dead card). Bound conversational-only
like propose_loop (`ctx.proposeChange && ctx.channelId`), toolsContext carries
the executor, `PROPOSALS_PROMPT_LINE` sets the doctrine: the ONLY way to change
workspace config, research custom-tool APIs via web search first, secret NAMES
only, LOR.md rarely, finish integration from the card thread after apply.
Added to `SIDE_EFFECT_TOOLS` and `RESERVED_TOOL_NAMES`.

Worker `apps/worker/src/lib/change-proposal.ts` (`createProposalCard`):
`proposal_card` message first (plain-text op list as the fallback body) → one
tx that supersedes the channel's previous pending proposal (rejected +
"Superseded by a newer proposal.") and inserts proposal + op rows →
compensation-deletes the card on failure. Best-effort afterward:
`proposal:updated` for superseded + new, then approver notify —
`qualifyingApprovers` = members whose authority covers the permission union
(owner/admins/custom roles; when the union is empty — loop-only proposals —
only owner+admins are pinged, the card's normal message fanout covers the
channel), each gets a user-room `notification:proposal` socket event
(web OS notification lands in P4) and `sendProposalPush` covers the offline
complement (packages/messaging; deep-links via the message target).
Wired in lor-respond next to proposeLoop; `postLorMessage` accepts the
new card type; lor gained the `./proposals` export.

### [x] P4 — web surfaces (built 2026-09-04)

- `apps/web/src/hooks/use-proposals.ts`: channel proposals query (all
  statuses — terminal cards render on reload; the list handler dropped its
  pending filter for this, newest-first limit 50) kept live by
  `proposal:updated`; per-card select by cardMessageId;
  `useCanResolveProposal` mirrors the authority union via
  `workspaceAuthorityHasPermissions(requiredPermissions)`; approve mutation
  carries the optional secrets payload and toasts when a 200 lands with
  status `failed`.
- `apps/web/src/components/chat/proposal-card.tsx`: op-by-op rows (titles +
  detail lines per kind, `describeLoopSchedule` for cron, channel names from
  the sidebar cache, created-refs labeled "(new)" via the proposal's own
  ops), rationale, url-evidence chips, LOR.md content in a scrollable block,
  password inputs per declared requiredSecrets (optional — skipping leaves a
  setup chip), Approve / Reject-with-note (the note is what Lor revises
  against), terminal states: applied (per-op provenance — channel link,
  copyable webhook URL, amber setupNote chips incl. MCP OAuth), failed
  (per-op error + resolutionNote), rejected (note, dimmed). Non-resolvers see
  "Waiting for someone with permission".
- Dispatch: `proposal_card` joins the card branch in message-item;
  `useChannelProposals` mounts once per channel view; `notification:proposal`
  OS-notification handler in use-browser-notifications (same directed-ping
  contract as approvals).
- 2026-09-05 — live thread footers for server-posted replies: `loadThreadSummary`
  moved from apps/realtime into `@repo/messaging`; the API's scope-run paths
  (postScopeMessage resolutions, Lor placeholder create/retract) now emit
  `message:thread:updated` to the channel room, so proposal/task card reply
  footers update without a reload. Card polish same day: header checkmark on
  applied removed; sources render as favicon badges (via /v1/favicon proxy,
  link-glyph fallback) instead of a dropdown; card chrome removed (renders
  straight into the channel); step panels default open; step detail collapses
  behind its first line.
- 2026-09-05 (Jacob review round 2): ops render as a hand-rolled TIMELINE
  (size-6 icon indicators on a connecting rail — muted while pending, primary
  fill when applied, destructive on the failing op; reui timeline as visual
  reference, NOT installed — packages/ui is coss ui). Whole-card thread click
  REMOVED (read as a task card, confusing); the standard ThreadFooter
  ("N replies") renders under the card instead once resolutions land.
- 2026-09-04 QA fixes: card redesigned on the TaskCard pattern (bg-card
  surface, status badge, recessed op well with per-kind HugeIcons, stretched
  overlay button opens the card's thread — interactive rows at z-20);
  `channel:created` workspace-room event added (emitted by the regular
  create-channel handler AND `announceCreatedChannels` post-apply) with a
  `useChannelCreated` sidebar listener; each proposal-created channel also
  gets a Lor context message via `postBotMessage`, which lights it unread
  through the normal fanout. Mobile channel:created listener deferred to P5.

### [x] P5 — mobile (built 2026-09-05)

- `apps/mobile/src/hooks/use-proposals.ts`: mirror of use-approvals (30s
  staleTime channel query, all statuses; `proposal:updated` invalidation;
  `useCanResolveProposal` = authority-union mirror via
  `workspaceAuthorityHasPermissions` with real custom-role grants; approve
  carries the secrets payload, 200-with-`failed` surfaces a native Alert).
- `apps/mobile/src/components/proposal-card.tsx`: timeline renderer (heroui
  tokens — indicator circles on a 2px rail: outlined+op-glyph pending,
  accent-soft check applied, danger-soft on the failing op; framed per-step
  panels, always expanded; secureTextEntry secret inputs;
  reject-with-note TextInput; copy-webhook-URL row via expo-clipboard;
  "Open #channel" provenance routes to the channel screen; hostname source
  chips). Wired into message-row's card branch; ThreadFooter already renders
  for cards on mobile, so the thread entry came free.
- Mounted `useChannelProposals` on the channel + thread screens (next to
  approvals); `channel:created` listener added to use-project-updates.
- Push: `type: "proposal"` needed NO push-target change — the payload's
  channelId/messageId already parse as a message target.
- reference/mobile-parity-todo.md updated (collapse + favicons stay web-only).

### [ ] P6 — vertical slice QA

End-to-end: "I want inbound Sentry-style alerts triaged in #health" →
proposal (create channel + webhook + loop + instructions note) → approve →
everything exists → the loop visibly runs. Plus: reject-and-revise flow,
mid-set failure atomicity, authority-union denial, provenance links.

## Decisions & deviations log

- 2026-09-03 — Jacob refinements locked: approver-supplied secrets at approve
  time (assistant never sees them; skip allowed → empty secrets + setup chip);
  MCP OAuth = pause-and-ping via the applied card's Connect button, deferring
  fine; post-apply resolution message triggers Lor's continuation so it can
  open integration PRs via the existing code tools (also the onboarding
  pattern later).
- 2026-09-02 — Decisions LOCKED by Jacob: scope v1 additionally includes
  `update_loop`, `create_custom_tool`, `create_mcp_server` (with web-research
  prompt guidance + the secrets/OAuth handoffs above) and `set_approval_policy`
  as upsert-only (user-prompted gating of e.g. a proposed tool's write action —
  never gate removal); roles and deletes stay out; approver = authority union;
  all-or-nothing approve; atomic apply; provenance-not-rollback; instructions
  op applies with the single proposal approval (and stays rare by prompt).
- 2026-09-02 — Runbook drafted from verified ground truth (explorer sweep of
  handlers/tools/schemas).
