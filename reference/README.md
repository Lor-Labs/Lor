# Reference docs

Design notes, runbooks and as-built references for Lor, written for the agents
and people working in this repo. The folder a doc sits in is its trust level:

- **Root** — what exists. As-built references, runbooks whose feature is shipped
  or in flight, and how-tos. Code comments cite these paths; keep them current
  as code changes.
- **`planned/`** — designs not started. Verify against code before relying on
  anything in them.
- **`archive/`** — superseded or finished one-off plans. History only.

Lifecycle: a design moves `planned/` → root when building starts, while few
links exist. A finished runbook stays at root as the as-built reference, or
drops to `archive/` once a shorter as-built doc supersedes it. Moving a root doc
needs a link sweep over `CLAUDE.md`, `reference/` and code comments.

## Root — as-built

| Doc | Covers |
|---|---|
| `agent-harness.md` | Durable runs: Postgres-owned state, BullMQ scheduling, leases, budgets, steer/stop |
| `artifacts.md` | Artifact + version model (Postgres/R2), workbench deliverables |
| `automation-primitives.md` | Triggers, effects, Act, custom tools, MCP servers |
| `mcp-oauth.md` | Workspace-scoped OAuth for MCP servers (written as the plan; routes shipped) |
| `lor-mvp-spec.md` | Lor MVP as built: brain, retrieval, write-back; overrides the archived architecture doc |
| `github-connector.md` | GitHub App + sandboxed code investigation; definition-of-done list, status as of 2026-07-31 |
| `context-continuation.md` | Run continuation, compaction baselines, data-to-file pipe |
| `loops.md` | Scheduled Lor runs |
| `tasks-v2.md` | Plans (formerly tasks): emergent tasks, thread anchors, scope-keyed sandboxes |
| `custom-roles.md` | Custom roles + permission enforcement (LOR-57/82) |
| `channel-events.md` | Inline system messages in the channel timeline (LOR-86) |

## Root — in flight

| Doc | Open |
|---|---|
| `voice-channels-runbook.md` | Voice calls, transcription, Lor in the call, memory. V0–V7 built; prod setup, live QA and merge open |
| `approval-policies.md` | Approval gates (LOR-81/83). P6 validation sweep + live QA |
| `change-proposals.md` | Workspace change proposals (self-configuration pillar 3). P6 vertical-slice QA |
| `attachment-search.md` | Attachment indexing + reranker. Steps 1–6 built; 4b and 7 parked behind triggers |
| `onboarding.md` | First-run redesign for small tech startups: opaque workspace key, startup channel template, company prefill, setup checklist, domain join, per-user hints, permission changes. All 10 steps built 2026-10-08; prod db:push + rekey and live QA owed |
| `workspace-model-runbook.md` | Human-only channel chat, Lor works in sessions: 22 steps on `app-redesign-sessions`. Started 2026-10-08 |

## Root — specs, how-tos, checklists

| Doc | Use |
|---|---|
| `product-direction.md` | Current priorities and what is deferred |
| `voice-channels.md` | Guiding product spec for voice; its "Voice channel model" decisions win over the runbook and research |
| `workspace-model.md` | Locked design for channels, Lor sessions, subscriptions and archive; wins over its runbook on product behavior |
| `adding-a-connector.md` | Runbook for wiring a new integration |
| `mobile-release.md` | TestFlight / EAS release loop |
| `mobile-parity-todo.md` | Living web ↔ mobile gap checklist |

## `planned/` — not built

| Doc | Status |
|---|---|
| `linear-projects.md` | Lor projects linked to Linear projects. Split from onboarding 2026-10-07; open for its own design thread |
| `code-channels.md` | Multiplayer AI coding architecture, design agreed 2026-10-05 |
| `live-collaboration.md` | Editor decision (TipTap over Plate, 2026-10-09) and the MIT build map for live multiplayer documents |
| `self-configuration.md` | Vision for Lor proposing changes to itself; pillars 1–2 shipped (root runbooks), pillar 3 in flight |
| `playbooks.md` | Working idea, not a spec |
| `private-lor-questions.md` | Deferred platform decision (2026-09-28) |
| `slack-connector-next.md` | Read-only Slack connector, not started |

## `archive/` — superseded or done

| Doc | Why archived |
|---|---|
| `lor-agent-architecture.md` | North-star memory architecture; `lor-mvp-spec.md` is what was built |
| `voice-channels-livekit-research.md` | Research input; `voice-channels.md` decisions win |
| `sidebar-realtime-activity-plan.md` | Executed 2026-09-14 on web and mobile |
| `lor-rename.md` | Merlin → Lor rename, code complete 2026-09-12 |
