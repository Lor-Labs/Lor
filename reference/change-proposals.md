# Workspace change proposals — execution runbook (pillar 3)

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 3 of `reference/self-configuration.md`. Merlin can
already be *gated* (LOR-81 approval policies) and authority is a real object
(LOR-57/82 custom roles). This pillar gives Merlin the one sanctioned way to
change the workspace itself: a **reviewable change set** — typed operations, a
rationale, evidence — that a human approves and the system applies atomically.
Merlin never silently widens its own authority; everything applied is
versioned and attributable. Playbooks build on this later
(`reference/playbooks.md`).

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
- **`propose_loop`** (the draft-row pattern, `packages/merlin/src/loops.ts:120`
  → `apps/worker/src/lib/merlin-loop.ts:23`): the tool validates, the executor
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

Merlin tools that already mutate Lor config: `propose_instructions`,
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
| Op vocabulary v1 | `create_channel` · `create_webhook` · `set_trigger` (connector event → channel routing incl. effects) · `create_loop` · `update_loop` (edit an existing loop's name/instructions/schedule) · `update_instructions` (full content, like today) · `create_agent_profile` · `assign_channel_profile` · `create_custom_tool` · `create_mcp_server` · `set_approval_policy` (**upsert only, never delete** — Merlin may propose gating a tool/action, especially one it is proposing to create, when the user asks; it never proposes loosening a gate). **Deferred: roles (no server-side creation path), deleting anything, generic updates beyond loops.** |
| Custom tool / MCP wrinkles | Proposed custom tools are researched first — the prompt directs Merlin to verify the target API (endpoint, method, body shape) via web search before proposing, and the card shows the full template. Secrets can never ride a proposal: apply creates the tool with an empty secrets map, and templates referencing `{{secrets.X}}` make the applied card say "add the secret in Settings → Tools before this tool works". MCP servers likewise: the row is created by apply; OAuth (when required) is completed by a human through the existing flow afterward, and the card links there. |
| Who approves | The approver's authority must cover **every** operation in the set — the union of the per-resource manage permissions the ops touch (channel:create, webhook:manage, connector:manage, agentProfile:manage, instructions:update). All-or-nothing gate on the person, not fragmented partial approval. Owner/admin always qualify. No new permission statement. |
| Apply semantics | One DB transaction, all ops or none. Every op re-validates at apply time exactly like its handler does today (name collisions, ownership, caps, content rules). On any failure: transaction rolls back, proposal → `failed` with the failing op's error, nothing half-applied. The approve endpoint applies inline (the approver's request context) — no worker hop. |
| Partial approval / editing | Neither, in v1. Approve all, or reject with a note — Merlin revises and files a new proposal (supersede semantics like instructions: one pending proposal per channel scope). Editing ops in the UI is a later layer. |
| Rollback v1 | Provenance only: each op records what it created/changed (ids, prior values where cheap). No automated rollback path yet — undo is manual through the normal UI, findable because everything is attributed. First-class rollback arrives with Playbooks. |
| Instructions overlap | An `update_instructions` op applies directly on proposal approval (one human approval, not two) — it writes the new active version through the same transaction/CAS logic as the human PUT. The standalone instructions flow stays for standalone use. Jacob: LOR.md changes should be rare (it shapes every channel) — the capability exists, the prompt should treat it as a last resort. |
| Merlin surface | New `propose_workspace_change` tool (conversational runs, like propose_loop): typed op list + rationale + evidence. Executor posts a `proposal_card` message then inserts the rows (loop-card ordering + compensation). Prompt rule: workspace config changes go through a proposal, never piecemeal tools. |
| Apply engine home | `apps/api/src/lib/change-proposals/` — per-op appliers extracted from (or shared with) the existing handlers, so route behavior and proposal behavior can't drift. Extraction is the bulk of P2's work. |
| Notifications | Reuse the LOR-83 shape: card in channel (ambient), user-targeted socket + offline push to people whose authority covers the proposal (bounded set: owner + admins + qualifying custom roles). Requester-first/escalation NOT needed here — proposals are not blocking a parked run. |

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked and the decisions table above is locked.

---

### [ ] P1 — op vocabulary + schema + read/reject API (~350 LOC)

- New `packages/proposals` (or a module in `@repo/connectors`-style package):
  zod schemas per op kind, `ChangeOperation` discriminated union,
  `proposalPermissions(ops)` → the permission set an approver must hold
  (custom tool + MCP ops → `customTool: ["manage"]`; `set_approval_policy` →
  `approval: ["manage"]`).
- `packages/db/src/schemas/change-proposals.ts`: `change_proposal` +
  `change_proposal_operation` per the decisions table; `proposal_card` message
  type enum value.
- API: GET a proposal (with ops), GET channel pending proposals, POST reject
  (CAS, resolution note). No apply yet.
- db:push note for Jacob at the end of the step.

### [ ] P2 — apply engine + approve endpoint (~500 LOC)

- `apps/api/src/lib/change-proposals/appliers/*` — one applier per op kind,
  sharing validation with the existing handlers (extract the reusable core
  where needed: channel create, webhook create, trigger upsert, profile
  create/assign, instructions activate, loop create/update reusing the
  draft+activate semantics, custom tool create sharing the SSRF/template
  validators from `packages/merlin/src/custom-tools.ts` with an EMPTY secrets
  map, MCP server create sharing the mcp-servers route validation, approval
  policy upsert sharing the approval-policies handler validation).
- POST approve: authority-union check first statement; single transaction over
  all ops; provenance written per op; proposal → `applied`; failure path →
  `failed` + per-op error; socket emit `proposal:updated`.
- Tests: per-applier validation parity, atomic rollback on mid-set failure,
  authority-union matrix.

### [ ] P3 — merlin tool + card + notify (~400 LOC)

- `propose_workspace_change` tool (typed ops input mirrored from
  `packages/proposals`), conversational binding, SIDE_EFFECT_TOOLS entry,
  prompt section; executor in worker (card message → rows → compensation);
  supersede prior pending proposal in the same scope.
- Notify qualifying approvers via the LOR-83 socket+push shape.

### [ ] P4 — web surfaces (~450 LOC)

- `proposal_card` renderer: op-by-op diff view (what will be created/changed,
  the access implied), rationale, evidence links, Approve/Reject gated by the
  authority-union mirror; applied/failed/rejected terminal states.
- Post-apply: card shows provenance (links to the created channel/loop/…).

### [ ] P5 — mobile (~300 LOC)

- Card renderer + resolve, same hooks pattern as approvals; push deep link.

### [ ] P6 — vertical slice QA

End-to-end: "I want inbound Sentry-style alerts triaged in #health" →
proposal (create channel + webhook + loop + instructions note) → approve →
everything exists → the loop visibly runs. Plus: reject-and-revise flow,
mid-set failure atomicity, authority-union denial, provenance links.

## Decisions & deviations log

- 2026-09-02 — Decisions LOCKED by Jacob: scope v1 additionally includes
  `update_loop`, `create_custom_tool`, `create_mcp_server` (with web-research
  prompt guidance + the secrets/OAuth handoffs above) and `set_approval_policy`
  as upsert-only (user-prompted gating of e.g. a proposed tool's write action —
  never gate removal); roles and deletes stay out; approver = authority union;
  all-or-nothing approve; atomic apply; provenance-not-rollback; instructions
  op applies with the single proposal approval (and stays rare by prompt).
- 2026-09-02 — Runbook drafted from verified ground truth (explorer sweep of
  handlers/tools/schemas).
