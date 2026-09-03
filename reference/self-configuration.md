# Self-configuration — Lor proposes and applies changes to itself

> Status: product vision for the next roadmap phase. This document defines the
> step *before* Playbooks. `reference/playbooks.md` remains the note for the
> later layer; its "Recommended implementation order" items 1–2 are promoted
> here to a first-class phase.

## Thesis

The next capability Lor needs is not a new execution engine. It is the ability
to safely **modify its own workspace configuration** under human approval.

A user should be able to tell Lor an outcome:

> "I want every Sentry error above threshold X investigated and triaged in
> #health."

and Merlin should be able to look at the workspace (and, through connectors,
the team's codebase), figure out what configuration would make that true, and
propose it as one reviewable change set:

- create the `#health` channel;
- create the inbound webhook and hand back the URL to put in Sentry;
- create the Loop or event trigger with the right instructions and prompt;
- request the tool grants it needs (Sentry read, GitHub read);
- declare the approval rules that gate its consequential actions; and
- update workspace instructions so future runs know the convention.

The team reads the diff, edits or approves it, and Lor applies it. Merlin
installs itself. When the team corrects the behavior later, the correction
becomes a new proposed version of the same configuration — never a silent
mutation.

Playbooks are the second-order effect of this capability, not the entry point.
Once Lor can propose, apply, version and roll back configuration, a Playbook is
"just" a named, versioned bundle of configuration plus flexible instructions.
Building the Playbook object first would put a product noun in front of
machinery that does not exist yet.

## The product feeling

Not "the user built a workflow," and not yet "Merlin noticed and took over"
(that is the Playbook phase). The feeling for this phase is:

> I told Lor what I wanted to happen. It showed me exactly what it would
> change about itself to make that happen — what it would create, what access
> it would gain, who would have to approve its actions. I approved it, and it
> was real.

The unit of trust is the **reviewable change set**. Everything in this phase
exists to make that unit trustworthy.

## Three pillars, in order

### 1. Permissions as execution physics (LOR-57, LOR-82)

Before Lor can *request* authority, authority has to be a real, enforceable
object. Today the workspace has three hardcoded roles and the API checks them
locally; there is no way to express "this person can manage webhooks but not
billing," and no object a proposal could point at when it says "grant X."

Custom roles + per-resource permission statements give the workspace a real
authority vocabulary. This is also the vocabulary approval policies and tool
grants will be written in. Execution runbook: `reference/custom-roles.md`.

### 2. Approval policies at the action layer (LOR-81)

Approval must be physics, not etiquette. Today the agent is *instructed* to
call `request_approval` before consequential external writes, and any channel
member can approve. LOR-81 moves this into the execution layer: the workspace
declares which tool targets require approval — one gate per capability, custom
tool, or MCP server, everything off by default — and **who** can grant it — a
specific person, a role (including custom roles from pillar 1), or any member.
The run parks safely at the gate, the right people are notified, and a
continuation run starts on approve/reject. This must hold identically for
Tasks, Loops, triggered runs, and future Playbooks, because they already share
the same run rails (`reference/agent-harness.md`).

The physical gate mechanism already exists in the stack (LOR-13; verified
against installed `ai@7.0.11` + current docs 2026-08-31): the `toolApproval`
option on `streamText` (`packages/merlin/src/index.ts`) forces tool calls to
pause. Per-tool statuses/functions or a generic catch-all; approval functions
receive input, `toolCallId`, `messages`, `toolContext`, `runtimeContext`
(the `toolsContext` refactor already landed). Statuses: `not-applicable` /
`approved` / `denied` / `user-approval`. On `user-approval` the loop returns a
`tool-approval-request` part instead of executing; resume is **stateless** —
append a `tool-approval-response` to the messages and call again. That maps
exactly onto Lor's existing park-and-continue pattern (approval row →
continuation run), so approve-hours-later durability should need **no**
`@ai-sdk/workflow` — our `agent_run` continuation already is the persistence
layer. (`needsApproval` is the WorkflowAgent-only pattern; not ours.)
`experimental_toolApprovalSecret` (≥32-byte secret, shared across workers via
env) HMAC-binds the approval to the exact tool name/call/input, fail-closed,
and re-validates input + policy on resume. So LOR-81 is mostly **policy, not
mechanism**:

- which tool targets require approval is workspace-level configuration (per
  capability / custom tool / MCP server; defaults off — see
  `reference/approval-policies.md` locked decisions), never hardcoded and
  never left to the prompt;
- who may resolve is expressed in the pillar-1 vocabulary — a person, a role
  (including custom roles), or any member;
- the pending state needs a surface: stream event → approve/deny card in the
  channel/thread, feeding the response back into a continuation run — plus
  mobile push for the resolver (LOR-83).

### 3. Versioned workspace change proposals

Generalize the pattern that already works for workspace instructions
(`workspace_instructions`: immutable versions, exactly one active, agent
proposals pend until a human approves that exact version, `baseVersion`
optimistic concurrency). A **change proposal** is the same idea over a set of
typed operations instead of one text blob:

```text
Change proposal
- workspace, author (user | agent), rationale, evidence links
- status: pending | approved | rejected | applied | rolled_back
- operations[]: typed create/update ops over supported resources
    channel · webhook · loop · trigger · instructions version ·
    tool grant · role · approval policy
- each operation records what it created (for provenance and rollback)
- approval records who approved, against which exact revision
```

Early scope questions (partial approval, atomicity, rollback depth) are
implementation-time decisions; the product boundary is: **Merlin can only
change the workspace through a proposal a human approved, and every applied
change is attributable to one.**

## What already exists to build on

| Primitive | State |
|---|---|
| Durable runs, budgets, steering, stop | Built (`reference/agent-harness.md`) |
| Loops (scheduled runs) | Built (`reference/loops.md`) |
| Event triggers / Act | Built (`reference/automation-primitives.md`) |
| Channel webhooks | Built |
| Custom tools, MCP servers, connectors | Built |
| `approval` table + request_approval tool | Built — but approval is prompt-discipline, any member can resolve |
| AI SDK 7 `toolApproval` (forced tool-call gating) | Verified in installed `ai@7.0.11` (LOR-13) — not yet wired to any policy config |
| `workspace_instructions` versioned proposal flow | Built — the template for pillar 3 |
| better-auth dynamic access control (`workspace_role`) | Wired but inert — no enforcement reads it; this is LOR-57 |
| Members/roles management UI | Missing — LOR-82 |
| Change proposal object | Missing — pillar 3 |

The gap is narrow and specific: authority vocabulary, enforced approval, and
the proposal wrapper. The execution machinery a proposal configures already
exists.

## Principles (carried into every pillar)

- **Merlin never silently widens its own authority.** New access, new
  triggers, new tools, new roles — all arrive as a pending proposal.
- **Enforcement lives in the execution layer.** Permission checks and approval
  gates are checked by Lor's API and run harness, never left to the model's
  memory or system prompt alone.
- **Proposals cite evidence.** A proposal links to the conversations, tasks or
  runs that motivated it, so review is judgment, not archaeology.
- **Everything applied is versioned and attributable.** Who approved what,
  when, and what it created. Rollback is a first-class path.
- **In-flight executions keep the authority they started with.** A later
  configuration edit must not retroactively widen a running task's permissions.

## Non-goals for this phase

- The Playbook identity/version object and "I can take this over" proactive
  proposals (`reference/playbooks.md` — next phase).
- Generated connectors, generated tools, specialist sub-agents.
- Persistent viewable browser/computer as an execution capability.
- Repeated-work detection / evidence mining.

## Sequencing

1. **LOR-57 / LOR-82** — custom roles + permission enforcement + management UI
   (`reference/custom-roles.md`).
2. **LOR-81** — approval policies enforced at the tool/action layer, resolver
   authority expressed in the pillar-1 vocabulary.
3. **Change proposals** — the versioned change-set object, applied first to
   the resources Merlin most often needs (channel, webhook, loop, instructions,
   tool grant), then roles/approval policies themselves.
4. One end-to-end vertical slice: "I want X to happen" → proposal → approval →
   applied configuration → triggered run visibly doing the work.
5. Then Playbooks, per `reference/playbooks.md`.
