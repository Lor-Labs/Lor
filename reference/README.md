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
| `agent-harness.md` | Durable runs on the Pi path (rewritten 2026-10-22): Postgres-owned run and Pi state, per-turn saves, leases, spend-only limits, steer/stop, context meter |
| `harness-accounts.md` | Multiple Claude Code/Codex accounts, workspace defaults, quota fallback and autonomous billing; schema rollout required |
| `artifacts.md` | Artifact + version model (Postgres/R2), the session sandbox and `share_file` (rewritten 2026-10-22) |
| `automation-primitives.md` | Triggers, effects, Act, custom tools, MCP servers |
| `mcp-oauth.md` | Workspace-scoped OAuth for MCP servers (written as the plan; routes shipped) |
| `lor-mvp-spec.md` | Lor MVP as built: brain, retrieval, write-back; overrides the archived architecture doc |
| `github-connector.md` | GitHub App, `clone_repo` code reading in the session sandbox, definition-of-done list; status 2026-10-22 (coding child and draft-PR loop deleted) |
| `context-continuation.md` | Continuation on the Pi path (deltas, Pi compaction), data-to-file pipe, `read_thread`/image fixes; legacy replay and compaction sections kept as history |
| `loops.md` | Scheduled Lor runs |
| `tasks-v2.md` | Plans (formerly tasks): emergent tasks, thread anchors, scope-keyed sandboxes |
| `custom-roles.md` | Custom roles + permission enforcement (LOR-57/82) |
| `channel-events.md` | Inline system messages in the channel timeline (LOR-86) |

## Root — in flight

| Doc | Open |
|---|---|
| `beta-pricing-runbook.md` | LOR-115, 2026-10-27: FCFS admission, $25 AI/top-ups, native Anthropic/OpenAI BYOK, estimated sandbox limits and expiry gates built; migration/provider verification and strict spend caps remain; hosted beta stays disabled |
| `always-on-agents.md` | LOR-169, started 2026-11-18: one always-on agent and one chat per channel. A per-channel inbox with two lanes (wake now, wait unread), the agent speaking only through `send_message`, code sessions as helpers, memory and context rules, Discord. Slice 1 built 2026-11-19 with no launch flag: the inbox, mention wake, and the agent's own loop (stored steps, a prompt frozen per epoch, compaction on the warm cache, `read_agent_history`, approvals in the chat, no sandbox), checked live on the dev database; per-channel model and wake settings, "Lor is typing", and the tour rewritten. Slice 2 built 2026-11-19: `start_session`, `check_session`, `message_session`, `stop_session`, session reports in the inbox, read-only helper sessions, a chat line per session; plan-backed coding agents owed. Slice 3 built 2026-11-19: webhook and connector events and Loop fires go to the inbox, approvals on turns nobody started ask the Loop's creator or the trigger's last editor, New session is code only, chat sessions are read-only, `@Lor` in a thread answers there, Loops and workspace change proposals from the chat. Slice 4 built 2026-11-20: the channel profile (a brief people write, facts the agent keeps), the memory pass on the warm cache replacing write-back for the agent, a log and an open block from records, a standing cache check; it found and fixed a strict-schema 400 that had sent every agent call to Vertex. Slice 5 built 2026-11-20: `wake_up` with Follow-ups in the channel panel, the check-in Loop on every channel (skipped when nothing is unread, editable hours), and the sidebar's Needs you and Channels tabs. Slices 6 and 7 built 2026-11-21: Discord (linking, a mirrored read-only chat, threads, approval buttons), named agents with a pixel-art bestiary, and code sessions on Claude Code or Codex only. Merged into `dev` 2026-11-21 (PR #273). Owed: the production rollout (step 7.6, with `db:push` per environment) and a brief QA. Next (decision 36): a computer for each agent that people can watch, with the creatures now drawn as simple faces and the pixel set kept in the code, unused (decision 39). The sidebar became one list on 2026-11-21 (decision 37: channels stay, each row shows its agent, your sessions sit under it, Needs you is a group on top) |
| `agents-and-chats.md` | Started 2026-11-24: agents apart from channels. An agent is a teammate for a role with its own name, brief, model and facts, added to channels; a channel is only where people talk and can have no agent; a chat is one piece of work with one agent. Step 1 built 2026-11-24: the `agent` table and `channel.agent_id`, facts per agent, the data move run before every `db:push`, mentions-only waking, the agents API, the channel Agent tab and an Agents section in workspace settings; `db:push` on the shared databases owed. Not started: chats with their own queue (step 2), accounts and tools per agent (3), Discord threads and DMs (4), Slack (5). Changes the shape of `always-on-agents.md`. The mock at `/prototype/agents` shows the whole design |
| `act-sessions-runbook.md` | Act session modes (per event, per subject, ongoing), people-first waiting, code sessions from triggers and webhooks. Started 2026-10-28 |
| `dev-environment-runbook.md` | Code session Environments, Preview tab and Terminal tab behind a provider seam (Blaxel now, cheaper provider or own infra later). Started 2026-10-29 |
| `boat-fallback.md` | Boat (boat.dev) VMs take new session sandboxes when Blaxel's RAM quota is full; built 2026-11-05, full in-app session still owed |
| `skills-and-commands.md` | LOR-151, 2026-11-06: each harness's own slash commands and skills as its CLI takes them, repo skills included; command turns, per-session menus. `db:push` and live QA owed |
| `connector-tools.md` | Shared tool selections, MCP read-only hints, Better Stack, Notion/Attio writes |
| `voice-channels-runbook.md` | Voice calls, transcription, Lor in the call, memory. V0–V7 built; prod setup, live QA and merge open |
| `approval-policies.md` | Per-tool approval rules, resolver controls, breaking schema rollout, and pause/resume on the Pi path (2026-10-22) |
| `change-proposals.md` | Workspace change proposals (self-configuration pillar 3). P6 vertical-slice QA |
| `attachment-search.md` | Attachment indexing + reranker. Steps 1–6 built; 4b and 7 parked behind triggers |
| `onboarding.md` | First-run redesign for small tech startups: opaque workspace key, startup channel template, company prefill, setup checklist, domain join, per-user hints, permission changes. All 10 steps built 2026-10-08; prod db:push + rekey and live QA owed |
| `workspace-model-runbook.md` | Human-only channel chat, Lor works in sessions: 22 steps on `app-redesign-sessions`. Started 2026-10-08 |
| `session-files-runbook.md` | Right-rail file panel, one file chip, session-owned artifacts, no Lor sessions in the thread panel, `ThreadPanel` split. All steps built 2026-10-13; Step 4a `db:push` + backfill owed |

## Root — specs, how-tos, checklists

| Doc | Use |
|---|---|
| `local-development.md` | Contributor setup, required services, local signup, repository map, and commands |
| `product-direction.md` | Current priorities and what is deferred |
| `positioning.md` | Current www narrative and capability boundaries (2026-10-25), with earlier marketing and sales positioning retained as history |
| `voice-channels.md` | Guiding product spec for voice; its "Voice channel model" decisions win over the runbook and research |
| `workspace-model.md` | Locked design for channels, Lor sessions, subscriptions and archive; wins over its runbook on product behavior |
| `adding-a-connector.md` | Runbook for wiring a new integration |
| `error-reporting.md` | Backend error capture, Better Stack configuration, and channel notifications |
| `signup-notifications.md` | Optional signup notifications to an operator-configured channel webhook (LOR-105) |
| `mobile-release.md` | TestFlight / EAS release loop |
| `mobile-parity-todo.md` | Living web ↔ mobile gap checklist |

## `planned/` — not built

| Doc | Status |
|---|---|
| `pricing-and-billing.md` | Historical pricing research and editable economics for LOR-16, 2026-10-16; 3× inference and 4 GB cost assumptions are superseded for launch by the root `beta-pricing-runbook.md`; no production pricing changes |
| `agent-browser.md` | Cloud browser Lor drives in a session: live view, take over, per-channel logins. Research and design 2026-10-12; builds after the sessions branch merges; vendor (Browserbase or Steel) decided by a spike |
| `sandbox-browser-runbook.md` | Code sessions, 2026-11-03: Chromium in the session sandbox with a VNC live view, take control and Lor's CDP command (steps 0, 3 and 4 built and live), `.lor/environment.json` v2 with `"default": false` and Start app (LOR-125, built), sandbox size on the Lor environment and element annotations (built, not run live) still to QA; step 7 (2026-11-11, image not pushed): Start with Restart/Stop and stuck-server detection, and working together in the browser (who is here, everyone's pointer and Lor's, shared annotations without control, share links); step 8 (2026-11-11, needs `db:push` and an image push): preview links, `/preview/<token>` outside the app, private to the workspace or public to watch, with roles enforced by the sandbox's gateway and annotations stored in Postgres |
| `pr-reviews.md` | PR reviews in code sessions (LOR-127 follow-up), 2026-11-06: GitHub review webhooks matched to a session by its `lor/` branch, a collapsible review card in the session thread and a Review list in the Details tab read live from GitHub, Fix with Lor; bots and people; steps 1–4 built 2026-11-06, `db:push`, webhook subscriptions and live QA owed |
| `linear-projects.md` | Lor projects linked to Linear projects. Split from onboarding 2026-10-07; open for its own design thread |
| `code-channels.md` | Code sessions (Chat/Code modes, repos, pickers, code Loops, repo instruction files; decided 2026-10-21; people commit and open PRs, no coding child, 2026-10-22), workspace collaboration, fork/rewind, local clone and Yjs; design only |
| `code-sessions-runbook.md` | Code sessions launch scope and chunks (2026-10-22): stage 1 on Pi (code mode, Continue in Code, Changes window, personal GitHub commits), stage 2 before charging (checkpoints, rewind/fork, Claude Code, Codex); chunks 1–8 built by 2026-10-26 (chunk 4's Lor bot later), live QA owed; next OpenCode and ACP agents |
| `harness-sessions.md` | Finalized architecture, 2026-10-19; runtime decided 2026-10-20 (`HarnessAgent` + `harness-pi`): Pi-first migration, sandbox for every agent run, common Postgres activity, native Pi state + private Git files, checkpoint/fork and import rules; implementation gates recorded; CLI deferred; phase 1 built 2026-10-22 (see the runbook), later phases not built |
| `pi-harness-runbook.md` | Phase-1 runbook, revised 2026-10-20: runtime decided (`HarnessAgent` + `harness-pi`; Pi Durable rejected), per-turn native saves to Postgres, spend-only run limits, sandbox for every run kind, adapter overrides and remaining gates G1–G7; 1.1–1.3 built 2026-10-21, 1.4–1.6 built 2026-10-22; `db:push`, live QA and evals owed |
| `sandbox-safety-research.md` | Research record behind the §4.6 sandbox safety policy, 2026-10-21: how Claude Code, Codex, Cursor, Gemini CLI, VS Code, OpenCode, Goose, OpenHands and others gate commands and edits; production classifiers and their numbers; research evidence; incidents; Blaxel network controls |
| `context-engine.md` | Unblocked-style linked, ranked, permission-safe context. Research + proposed design 2026-10-10; §7 build order and §8 decisions revised 2026-10-17 |
| `context-engine-phase-2.md` | Runbook, 2026-10-17: Remember removed, GitHub/Linear/Attio ingested as real text with chunks on webhooks (a search index, not a mirror); BM25 + hybrid search, filters, ranking priors, conflicts. Ships with phase 1 in one release |
| `live-collaboration.md` | Editor decision (TipTap over Plate, 2026-10-09) and the MIT build map for live multiplayer documents |
| `team-agents.md` | Superseded 2026-11-18 by `always-on-agents.md` (root). The LOR-169 proposal through eight revisions (threads, a page per agent, the room), kept as the record of how the design was reached. The mock at `/prototype/orchestration` follows its §5; `/prototype/agents` now shows `agents-and-chats.md` |
| `self-configuration.md` | Vision for Lor proposing changes to itself; pillars 1–2 shipped (root runbooks), pillar 3 in flight |
| `playbooks.md` | Working idea, not a spec |
| `private-lor-questions.md` | Deferred platform decision (2026-09-28) |
| `session-memory.md` | Context engine phase 1: scope `source` (leak fix), session-aware search hits, brain page versions + `edit` + per-page concurrency (no workspace lock), write-back gate context, the general `touch` table with sessions first and reverse hints. Phase 2 direction: default ingestion into `source`, real text, Remember removed. Decisions locked 2026-10-14; session summaries and turn embeddings deferred behind an eval |
| `session-memory-research.md` | Research record behind `session-memory.md`: the 2026-10-14 literature pass (sources, setups, exact numbers, verification labels, unverified claims) and the internal code audits |
| `slack-connector-next.md` | Read-only Slack connector, not started |
| `sync-engine.md` | Sync engine research (Zero, TanStack DB, Electric, PowerSync, Convex, local-first) and a proposed Zero-first spike with go/no-go gates. Not committed; only the timing is decided: React Query until the sessions branch merges |

## `archive/` — superseded or done

| Doc | Why archived |
|---|---|
| `lor-agent-architecture.md` | North-star memory architecture; `lor-mvp-spec.md` is what was built |
| `voice-channels-livekit-research.md` | Research input; `voice-channels.md` decisions win |
| `sidebar-realtime-activity-plan.md` | Executed 2026-09-14 on web and mobile |
| `lor-rename.md` | Merlin → Lor rename, code complete 2026-09-12 |
| `roadmap.md` | Townhall-era roadmap; `product-direction.md` is current |
| `mobile-architecture.md` | Original iOS plan; `apps/mobile` is as built (no `ui-native` or `chat-core`) |
