# Automation Primitives — Triggers, Effects & Custom Tools

> Status: **design accepted** (2026-08-14, design conversation with jacob). Phases 1–5
> (trigger generalization + first-party conformance; Attio events + ingest; BYO
> Webhooks incl. the `channel_webhook` fold and dialect endpoints; Act; custom tools)
> implemented 2026-08-14/15. Per-tool profile grants + **MCP servers**
> implemented 2026-08-16.
> Closes the design question in Linear **LOR-49** ("programmatic ways to index data") and
> subsumes bring-your-own webhooks (the evolved `channel_webhook`) and "webhook-triggered
> Lor actions."
> Read `lor-mvp-spec.md` §6 (sources) and `adding-a-connector.md` first.

## 0. Product stance

Lor is moving toward **self-configurable primitives** — the app should behave like a
configurable agent harness (cf. the Pi coding harness), where the harness's behavior is
*data the agent itself can edit*, not hardcoded product flows.

Two rules resolve "powerful and flexible" vs. "opinionated":

1. **Unopinionated about what Lor does.** No workflow builder, no field mappers, no
   hardcoded dispositions. Configuration is prose instructions + declarative rows.
2. **Rigid about provenance, cost, and consent.** Every unattended run is recorded with
   full provenance; every trigger has budget caps and a kill switch; loops are guarded
   at the infrastructure level. These are physics, not product opinions.

The load-bearing mental model: **a channel is an agent environment.** Its configuration =
enabled connectors + custom tools (via agent profiles) + inbound triggers with their
instructions. Lor's long-term job is to edit that configuration itself
(see `product-direction.md` — self-configuring agents), which imposes one hard
architectural invariant today:

> **Every primitive below must be a DB row with a CRUD API — never config-file- or
> code-only.** Lor self-configuration is just Lor calling the same endpoints the
> settings UI uses. Anything that lives only in code kills that story.

## 1. The primitives

| Primitive | What it is | Scope | Status |
|---|---|---|---|
| **Connection** | OAuth/API-key link to a provider (`integration_connection`) | workspace | exists |
| **Custom tool** | user-defined tool descriptor Lor can call (HTTP template + args schema) | workspace registry, per-channel enablement like connectors | new |
| **Webhook** | user-created inbound URL (a `webhook`-provider connection + its trigger) | channel | exists as `channel_webhook`; folds in |
| **Trigger** | inbound event: a connector event *or* a webhook delivery | belongs to a connection, **anchored to one channel**; fans out to effects | partially exists (`connector_notification_route` is the POST-only ancestor) |
| **Effect** | what happens on delivery: **POST**, **Remember**, **Act** — any combination | per trigger | POST + Remember exist in pieces |
| **Instructions** | layered prompt context: workspace → (channel, future) → trigger | trigger instructions enter context *only* when that trigger fires | workspace exists |
| **Triggered run** | a normal `agent_run` with trigger provenance | logged always; visible in channel only if Lor posts | machinery exists, composition new |

Tools and triggers are deliberately **orthogonal**. A custom query API with no inbound
events is a valid connector; an inbound feed with no tools is a valid connector; trigger
instructions glue them together ("when this event arrives, use the `query_orders` tool to
look up the account, then …").

## 2. Effects: POST, Remember, Act

Effects form a cost/power ladder. A trigger can enable any combination. Every trigger is
anchored to one channel, which is the target/scope of all its effects.

Effects apply **uniformly**: first-party connector events and user webhooks flow through
the same trigger rows. No hardcoded per-provider behaviors survive — GitHub's
`SOURCE_INGEST_ENABLED` flag and the notify-only route path are retired in favor of
per-trigger effect config (no users yet; no back-compat constraints).

### POST — deterministic message into the trigger's channel

Zero model calls, instant.

- Webhook triggers post a verbatim `content` string (or a readable rendering of the
  payload) under the webhook's identity (name + avatar) — the folded-in
  `channel_webhook` behavior, unchanged.
- First-party connector events post the formatted event text under the provider label
  (the current `postConnectorNotification` shape).
- **Memory rule:** the posted message is `excludedFromMemory` **iff Remember is enabled
  on the same trigger** — the `source` row is then the canonical copy and double-storing
  would pollute. POST-only messages remain canonical chat content (searchable, in
  memory), exactly like today's channel webhooks.

### Remember — fixed pipeline into `source`

`ingestSource` (`packages/lor/src/sources.ts`): one bounded summarize call + embed →
`source` row → retrievable via `search_sources`. **Not** an agent loop, no tools. This is
LOR-49: index data silently, notify no one.

- The trigger's optional **hint** text ("this receives Fireflies transcripts; capture
  attendees and decisions") is prepended to the summarization prompt. That's the only
  configuration Remember has or needs.
- **The brain is never written directly.** External data lands in `source`; brain pages
  stay Lor-authored (synthesis pulls from sources). Webhook data writing the compiled
  layer directly would pollute it.
- **System-of-record exception (webhooks only):** a webhook has no provider to
  live-fetch from, so the "summary + pointer, never store whole" rule
  (`archive/lor-agent-architecture.md` §2.2) breaks deliberately: the capped raw payload (64KB)
  is stored on the `trigger_delivery` row. First-party connectors keep true
  pointers (e.g. Attio transcripts are live-fetched). Known gap: the webhook
  provider's `fetchContent` returns null for now, so Lor retrieves the summary
  but can't yet pull the stored raw payload — wiring `fetch_source` to the delivery
  log is a follow-up.
- Upsert: honor a top-level `external_id` (or `id`) field in a webhook delivery for
  in-place re-ingest (the `source` unique index already supports this); otherwise each
  delivery is a new row keyed by delivery id.

### Act — hand data + instructions to Lor, let it decide

> **Superseded 2026-10-09 (workspace model, Step 17).** Each Act run now starts its own
> Lor session in the anchor channel: the payload is the session's first turn (a
> `trigger_run` event line), and Lor answers it as a normal visible session run. The
> trigger's instructions sit in the system prompt of every run in that session.
> `post_channel_message` and `create_plan` are gone; Lor never posts in channel chat.
> The person who connected the source follows the session; Lor mentions anyone else.
> See `reference/workspace-model.md` (decision 1) and `apps/worker/src/lib/trigger-session.ts`.
> The text below is the original design.

An **agent run** composed as: the channel's normal toolset (connectors granted by the
channel's agent profile, **including custom tools**) + the trigger's instructions + the
normalized payload as the user turn. Trigger instructions are *not* in the system prompt
at any other time.

Lor decides the disposition:

- **post** to the channel,
- **create a Task** (escalation it chooses — e.g. multi-step work), or
- **do nothing** — the run's final output is discarded; the only trace is the run/delivery
  log on the connection page. No channel whisper.

A Task is an *outcome Lor can choose*, never a mandated shape. Auditability is an
infrastructure property (every triggered run is an `agent_run` row with provenance:
trigger id, delivery id, instructions snapshot), not a UX artifact.

The trigger's anchor channel defines the toolset and is where posts/tasks land.

## 3. Webhooks (bring-your-own inbound)

The existing Discord-style `channel_webhook` **evolves into this primitive** rather than
living alongside it — one inbound-URL concept, user-facing name **"Webhooks"**. A
POST-only webhook behaves exactly like today's channel webhook; Remember and Act are
upgrades on the same URL.

- **Channel-scoped by design.** A webhook is created on a channel (channel settings) and
  its trigger anchors there: POST targets that channel, Act runs with that channel's
  toolset. A Remember-only webhook visibly does nothing in its channel — that's the
  user's choice, and it's fine.
- **Modeling:** one `integration_connection` row per webhook with a new
  `integrationProviderEnum` value **`webhook`** (`externalId` = webhook id,
  `accountLogin` = display name, `avatarUrl` for the post identity, verification token
  encrypted at rest) + one `connector_trigger` row anchored to the channel, created
  together in one flow. The connection row buys: `source` rows with a valid
  `connectionId`/provider discriminator (→ `search_sources` works), the trigger
  machinery, and the registry compile cascade — exactly what `lor-mvp-spec.md` §6.2
  designed for. Not listed on the connect-a-provider page.
- Inbound endpoint keeps the current shape: `POST /v1/webhooks/:id/:token` — timing-safe
  token compare, ack fast, process async, URL treated as a secret.
- **Dialect endpoints, never payload sniffing** (implemented on today's
  `channel_webhook` execute route; carries into the fold): the base URL speaks Lor's
  native shape (`{ content, username? }`, markdown); `.../discord` accepts Discord
  execute-webhook payloads (content/embeds); `.../slack` accepts Slack
  incoming-webhook payloads (text/blocks/attachments, mrkdwn converted). Same pattern
  as Discord's own `/slack` compatibility route — switching providers is repointing a
  URL. **Data layer matches each vendor's spec exactly** (jacob's stance: point the URL
  at Lor and everything works the same) — including sender-chosen **accent colors**
  (Discord `embed.color` decimal int; Slack `attachment.color` hex or
  `good`/`warning`/`danger`), normalized to `#rrggbb`. **Presentation is ours** (shipped
  2026-08-17): embeds/attachments become structured `message.embeds` cards (accent
  strip, author, markdown description, field grid, image, footer/timestamp) rather than
  markdown blockquotes — the blockquote renderers survive as the text form Remember and
  Act ingest. Slack *blocks* stay markdown (they're the message body, not a card);
  interactive blocks are dropped rather than half-rendered; `avatar_url` is deliberately
  absent from the schema (zod strips unknown keys — identity always comes from the
  webhook's stored, bucket-restricted config). See `apps/api/src/lib/webhook-payloads.ts`
  and `apps/web/src/components/chat/embed-card.tsx`. A richer *native* shape is still
  deferred — see message UI blocks in §9.
- `CONNECTOR_EVENTS.webhook` = one event, `data_received` — every delivery is that
  event; per-webhook configuration lives on the trigger (effects + hint + instructions).
- **No field mapping, ever.** Arbitrary JSON in. POST stays deterministic (verbatim
  `content` or a readable rendering); Remember/Act run the small normalization pass
  (title/text extraction), steered by the trigger hint — the AI-native replacement for
  Zapier's entire mapping UI. Conditions/branching live in Act instructions as prose
  ("if the deal is under $10k, do nothing") — the model evaluates them.

## 4. Custom tools

A workspace registry of user-defined tools Lor can call. **Shipped 2026-08-15.**

**Descriptor (a row, authorable by humans in a form and by Lor via API):**

- `name` (snake_case, unique among active, rejected if it matches a built-in tool
  name — and built-ins always win at bind time regardless), `description` (when to
  use it — this is the model-facing contract)
- `argsSchema` (JSON Schema, `type: object`)
- execution: HTTP method + URL/header/body templates with `{{args.x}}` /
  `{{secrets.KEY}}` placeholders; secrets AES-256-GCM encrypted (same as connection
  tokens), write-only through the API, decrypted at call time only. Placeholder
  encoding is context-aware: percent-encoded in URLs, JSON-encoded in bodies
  (`"q": {{args.q}}` is correct for any value type), raw in headers. Null body
  template on POST/PUT/PATCH sends all args as JSON. GraphQL works as a POST body
  template — no separate shape needed.
- `mutates` — **dropped** (see §6.5): approval gating will be permission-based
  config shipped with the approvals design, not a mutation classification.
- **hard delete, no version history** (jacob: "just let them change the tool").
  Deleting cascades per-profile grants away via FK (supersedes the earlier
  archive-not-delete stance — the join table made real deletion safe); the
  delete confirmation shows how many profiles grant the tool (`usedByProfiles`).
- SSRF stance (v1): HTTPS-only, no IP literals, no localhost/.local/.internal/
  dotless hostnames, no credentials in URLs, checked on the template at create AND
  the interpolated URL at call time (hosts can never come from args — placeholders
  fail hostname validation). Redirects refused; 15s timeout; 256KB response cap.
  DNS-pinning is a hosted-hardening follow-up.
- Implementation: `packages/db/src/schemas/custom-tools.ts`,
  `packages/lor/src/custom-tools.ts` (binding + execution, unit-tested),
  CRUD at `/v1/workspaces/:slug/custom-tools`, settings UI
  `apps/web/src/components/workspace/custom-tools-section.tsx`.

**Enablement (per-tool granularity shipped 2026-08-16):** workspace-wide
registry, granted per channel through agent profiles at two levels:

- the **`custom_tools`** capability = blanket "all custom tools, including ones
  added later" (what `grantsAll` profiles resolve to);
- otherwise the profile's explicit grant list — **`agent_profile_custom_tool`**
  join rows (a real join table, not an id array: tool deletion cascades grants,
  "which profiles use this tool" is indexed, and per-grant metadata — e.g.
  approvals — has a home later).

Resolution lives in `packages/lor/src/capabilities.ts`
(`resolveChannelCapabilities` → `ChannelToolGrants { capabilities, customTools:
"all" | string[] }`); binding filters by the grant in `workspaceCustomTools`.
The profile editor shows the blanket tile plus one tile per tool (tiles render
checked-and-dimmed while the blanket is on).

**cURL is the import path for single HTTP tools** (jacob — supersedes the earlier
OpenAPI-import idea): the create form accepts a pasted curl command
(`apps/web/src/lib/parse-curl.ts`) and prefills method/URL/headers/body; the author
then swaps real credentials for `{{secrets.…}}` references.

**Next on the horizon (agreed 2026-08-15, unbuilt):**

- **Postgres / database querying** — real demand, but connector-grade treatment
  (credentials, read-only enforcement, schema introspection), never a custom-tool row.

**MCP servers (shipped 2026-08-16):** the vendor ecosystem converged on
remote MCP (Linear, Notion, Sentry, Stripe, Cloudflare…). NOT a shape of
`custom_tool`: an MCP server serves its own live tool list/schemas, so it's a
separate **`mcp_server`** primitive — URL (Streamable HTTP, same SSRF stance
as custom tools, checked at create AND connect) + static auth headers with
`{{secrets.KEY}}` references + **`enabledTools` allowlist** (generalizing the
`datadogMcpTools` pattern; exists so an upstream tool addition can't silently
widen Lor's surface — new tools stay off until enabled). Sessions per
respond() call like Datadog: granted servers handshake in parallel under one
8s cap, unreachable servers drop out, tool results cap at 256KB, sessions
close in respond()'s finally. Collisions skip-and-log (built-ins → custom
tools → servers in name order). Grants ride the same two-level model as
custom tools: the blanket `custom_tools` capability (relabeled "All workspace
tools") covers both kinds; otherwise per-profile `agent_profile_mcp_server`
join rows. Auth v1 is static headers only — **OAuth-flow MCP (dynamic client
registration) is planned in `reference/mcp-oauth.md`**. UI: the settings section
is now "Tools" with a kind picker (API Tool / MCP Server); the MCP form's
"Connect & discover" step
lists the server's tools for allowlisting (all pre-checked on first connect;
refresh keeps the current selection). CRUD + discover endpoints at
`/v1/workspaces/:slug/mcp-servers` (`packages/lor/src/mcp-servers.ts`,
`apps/web/src/components/workspace/mcp-servers-section.tsx`).

## 5. Guardrails on triggered runs (physics, not opinions)

- **Loop guards.** Runs carry origin (`triggered_by` on `agent_run`); posts/side-effects
  of a triggered run can never re-trigger anything. Bot/webhook messages never trigger
  message rules (none exist yet — see §8).
- **Act rate shaping (built 2026-08-17).** The motivating case: a health monitor POSTs
  every error serially into `#health`, a DB fault produces 500 deliveries in 20 minutes,
  and the old single daily cap turned that into 100 agent runs followed by a blind spot
  for the rest of the day (a fuse, not a throttle). The governing rule (jacob): **a
  delivery is never dropped for being blocked — it queues.** Being blocked only ever
  changes *when* and *with what company* Lor looks, never *whether*. Three layers, in
  `packages/lor/src/act-runs.ts` (shared: the API arms windows on ingest, the worker
  flushes them minutes later):
  1. **One run per trigger at a time.** The partial unique index
     `agent_run_triggerId_active_uidx` makes this a database invariant rather than a
     check that can race (until Step 17 of the workspace model it was `scopeKey =
     triggerId`; the run now moves into its own session's scope). `actGuard` pre-checks it so a burst
     doesn't spend cap slots on runs Postgres would reject anyway. A delivery that
     arrives mid-run **queues** — even in immediate mode, where the trigger borrows the
     batch machinery with a 30s window purely to hold the work.
  2. **Coalescing window** (`actWindowSeconds`, default 300; `0` = one run per delivery).
     **Leading edge, then trailing batch** — the window coalesces, it never delays: the
     first delivery of a quiet period wins a conditional `UPDATE … WHERE
     act_window_opened_at IS NULL` (Postgres owns the dedupe, not Redis), **runs
     immediately**, and the window opens behind it with a delayed `act-flush` job. A lone
     event therefore has zero added latency — the earlier design made it sit out the full
     window, which was indefensible for a one-off "customer is a churn risk" webhook.
     Everything arriving while that run is going joins the window, and at flush becomes
     ONE follow-up run: all unclaimed deliveries claimed onto it
     (`trigger_delivery.run_id`) and quoted as a single user turn — oldest 3 + newest 3,
     with the true count and time span, framed as "N further deliveries … after an earlier
     run already handled the first one" so Lor checks for escalation instead of
     repeating work. This is the layer that makes investigations *better*, not just
     cheaper: "482 errors in 5 minutes, here's the first and the latest" beats one
     arbitrary stack trace.
     The window is **fixed/tumbling, not sliding** — a resetting debounce would mean a
     continuous error stream never flushes at all, the worst failure mode during an
     incident. Batched triggers store `trigger_delivery.act_payload`/`act_label` (the
     flush runs later and can't be handed the payload on the job). A flush that lands
     while a run is still going **re-arms** instead of dropping, so the batch keeps
     growing; a window older than an hour is abandoned and logged (a wedged run must not
     defer forever), and a window whose flush never arrived goes stale after 3× its
     length so a new delivery can re-arm it.
  3. **Rolling caps**: `hourlyRunCap` (default 3) and `dailyRunCap` (default 20), counted
     over `agent_run.created_at`. Hourly exists so a burst can't eat the whole day's
     budget; daily is the outer fuse. A cap doesn't discard the batch — `actGuard` returns
     *when the rolling window frees a slot* (from the oldest run in it, clamped to
     30s–15min) and the flush re-arms for then, so the queue keeps growing and fires as
     soon as budget exists. Per-run budgets still reuse `defaultRunBudgets()` — those
     bound each run's blast radius, whereas these bound run *count*.

  The queue is "every delivery Act hasn't handled yet" (`run_id IS NULL` and an
  `act_payload`, within 24h), deliberately **not** a slice of the window's clock — a
  delivery that waited through several windows still lands in the next batch. 24h is the
  stated bound: older than that is history, not an incident. Since blocked work never
  drops, the only ways queued deliveries could rot are a *lost* flush job or a run that
  died holding its claim, so both are swept:
  - `connector_trigger.actFlushDueAt` records when the open window's flush is expected.
    A blocked batch pushes it forward as it re-arms, which is what lets the 5-minute
    `sweep-act-windows` job tell "the job was lost" from "this batch is legitimately
    waiting" — without it, a long cap block would accumulate a new flush chain every
    sweep. The sweep *claims* what it re-arms (one UPDATE … RETURNING) so concurrent
    workers can't double-enqueue.
  - `sweepDeadRuns` releases an abandoned triggered run's claimed deliveries
    (`releaseActRunDeliveries`) and re-arms the trigger. The dead run stays in
    `agent_run`, so its recorded actions and any note are still in the successor's
    briefing — the batch is retried *with* the knowledge that an attempt already died.
  All three layers are per-trigger columns on `connector_trigger`, exposed in the Act
  effect row (`apps/web/src/components/workspace/trigger-effects.tsx`) for both BYO
  webhooks and connector events. Sender-side grouping (Alertmanager `group_by`,
  issue-level rather than event-level alerts) is still the right first line, and feeding
  the Acting trigger state *transitions* rather than every event remains the recommended
  shape.
- **Kill switch + delivery log.** Every trigger has an enabled flag; the connection page
  shows recent deliveries, their effects, and run outcomes (including silent no-ops).
  With queuing, the log is also the queue's only window: a delivery with no `runId` yet
  is *waiting*, not lost — which the delivery-log UI should say out loud.
- **Continuity across runs — the handoff note (built 2026-08-17).** A trigger is a
  long-running *concern* ("the health of #health"), not a stream of unrelated events, but
  a triggered run used to get exactly one thing: the payload. No channel history, no idea
  it was the 4th run today, no idea a predecessor had already filed a PR for the same root
  cause — so it filed a second one. Worse, the prompt told the model *"your final answer
  text is discarded"*, throwing away the one place it naturally summarizes what it just
  concluded (and inviting it to phone in the ending).
  Now that text **is** the state: it's stored as `agent_run.handoffNote` and the prompt
  asks for a successor-facing note — diagnosis, what it did with checkable references,
  what to verify next. The next run on the trigger is briefed with (`actRunBriefing`):
  - the **last 3 runs within 24h**: outcome (`state`/`stopReason`), the note, and a
    **mechanical action list** from `agent_run_tool_result` — which is what makes a run
    that died *after* filing a PR but *before* writing a note still legible. It's labeled
    "recorded actions" rather than "side effects" because that allowlist also covers
    billed-but-read-only work like `investigate_code`;
  - a **run count** for the last 24h, so it knows whether it's in a storm;
  - **channel messages since the previous run**, excluding `APP_USER_ID` webhook
    deliveries — i.e. what *people* said. "Already on it, don't open another PR" has to
    outrank a predecessor's plan.
  Framing matters as much as content: notes are presented as *predecessors' claims to
  verify with tools*, never as facts, and the trigger's own instructions always outrank
  them. Bounds (last 3, 24h) exist so a stale or wrong conclusion can't dominate
  indefinitely — the note-poisoning risk is real and deliberately capped.
  This only works because runs on a trigger are **serialized** (§5.1): a chain of notes is
  coherent where interleaved siblings' notes would be noise. Notes are surfaced to humans
  too, on the trigger's Act row ("Lor's last run · 14:07 — …").
  Deliberately **not** built (jacob, 2026-08-17): a note cannot suppress its own trigger.
  Volume is the caps' job; suppression stays a human decision, and handing the model a
  kill switch over its own wake-ups is a different (larger) trust conversation.
  Known gap: `agent_run_tool_result` only records the fixed `SIDE_EFFECT_TOOLS` allowlist,
  so **custom tools and MCP server calls don't appear** in the mechanical list — the note
  is the only account of those. (Fixing that means classifying workspace tools by whether
  they mutate, e.g. by HTTP method.)
- **Cost visibility.** Remember is metered at true cost, never debited (same stance as
  GitHub ingest — pricing decision stays visible in the ledger). Act runs meter like any
  agent run.

## 6. Decided questions (with rationale)

1. **Custom tools are workspace-registered, channel-enabled** like connectors. ✓
2. **Effects are named POST, Remember, Act** and any combination can be enabled per
   trigger. ✓
3. **Silent Act runs leave no channel trace** — run/delivery log only. ✓ (Since
   2026-10-09 every Act run has its own session, but still nothing in channel chat.)
4. **Remember lands in `source`, not the brain.** ✓
5. **Write tools execute freely in unattended runs.** Offering a tool to the AI *is* the
   consent — if it's registered and granted to the channel, Lor may call it without
   supervision. **Approval requests are deferred** — jacob has a Linear ticket for
   approval routing on unattended runs; the existing approvals machinery (`approvals`
   schema, `tool-guard.ts`, tasks' waiting_for_approval) is the integration point,
   purely additive. *(Revised 2026-08-15: the earlier plan stored a `mutates` bit on
   custom tools as the future approval hook. Dropped — jacob: the approval flow will be
   permission-based ("is there an allowlisted person who must approve this?"), which a
   read-vs-write classification neither predicts nor configures. Approval/approver
   config arrives WITH the approvals design, per tool or per channel, not pre-staged as
   a data bit.)*
6. **Task is an escalation Lor chooses, not a mandate.** The earlier "every act is a
   task card" stance was rejected as a hardcoded behavior; the preserved invariant is
   "every unattended run is an auditable `agent_run` row."
7. **`channel_webhook` folds into Webhooks** (supersedes the earlier "stays separate"
   stance). One inbound primitive; POST-only webhooks keep today's exact behavior;
   Remember/Act are upgrades on the same URL. Table dropped, rows migrated.
8. **Webhooks (and all triggers) are channel-scoped.** The anchor channel is the target
   and scope of every effect. A Remember-only webhook does nothing visible in its
   channel — the user's choice.
9. **First-party connectors conform to the same trigger/effects path.** No legacy
   implicit behaviors kept (retire `SOURCE_INGEST_ENABLED`-style flags and the
   notify-only route path). No users yet — no back-compat constraints.

## 7. Deliberate non-goals

- No workflow builder, no trigger/condition/action blocks, no jq/templates/field mapping.
- No direct brain writes from any inbound path.
- No message-triggered rules yet ("when someone posts in #x, do y") — same effect system,
  different trigger class, real loop/cost hazards. @-mentioning Lor covers the
  interactive case. Architecture accommodates it later precisely because triggers and
  effects are separate.
- No approval gates on unattended write tools (deferred, see §6.5).

## 8. Schema sketch

- `integrationProviderEnum` += `"webhook"` → cascades compile errors through
  `CONNECTORS`, `CONNECTOR_EVENTS` (`data_received`), providers `Record`,
  `SEARCHERS`/`FILE_BROWSERS` (both `null`), `CONNECTOR_UI` — the
  `adding-a-connector.md` walk, minus the connect page (webhooks are created from
  channel settings).
- `lorCapabilityEnum` += `"custom_tools"` → cascades through `CAPABILITIES`.
- **`connector_notification_route` → generalize into `connector_trigger`** (rename +
  widen; dev-stage `db:push`, existing rows become POST-only triggers):
  - `connectionId`, `event` (unchanged; validated against `CONNECTOR_EVENTS`)
  - `channelId` notNull — the anchor; target/scope of all effects
  - effects: `post` boolean, `remember` boolean + `rememberHint` text,
    `actInstructions` text (null = Act off)
  - `enabled` boolean; Act rate shape: `actWindowSeconds` int + `actWindowOpenedAt`
    timestamp (the coalescing window's open marker — Postgres owns burst dedupe) +
    `actFlushDueAt` timestamp (when its flush is expected; lets recovery tell a lost job
    from a waiting batch), `hourlyRunCap` int, `dailyRunCap` int (see §5)
  - keep one trigger per (connection, event) v1; multi-channel fan-out for the same
    event is a later relaxation.
- `integration_connection` gains `avatarUrl` (webhook post identity; the display name
  reuses `accountLogin`) — nullable provider-specific column, same precedent as the
  Datadog `site` column.
- **`channel_webhook` is dropped** after migrating rows into connection + trigger pairs.
- **`custom_tool`**: per §4 descriptor fields + `workspaceId`, `createdBy`.
  Hard-deleted (no status column); name unique per workspace.
- **`agent_profile_custom_tool`**: `(profileId, customToolId)` grant rows,
  cascade on both FKs (per §4 enablement).
- **`mcp_server`**: name, url, headers (secret-referencing templates), secrets
  (encrypted), `enabledTools text[]` allowlist + `workspaceId`, `createdBy`.
  Hard-deleted; name unique per workspace.
- **`agent_profile_mcp_server`**: `(profileId, mcpServerId)` grant rows,
  cascade on both FKs.
- **`agent_run`** gains trigger provenance (`triggerId`, `deliveryId` — nullable) and
  `handoffNote` (a triggered run's closing note, read by the next run on the same
  trigger — see §5).
- **delivery log**: `trigger_delivery` (triggerId, receivedAt, payload hash/size, effect
  outcomes, runId nullable) — powers the delivery log and dedupe. Batched Act triggers
  also store `actPayload`/`actLabel` per delivery (what the later flush quotes), and many
  deliveries share one `runId` when coalesced.
- `integration_connection` gains what Attio webhooks need: encrypted `webhookSecret` +
  provider `webhookId` (see §10).

## 9. Implementation sequencing

Ship in this order; each phase is independently useful and de-risks the next.

1. **Trigger generalization + first-party conformance.** `connector_notification_route`
   → `connector_trigger` (channel-anchored effects), route GitHub/Linear events through
   it, retire `SOURCE_INGEST_ENABLED` (Remember becomes a per-trigger user choice),
   routes UI grows effect toggles. Everything after lands on these rails.
2. **Attio events + ingest.** Attio `CONNECTOR_EVENTS`, webhook receiver, delayed
   transcript poll → Remember effect + pointer POST. Validates the
   webhook→delayed-fetch→Remember pattern. See §10.
3. **Webhooks (BYO) with POST + Remember** (closes LOR-49). `webhook` provider enum +
   create flow in channel settings + token endpoint + normalization pass +
   `channel_webhook` migration + delivery log. No agent runs yet.
4. **Act.** Trigger instructions → headless triggered run with the channel's toolset +
   post/create-task disposition tools + loop guards + caps. This is the tier with real
   cost/safety stakes; it lands on proven rails. **Shipped 2026-08-14**; as-built:
   - Headless run modeling: `agent_run.messageId` is nullable; triggered runs carry
     `triggerId`/`deliveryId` and use **`scopeKey = deliveryId`** — each delivery is its
     own scope (no per-trigger serialization; `dailyRunCap` is the stampede guard,
     enforced as a rolling 24h count at dispatch, not UI-editable yet).
   - Dispatch: `dispatchConnectorEvent` → `startActRun` (`apps/api/src/lib/act-runs.ts`)
     → `TRIGGERED_RUN_QUEUE`; the job carries the normalized payload (first-party event
     content isn't stored anywhere re-readable). Processor:
     `apps/worker/src/jobs/triggered-run.ts`, reusing `claimAgentRun` unchanged.
   - Kill switch is process-time: the processor re-reads `enabled` + `actInstructions`
     before claiming; clearing either cancels queued runs (settled `stopped`).
   - Instructions enter the system prompt via `triggeredPromptSection`
     (`packages/lor/src/triggered.ts`) only on triggered runs; `saveContext`
     snapshots them on the run row (the audit copy). Disposition tools:
     `post_channel_message` (worker-side fanout, NOT `excludedFromMemory` — Lor-
     authored canonical content, unlike POST-effect pointers) and `create_task`
     (card + task + first run on normal task rails, creator = Lor).
   - Triggered runs KEEP the write-back memory pass (jacob, revising the earlier
     skip-it call: webhook payloads can carry durable facts) — same gate, budget
     floors, and per-workspace lock as conversational runs.
   - Steering/ambient drain is disabled (`drainConversation` dropped from the handle);
     no streaming, no placeholder — the run row + step transcript are the audit trail.
   - UI: "Act" checkbox + instructions textarea on integration events
     (workspace settings) and channel webhooks. Empty-but-checked instructions are
     valid ("" = Act on, use judgment); null = off.
5. **Custom tools.** Registry + `custom_tools` capability + execution in `respond()` +
   settings UI. (Independent of 4; together they complete the "webhook says: use our API
   tool to query X and act" story.) **Shipped 2026-08-15** — see §4 for the as-built
   descriptor, template semantics, SSRF stance, and the cURL import.
6. **Later:** message-triggered rules, provider-native subscription filters (Attio
   `$and`/`$or`), **Postgres querying** (next on the horizon — see §4),
   approval routing for unattended writes (jacob's ticket), multi-channel fan-out per
   event, Lor self-configuration (reads a codebase, calls the same CRUD APIs to wire
   tools + triggers), and **message UI blocks** — Lor's native rich-message shape:
   markdown-first with typed blocks (not a Slack-style block tree; LLMs stream markdown
   naturally), display blocks for webhook senders vs. action blocks (reserved for
   Lor/in-app authors) whose buttons trigger Lor primitives — send-to-Lor, create
   task, approve — with no sender-side callback server. Design deliberately deferred;
   the webhook dialect endpoints were structured so the native base URL gains a field
   additively when this lands.

## 10. Appendix: Attio webhooks (phase 2 specifics)

Verified against Attio's live OpenAPI specs (`https://api.attio.com/openapi/api`,
`https://api.attio.com/openapi/webhooks`) and the webhooks guide
(`docs.attio.com/rest-api/guides/webhooks`), 2026-08-14:

- `POST /v2/webhooks` subscription enum (27 events) includes
  `call-recording.created`, `note.created`, `note-content.updated`,
  `list-entry.created|updated|deleted`, `record.created|updated|merged|deleted`,
  `task.*`, `comment.*`, `workspace-member.created`. Subscriptions accept
  `$and`/`$or` equals/not_equals filters (e.g. pin `list-entry.updated` to one
  pipeline). There is **no** transcript-ready or `call-recording.updated` event.
- **`call-recording.created` fires after the recording has finished and its media
  upload is complete** (per the event reference) — NOT at recording start, as an
  earlier draft of this doc assumed. Transcript readiness at delivery time is still
  not guaranteed (the recording resource has `status: processing|completed` and
  transcription can lag the upload), so the receiver fetches
  `GET /v2/meetings/{meeting_id}/call_recordings/{call_recording_id}` immediately
  and, when `status` isn't `completed`, answers the delivery with **HTTP 503** so
  Attio redelivers on its own backoff — a small retry fallback, not a long-poll
  pattern. That endpoint
  returns `transcript.segments[]` (`speaker.name`, `start_time`, `end_time`); the
  `…/transcript` endpoint our tools currently use is **deprecated** in its favor —
  migrate `fetchTranscript` in `packages/lor/src/attio.ts` while here.
- **Delivery payload**: `{ webhook_id, events: [{ event_type, id: { workspace_id,
  …type-specific ids }, actor }] }`. Exactly one event per delivery today; the spec
  reserves batching — iterate `events`. Payloads carry **ids only** (e.g.
  `meeting_id` + `call_recording_id`), no content — every event is fetch-on-delivery.
- **Signature**: `Attio-Signature` header (duplicated as `X-Attio-Signature`) = hex
  SHA256 HMAC of the raw UTF-8 request body, keyed by the webhook secret. Verify
  with a timing-safe compare. **Dedupe**: `Idempotency-Key` header — same across
  retries of one message (Redis claim, GitHub receiver pattern). Delivery is
  at-least-once; 2xx acks; non-2xx retries up to 10 times with exponential backoff
  over ~3 days, then the webhook is marked degraded.
- **Scope:** creating webhooks requires `webhook:read-write`. Our provider currently
  rejects any `:read-write` scope (`validateAttioReadScopes`,
  `packages/lor/src/providers/attio.ts`). Decision: relax to allow **exactly**
  `webhook:read-write` (it grants no CRM data writes) and create the webhook
  programmatically at connect time. Existing connections lack the scope and must be
  reconnected.
- **Secret storage:** returned in the create-webhook response (also viewable in
  Attio's developer settings). Store encrypted on the connection (`webhookSecret`)
  + the provider `webhookId` for lifecycle (delete on disconnect/revoke).
- Candidate v1 events: `call_recording_ready` (from `call-recording.created` +
  completeness check), `note_created`, `list_entry_created`. Keys follow the
  existing snake_case `ConnectorEventKey` style.
