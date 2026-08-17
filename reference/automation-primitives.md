# Automation Primitives — Triggers, Effects & Custom Tools

> Status: **design accepted** (2026-08-14, design conversation with jacob). Phases 1–5
> (trigger generalization + first-party conformance; Attio events + ingest; BYO
> Webhooks incl. the `channel_webhook` fold and dialect endpoints; Act; custom tools)
> implemented 2026-08-14/15.
> Closes the design question in Linear **LOR-49** ("programmatic ways to index data") and
> subsumes bring-your-own webhooks (the evolved `channel_webhook`) and "webhook-triggered
> Merlin actions."
> Read `merlin-mvp-spec.md` §6 (sources) and `adding-a-connector.md` first.

## 0. Product stance

Lor is moving toward **self-configurable primitives** — the app should behave like a
configurable agent harness (cf. the Pi coding harness), where the harness's behavior is
*data the agent itself can edit*, not hardcoded product flows.

Two rules resolve "powerful and flexible" vs. "opinionated":

1. **Unopinionated about what Merlin does.** No workflow builder, no field mappers, no
   hardcoded dispositions. Configuration is prose instructions + declarative rows.
2. **Rigid about provenance, cost, and consent.** Every unattended run is recorded with
   full provenance; every trigger has budget caps and a kill switch; loops are guarded
   at the infrastructure level. These are physics, not product opinions.

The load-bearing mental model: **a channel is an agent environment.** Its configuration =
enabled connectors + custom tools (via agent profiles) + inbound triggers with their
instructions. Merlin's long-term job is to edit that configuration itself
(see `product-direction.md` — self-configuring agents), which imposes one hard
architectural invariant today:

> **Every primitive below must be a DB row with a CRUD API — never config-file- or
> code-only.** Merlin self-configuration is just Merlin calling the same endpoints the
> settings UI uses. Anything that lives only in code kills that story.

## 1. The primitives

| Primitive | What it is | Scope | Status |
|---|---|---|---|
| **Connection** | OAuth/API-key link to a provider (`integration_connection`) | workspace | exists |
| **Custom tool** | user-defined tool descriptor Merlin can call (HTTP template + args schema) | workspace registry, per-channel enablement like connectors | new |
| **Webhook** | user-created inbound URL (a `webhook`-provider connection + its trigger) | channel | exists as `channel_webhook`; folds in |
| **Trigger** | inbound event: a connector event *or* a webhook delivery | belongs to a connection, **anchored to one channel**; fans out to effects | partially exists (`connector_notification_route` is the POST-only ancestor) |
| **Effect** | what happens on delivery: **POST**, **Remember**, **Act** — any combination | per trigger | POST + Remember exist in pieces |
| **Instructions** | layered prompt context: workspace → (channel, future) → trigger | trigger instructions enter context *only* when that trigger fires | workspace exists |
| **Triggered run** | a normal `agent_run` with trigger provenance | logged always; visible in channel only if Merlin posts | machinery exists, composition new |

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

`ingestSource` (`packages/merlin/src/sources.ts`): one bounded summarize call + embed →
`source` row → retrievable via `search_sources`. **Not** an agent loop, no tools. This is
LOR-49: index data silently, notify no one.

- The trigger's optional **hint** text ("this receives Fireflies transcripts; capture
  attendees and decisions") is prepended to the summarization prompt. That's the only
  configuration Remember has or needs.
- **The brain is never written directly.** External data lands in `source`; brain pages
  stay Merlin-authored (synthesis pulls from sources). Webhook data writing the compiled
  layer directly would pollute it.
- **System-of-record exception (webhooks only):** a webhook has no provider to
  live-fetch from, so the "summary + pointer, never store whole" rule
  (`merlin-architecture.md` §2.2) breaks deliberately: the capped raw payload (64KB)
  is stored on the `trigger_delivery` row. First-party connectors keep true
  pointers (e.g. Attio transcripts are live-fetched). Known gap: the webhook
  provider's `fetchContent` returns null for now, so Merlin retrieves the summary
  but can't yet pull the stored raw payload — wiring `fetch_source` to the delivery
  log is a follow-up.
- Upsert: honor a top-level `external_id` (or `id`) field in a webhook delivery for
  in-place re-ingest (the `source` unique index already supports this); otherwise each
  delivery is a new row keyed by delivery id.

### Act — hand data + instructions to Merlin, let it decide

An **agent run** composed as: the channel's normal toolset (connectors granted by the
channel's agent profile, **including custom tools**) + the trigger's instructions + the
normalized payload as the user turn. Trigger instructions are *not* in the system prompt
at any other time.

Merlin decides the disposition:

- **post** to the channel,
- **create a Task** (escalation it chooses — e.g. multi-step work), or
- **do nothing** — the run's final output is discarded; the only trace is the run/delivery
  log on the connection page. No channel whisper.

A Task is an *outcome Merlin can choose*, never a mandated shape. Auditability is an
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
  machinery, and the registry compile cascade — exactly what `merlin-mvp-spec.md` §6.2
  designed for. Not listed on the connect-a-provider page.
- Inbound endpoint keeps the current shape: `POST /v1/webhooks/:id/:token` — timing-safe
  token compare, ack fast, process async, URL treated as a secret.
- **Dialect endpoints, never payload sniffing** (implemented on today's
  `channel_webhook` execute route; carries into the fold): the base URL speaks Lor's
  native shape (`{ content, username? }`, markdown); `.../discord` accepts Discord
  execute-webhook payloads (content/embeds); `.../slack` accepts Slack
  incoming-webhook payloads (text/blocks/attachments, mrkdwn converted). Same pattern
  as Discord's own `/slack` compatibility route — switching providers is repointing a
  URL. Both normalize to markdown; interactive blocks are dropped rather than
  half-rendered; `avatar_url` is deliberately absent from the schema (zod strips
  unknown keys — identity always comes from the webhook's stored, bucket-restricted
  config). A richer native shape is deferred — see message UI blocks in §9.
- `CONNECTOR_EVENTS.webhook` = one event, `data_received` — every delivery is that
  event; per-webhook configuration lives on the trigger (effects + hint + instructions).
- **No field mapping, ever.** Arbitrary JSON in. POST stays deterministic (verbatim
  `content` or a readable rendering); Remember/Act run the small normalization pass
  (title/text extraction), steered by the trigger hint — the AI-native replacement for
  Zapier's entire mapping UI. Conditions/branching live in Act instructions as prose
  ("if the deal is under $10k, do nothing") — the model evaluates them.

## 4. Custom tools

A workspace registry of user-defined tools Merlin can call. **Shipped 2026-08-15.**

**Descriptor (a row, authorable by humans in a form and by Merlin via API):**

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
  `packages/merlin/src/custom-tools.ts` (binding + execution, unit-tested),
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

Resolution lives in `packages/merlin/src/capabilities.ts`
(`resolveChannelCapabilities` → `ChannelToolGrants { capabilities, customTools:
"all" | string[] }`); binding filters by the grant in `workspaceCustomTools`.
The profile editor shows the blanket tile plus one tile per tool (tiles render
checked-and-dimmed while the blanket is on).

**cURL is the import path for single HTTP tools** (jacob — supersedes the earlier
OpenAPI-import idea): the create form accepts a pasted curl command
(`apps/web/src/lib/parse-curl.ts`) and prefills method/URL/headers/body; the author
then swaps real credentials for `{{secrets.…}}` references.

**Next on the horizon (agreed 2026-08-15, unbuilt):**

- **MCP tool servers** — the vendor ecosystem is converging on remote MCP (Linear,
  Notion, Sentry, Stripe, Cloudflare…). NOT a shape of `custom_tool`: an MCP server
  serves its own live tool list/schemas, so it's a separate `tool_server` primitive
  (URL + auth + **tool allowlist**, generalizing the `datadogMcpTools` pattern — the
  allowlist exists so an upstream tool addition can't silently widen Merlin's
  surface). Session per respond() call, like Datadog.
- **Postgres / database querying** — real demand, but connector-grade treatment
  (credentials, read-only enforcement, schema introspection), never a custom-tool row.

## 5. Guardrails on triggered runs (physics, not opinions)

- **Loop guards.** Runs carry origin (`triggered_by` on `agent_run`); posts/side-effects
  of a triggered run can never re-trigger anything. Bot/webhook messages never trigger
  message rules (none exist yet — see §8).
- **Budget caps.** Per-trigger daily run cap (default modest, e.g. 100/day) — an Act
  trigger whose instructions say "usually do nothing" still burns a model call per
  delivery. Per-run budgets reuse `defaultRunBudgets()`.
- **Kill switch + delivery log.** Every trigger has an enabled flag; the connection page
  shows recent deliveries, their effects, and run outcomes (including silent no-ops).
- **Cost visibility.** Remember is metered at true cost, never debited (same stance as
  GitHub ingest — pricing decision stays visible in the ledger). Act runs meter like any
  agent run.

## 6. Decided questions (with rationale)

1. **Custom tools are workspace-registered, channel-enabled** like connectors. ✓
2. **Effects are named POST, Remember, Act** and any combination can be enabled per
   trigger. ✓
3. **Silent Act runs leave no channel trace** — run/delivery log only. ✓
4. **Remember lands in `source`, not the brain.** ✓
5. **Write tools execute freely in unattended runs.** Offering a tool to the AI *is* the
   consent — if it's registered and granted to the channel, Merlin may call it without
   supervision. **Approval requests are deferred** — jacob has a Linear ticket for
   approval routing on unattended runs; the existing approvals machinery (`approvals`
   schema, `tool-guard.ts`, tasks' waiting_for_approval) is the integration point,
   purely additive. *(Revised 2026-08-15: the earlier plan stored a `mutates` bit on
   custom tools as the future approval hook. Dropped — jacob: the approval flow will be
   permission-based ("is there an allowlisted person who must approve this?"), which a
   read-vs-write classification neither predicts nor configures. Approval/approver
   config arrives WITH the approvals design, per tool or per channel, not pre-staged as
   a data bit.)*
6. **Task is an escalation Merlin chooses, not a mandate.** The earlier "every act is a
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
  different trigger class, real loop/cost hazards. @-mentioning Merlin covers the
  interactive case. Architecture accommodates it later precisely because triggers and
  effects are separate.
- No approval gates on unattended write tools (deferred, see §6.5).

## 8. Schema sketch

- `integrationProviderEnum` += `"webhook"` → cascades compile errors through
  `CONNECTORS`, `CONNECTOR_EVENTS` (`data_received`), providers `Record`,
  `SEARCHERS`/`FILE_BROWSERS` (both `null`), `CONNECTOR_UI` — the
  `adding-a-connector.md` walk, minus the connect page (webhooks are created from
  channel settings).
- `merlinCapabilityEnum` += `"custom_tools"` → cascades through `CAPABILITIES`.
- **`connector_notification_route` → generalize into `connector_trigger`** (rename +
  widen; dev-stage `db:push`, existing rows become POST-only triggers):
  - `connectionId`, `event` (unchanged; validated against `CONNECTOR_EVENTS`)
  - `channelId` notNull — the anchor; target/scope of all effects
  - effects: `post` boolean, `remember` boolean + `rememberHint` text,
    `actInstructions` text (null = Act off)
  - `enabled` boolean, `dailyRunCap` int
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
- **`agent_run`** gains trigger provenance (`triggerId`, `deliveryId` — nullable).
- **delivery log**: `trigger_delivery` (triggerId, receivedAt, payload hash/size, effect
  outcomes, runId nullable) — powers the delivery log and dedupe.
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
     (`packages/merlin/src/triggered.ts`) only on triggered runs; `saveContext`
     snapshots them on the run row (the audit copy). Disposition tools:
     `post_channel_message` (worker-side fanout, NOT `excludedFromMemory` — Merlin-
     authored canonical content, unlike POST-effect pointers) and `create_task`
     (card + task + first run on normal task rails, creator = Merlin).
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
   `$and`/`$or`), **MCP tool servers** and **Postgres querying** (next on the horizon —
   see §4), per-tool channel granularity,
   approval routing for unattended writes (jacob's ticket), multi-channel fan-out per
   event, Merlin self-configuration (reads a codebase, calls the same CRUD APIs to wire
   tools + triggers), and **message UI blocks** — Lor's native rich-message shape:
   markdown-first with typed blocks (not a Slack-style block tree; LLMs stream markdown
   naturally), display blocks for webhook senders vs. action blocks (reserved for
   Merlin/in-app authors) whose buttons trigger Lor primitives — send-to-Merlin, create
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
  migrate `fetchTranscript` in `packages/merlin/src/attio.ts` while here.
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
  `packages/merlin/src/providers/attio.ts`). Decision: relax to allow **exactly**
  `webhook:read-write` (it grants no CRM data writes) and create the webhook
  programmatically at connect time. Existing connections lack the scope and must be
  reconnected.
- **Secret storage:** returned in the create-webhook response (also viewable in
  Attio's developer settings). Store encrypted on the connection (`webhookSecret`)
  + the provider `webhookId` for lifecycle (delete on disconnect/revoke).
- Candidate v1 events: `call_recording_ready` (from `call-recording.created` +
  completeness check), `note_created`, `list_entry_created`. Keys follow the
  existing snake_case `ConnectorEventKey` style.
