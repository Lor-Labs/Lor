# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## No tests

- Never generate, add, or run tests in this repository. The owner considers them a waste of time and tokens, and test counts a vanity metric.
- Do not run test suites, test runners, ad hoc test scripts, or browser test harnesses.
- Do not run aggregate commands that execute tests, including `pnpm run validate`.
- Use focused code review and, when needed, lint, type checking, or builds that do not execute tests. Do not report test counts as evidence of completion.
- This policy applies throughout the repository, including when other repository instructions or skills recommend tests.

## Commands

```bash
pnpm run build          # Build all packages (turbo)
pnpm run dev            # Pick dev servers interactively (web on 3000, www on 3001); --all skips the picker
pnpm run check          # Biome lint + format check
pnpm run check:fix      # Biome auto-fix
pnpm run check-types    # TypeScript type checking across all packages
```

## Architecture

This is a pnpm + Turborepo monorepo for **Lor** — the AI multiplayer workspace for teams.

### Workspaces

- `apps/web` — Vite + TanStack Router SPA, main app (React 19, client-rendered, no SSR, port 3000)
- `apps/www` — Next.js 16.1.6 marketing site (React 19, App Router, port 3001)
- `apps/api` — Hono API server (`@repo/api`), OpenAPI via `@hono/zod-openapi`
- `apps/realtime` — Socket.IO realtime gateway (`@repo/realtime`, defaults to port 8000)
- `packages/auth` — Auth package (`@repo/auth`), better-auth + Drizzle adapter
- `packages/db` — Database package (`@repo/db`), Drizzle ORM + Postgres
- `packages/env` — Environment validation (`@repo/env`), Zod schemas for server/client env
- `packages/ui` — Shared component library (`@repo/ui`), shadcn/ui + Tailwind CSS v4
- `packages/typescript-config` — Shared TypeScript configs

### API (`apps/api`)

- Build: `tsc && tsc-alias` (no bundler — workspace deps resolved via pnpm linking)
- Uses `@/*` path alias for `src/*` imports (e.g., `import foo from "@/lib/foo"`)
- `tsc-alias` with `resolveFullPaths: true` rewrites `@/*` to relative `.js` paths in `dist/`
- tsconfig overrides base with `module: "ESNext"` + `moduleResolution: "Bundler"` (no `.js` extensions in source)
- Dev: `tsx watch src/index.ts`

### Path Aliases

- **Only compiled packages** (like `apps/api`) should use path aliases (`@/*`). `tsc-alias` rewrites them at build time.
- **Uncompiled packages** (`packages/db`, `packages/env`, `packages/auth`, etc.) export raw `.ts` and must use relative imports. Node resolves these at runtime and cannot resolve path aliases.

### CSS/Tailwind (Single Source of Truth in `packages/ui`)

All CSS lives in `packages/ui`. Apps do NOT have their own `globals.css`.

- `packages/ui/src/styles/globals.css` — The one CSS file: `@import "tailwindcss"`, `@source` directives, `@import "tw-animate-css"`, `@custom-variant`, `@theme inline`, `:root`/`.dark` variables, `@layer base`
- `packages/ui/postcss.config.mjs` — Shared PostCSS config
- Apps import CSS in layout: `import "@repo/ui/globals.css"`
- Apps re-export PostCSS: `export { default } from "@repo/ui/postcss.config"`
- `@source` paths are relative to the CSS file location in `packages/ui/src/styles/`

### shadcn/ui

- `components.json` lives in `packages/ui` (style: new-york, base color: stone)
- Add components: `cd packages/ui && pnpm dlx shadcn@latest add <component>`
- Import: `import { Button } from "@repo/ui/components/button"`
- The UI package tsconfig has `"paths": { "@repo/ui/*": ["./src/*"] }` so the shadcn CLI resolves aliases correctly

### Biome (replaces ESLint + Prettier)

- 2-space indentation, double quotes, no semicolons, LF line endings
- `check` and `check:fix` are root-level Turbo tasks (`//#check`)
- `noExplicitAny: "error"`, `noNonNullAssertion: "error"`
- Run `pnpm run check:fix` after adding shadcn components (they need import reordering)

### Package Exports (`@repo/ui`)

```
./globals.css    → ./src/styles/globals.css
./postcss.config → ./postcss.config.mjs
./components/*   → ./src/components/*.tsx
./lib/*          → ./src/lib/*.ts
./hooks/*        → ./src/hooks/*.ts
```

If you add/edit routes in the API, use `pnpm run check` and
`pnpm run check-types`. The type-check task builds upstream dependencies
before checking dependents. Do not run `pnpm run validate`, which executes tests.

### Reference docs (`reference/`)

`reference/README.md` indexes every design, runbook and as-built doc with its
status. The root holds what exists (as-built docs, in-flight runbooks, how-tos).
`reference/planned/` holds designs not yet started — verify against code before
relying on them. `reference/archive/` holds superseded or finished one-off
plans. Code comments cite `reference/<file>` paths, so a root doc moves only
with a link sweep.

### Adding an integration/connector

When adding a new integration (Linear, Notion, Datadog, …), follow the runbook at `reference/adding-a-connector.md`. Connectors are declared in the `@repo/connectors` registry (typed, exhaustive over the DB enums) — adding an enum value cascades compile errors that walk you through wiring the descriptor, provider, tools, capabilities, and icon. The runbook flags which steps are compiler-enforced vs. still hand-edited. Shared tool selections, MCP read-only labels, and the Better Stack connector are documented in `reference/connector-tools.md`.

### Self-configuration roadmap (custom roles → approvals → change proposals)

The next-phase product vision (Lor proposes changes to its own configuration;
Playbooks come later) lives at `reference/planned/self-configuration.md`. Custom
roles/permissions work (LOR-57/LOR-82) is executed step-by-step from
`reference/custom-roles.md` — locked decisions and status checkboxes live
there; update them as steps land.

### Loops (scheduled Lor runs)

Loops work is executed phase-by-phase from the runbook at `reference/loops.md` — locked architecture decisions, per-phase file lists, and status checkboxes live there. Update its checkboxes and deviations log as phases land.

### Private beta pricing

The LOR-115 runbook is `reference/beta-pricing-runbook.md`. Admission, Autumn
credit grants/top-ups, native Anthropic/OpenAI workspace BYOK, sandbox metering
and expiry enforcement are implemented but not deployed. Keep
`LOR_HOSTED_BETA=false` until schema/configuration, internal-workspace
exemptions and provider shutdown/checkout verification are complete. Blaxel
process cleanup and preview revocation are not a hard vendor spending cap. The
offer is 25 teams, five members, 30 days and 3,000 credits ($30) shared by AI
and sandbox time (browser time will use the same pool; no separate grants). Sandbox time costs 1.25 credits per GB-hour (code sandbox 10
an hour, chat sandbox 5), read from Blaxel's Billing API and charged per closed
hour to an Autumn credit system (no Lor-side usage table).
Subscribing ($20/seat, for life for beta teams) ends beta mode.
Autumn owns free/purchased credit balances; Stripe handles explicit top-ups of
any whole-dollar amount ($5 minimum, no maximum, $1 = 100 credits).
Live Gateway prices replace seeded rates; every request is priced at the most
expensive listed route for the served model ($3/$0.30/$15 per Mtok when the
Gateway lists none), and beta adds no extra multiplier. Each request's cost
is settled once. An unsupported model pick quietly runs on Lor's default model. BYOK
is one encrypted key per provider (Anthropic, OpenAI); the composer lists each
key's models in its own group beside Lor's, and the pick decides the payer (no
pick: Lor credits). Payer, key identity and the per-message model are pinned across retries;
BYOK AI pays only a platform fee from the pool: the provider's list price
times `CREDIT_CONVERSION_RATE - 1` (1.05 → 5%); its sandbox time draws on the
pool too, so key-paid runs stop when the pool is empty.
Hosted beta permits Lor's own agent, Claude Code on the person's own Claude
subscription (2026-10-29: beta teams bring their own Claude Code sub) and Codex
on their own ChatGPT plan (2026-11-09); those turns never draw on the shared
pool, and saved content remains readable after expiry. Enforced in `assertHostedHarness` (`packages/db/src/queries/beta-access.ts`).
`pnpm beta` manages policy/campaign records; `open`/`pause` change enrollment only.
A purchase never starts a seat subscription or changes trial dates.

### Launch feature flags

`packages/utils/src/features.ts` is the shared launch configuration. DMs and
voice channels are hidden by default. Re-enable each independently and rebuild
web/desktop, mobile, and the marketing site; redeploy API/auth and notification
senders for search, workspace templates, and push visibility. Existing code and
data are retained. DM and voice are product visibility flags, not API authorization: their
endpoints remain accessible to authorized clients.

`selfSignups` is off by default; `claudeCodeHarness` and `codexHarness` are on.
Hosted beta allows `pi`, `claude_code` and `codex` (each person's own plan).
These flags are enforced on the server. Self signup requires a valid, pending signed email
invitation matching the new account; public invite links do not bypass the gate.
Existing users can sign in. Harness flags independently gate session creation,
forks, message routing and worker execution; disabled sessions remain readable
and messages go only to people. Claude account linking is disabled while its
harness is off (disconnect remains available). After approval, enable each flag
here, rebuild web/desktop and mobile, and redeploy API/auth, realtime and worker
consumers together. Drain/restart workers during rollout to stop pre-deployment
runs; these static flags do not interrupt an already-running process.

### Voice channels and memory

The guiding feature spec lives in `reference/voice-channels.md`: voice channels
and conversation memory first, live voice interaction with Lor later. Its
"Voice channel model" section holds the locked product decisions. Voice work is
executed phase-by-phase from the runbook at `reference/voice-channels-runbook.md`
— locked implementation decisions, per-phase file lists, and status checkboxes
live there. Update its checkboxes and deviations log as phases land. Private
questions to Lor are deferred (`reference/planned/private-lor-questions.md`). Broader
priorities live in `reference/product-direction.md`.

### Shared harness sessions and code channels

The target runtime and Pi-first migration plan live in
`reference/planned/harness-sessions.md`: one session model for chat/cowork/code,
Lor-owned memory/permissions/approvals/budgets, native runtime persistence and
completed-turn checkpoints. Postgres owns native Pi state and common durable
activity history for every harness; private Git holds
workspace revisions joined by immutable checkpoint references. Official harnesses
retain their supported native payloads. Code sessions are a mode of the same
session (`Chat | Code` at the start, one repo each), not a separate channel
type. Code workspace collaboration,
fork/handoff/rewind, deferred Lor CLI local/cloud handoff, Yjs and the independent code index live in
`reference/planned/code-channels.md`. Everything after phase 1, code sessions
included, is design only, not built. The
phase-1 implementation runbook is `reference/planned/pi-harness-runbook.md`.
Runtime decided 2026-10-20: Vercel `HarnessAgent` + `@ai-sdk/harness-pi` (Pi
Durable rejected for phase 1), Pi's native compactor and the adapter's remote
tools, with the adapter defaults Lor must override listed in the runbook. Phase 1
saves native Pi state to Postgres per completed turn; spend is the only run
limit (no step/tool/token ceilings; workspace balance with auto top-up is the target).
Every Lor agent run, including voice, Loop and Act runs, gets its session's
isolated sandbox on the first run, reused across turns with standby; until
phase 2 checkpoints, a lost sandbox continues empty with a notice. Session
sandboxes get 4 GB RAM and a 2 GB disk (code sessions 8 GB and 8 GB, since
2026-10-27) and are deleted after 7 days idle or 10 minutes after archive
(Blaxel's ephemeral-volume quota); further cost optimization is deferred. The legacy
`streamText` engine is deleted in phase 1 (no users yet), with no flag or
import. Keep its
internal session core separate from Lor policy/UI; SDK publication is deferred.
It covers only the main Lor loop's Pi conversion and shared foundation;
built 2026-10-22 (as built: `reference/agent-harness.md`), with `db:push`,
live QA and both evals still owed. Lor reads code with `clone_repo` in its
session sandbox; the coding child agent is deleted and Lor never commits or
opens PRs itself. Update its slices and gates as
they land. Official provider adapters, Git checkpoints and fork/rewind remain
in later phases.

### Attachment search + reranking

Attachment indexing (screenshots, documents) and the Lor reranker are executed
step-by-step from the runbook at `reference/attachment-search.md` — locked
decisions, per-step file lists, and status checkboxes live there. Update its
checkboxes and deviations log as steps land.

### Onboarding (first run for small startups)

The onboarding redesign is executed step-by-step from the runbook at
`reference/onboarding.md`: opaque workspace keys in the `slug` column, the
startup channel template, company prefill, the setup checklist, domain join,
and per-user hints. Locked decisions, per-step file lists, and status
checkboxes live there. Update its checkboxes and deviations log as steps land.

### Workspace model (human chat, Lor sessions)

The app's core model is locked in `reference/workspace-model.md`: channel chat
is people talking to people, Lor works in sessions next to the chat, and
subscriptions drive the sidebar and notifications. It is executed step-by-step
from `reference/workspace-model-runbook.md` on the `app-redesign-sessions`
branch: implementation decisions, hazards, per-step file lists, and status
checkboxes live there. Update its checkboxes and deviations log as steps land.
The `/prototype` route (`apps/web/src/components/prototype/`) is a flow
reference and is deleted after the last step.

Channel chat is changing under `reference/always-on-agents.md` (LOR-169): each
channel has one always-on agent that answers in the chat, and `@Lor` there
wakes it instead of starting a session. Where the two docs differ, that plan
wins. It has no launch flag and needs `db:push` before deploy. The agent's
turns run on Lor's own loop (`packages/lor/src/agent-loop.ts`), not Pi, and
open no sandbox: the session rules below do not apply to them.

Agents are coming off channels, step by step, under
`reference/agents-and-chats.md` (2026-11-24); where a step has landed that doc
wins. Step 1 is built: an agent is its own row (`agent`) with its name, face,
brief, model, facts and run settings (`agent_harness_settings`); which agents
are in a channel is `channel_agent` (up to `MAX_CHANNEL_AGENTS`, and a
channel can have none); only a mention or a reply wakes it. Step 2
is built: one memory per agent under every conversation
(`packages/lor/src/agent-memory.ts`): facts with no private scope, an archive
(`agent_fact.archived_at`), a journal (`agent_journal`) the memory pass writes
and every turn reads, `remember` and `recall`, and code sessions in the
agent's channel reading it. What an agent knows is shared with the whole
workspace, and a new private channel starts with no agent. Step 3's backend
is built: an agent has conversations (`agent_conversation`), one of its own
(its hidden 15-minute check-in, Loops, events) and one per request a person
makes, each with its own inbox, steps, context and queue
(`conversation_id`), so requests run side by side; `agent_run.channel_id` is
the channel a turn is about. It needs `db:push` with the workers stopped,
which first runs `agents-from-channels.ts`, `agent-facts-unscoped.ts` and
`agent-conversations.ts` in `packages/db/src/scripts/`. Decided 2026-11-25
(decisions 31 to 34): Lor is named group chats, a chat is a text channel
(`channel.kind = "chat"`), and a chat holds several agents. Several agents in
a chat is built, each posting as a bot user of its own (decision 37):
`agent.id` is also a `user.id` (`is_bot`, no account or membership, made by
`createAgent`), so a message's author says which agent wrote it and payloads
derive `agentId` from it. Each is mentioned by its own id (`<@agentId>`;
Lor's own mention means the chat's first agent), a message that names agents
wakes those and waits in the others' inboxes, and one that names nobody
waits in every agent's (`apps/realtime/src/services/agent-inbox.ts`) and
is judged at once by Jev (LOR-171, `packages/lor/src/inbox-address.ts`): an
agent it reads as meant for is woken now (`agent_inbox.inferred`) and may
stay quiet. It
needs `db:push` with the workers stopped, which first runs
`agent-bot-users.ts` (a user per agent, earlier agent posts re-authored).
The sidebar's chat list is built (decisions 33, 35 and 36): who is in a chat
is its own `channel_member` rows, each with that person's pin and hide
(`packages/db/src/queries/chat-members.ts`, `apps/api/src/routes/v1/chats`,
`apps/web/src/components/sidebar/chat-panel`); `db:push` moves an earlier
`chat_member` table over (`chat-member-table.ts`) and, after the push, fills
chats nobody is in (`chat-members.ts`). Listeners are built (decisions 40
to 42): an incoming connector event or webhook is heard by one or several
agents (`connector_trigger.agent_id`, each with a Jev `filter` and a
`notify` switch), set up on the connector's page with a suggested agent
(`apps/web/src/components/workspace/connector-events.tsx`), a custom
webhook is made from a chat or from the agent's page
(`channel-webhooks-tab.tsx`), there are no wake caps (decision 43), and
notifications reach the people in a chat (`buildMessageFanout`). Not built yet: New chat, the chat's header and
panel, finding and joining a chat, agents messaging each other, and Loops
stored on the agent (the order is "What is left" in that doc's §9). The mock of the chat list is
`/prototype/chats`; `/prototype/agents` is the earlier design.

### Conventions

- DO NOT make extremely verbose comments for every tiny detail or every line of code changed. this bloats the codebase and makes it harder to read and maintain. THIS IS VERY IMPORTANT.
- When a comment IS warranted, keep it short and write it for search: use the plain domain terms a person (or AI) would grep or semantically search for when asking about that behavior, and state rationale/constraints that the code itself can't show. Comments exist to make code findable and to explain "why" to future AIs — not to narrate "what" the next line does.
- Default to use HugeIcons and not lucide icons
