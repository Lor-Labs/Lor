# Private beta pricing and usage limits

Status: LOR-115 in flight, 2026-10-28. Admission, AI grants/top-ups, native Anthropic/OpenAI BYOK, estimated pooled sandbox usage, hosted BYOS restrictions and expiry enforcement are implemented but not deployed. Keep hosted beta disabled until the remaining launch gates below are complete. This is the current launch direction and supersedes the commercial recommendations in [the earlier pricing research](planned/pricing-and-billing.md). Update the checklist as each slice lands.

The beta exists to measure real costs, gather early feedback and win free users. Launch a useful free beta with a bounded subsidy. The seat subscription is the eventual business; inference and exceptional compute usage recover costs. Search, voice transcription, code storage, ingestion and embeddings remain included. The free beta requires Autumn for AI balances but no card, checkout or paid subscription; optional $25 credit purchases use Autumn and Stripe, while still enforcing admission, expiry and resource limits on the server.

## Launch policy

These defaults follow the pricing discussion. Store a versioned policy and snapshot grants at activation; changing a default must not rewrite an existing team's offer.

| Decision | Beta behavior |
|---|---|
| Cohort | 25 external organizations total; expiry or deletion does not automatically recycle a grant or cohort place. Internal-workspace exemption is not implemented; do not enable this mode on an existing mixed internal/external deployment until migration is resolved. |
| Enrollment | Operator-configured 30-day window. Keep admission closed until dates and policy are configured; do not start the clock when code deploys. Existing users can still sign in. |
| Access | First come, first served: the first 25 teams to successfully create a workspace during enrollment receive the offer. No manual approval. Account signup alone does not reserve a place. Founders verify their email; invited teammates can join after enrollment fills. Reuse the existing waitlist once admission closes or fills. |
| Trial clock | 30 days from the first successful workspace activation. Refreshing, retrying onboarding or adding teammates never restarts it. |
| Members | Five human members including the owner; Lor's service identity is excluded. Larger teams require an explicit operator override. |
| Credit grant | 3,000 credits ($30) per organization for the entire trial, once, shared by AI and sandbox time (policy `private-beta-2026-10-28-pool`; replaced the separate $25 AI + 50-hour grants on 2026-10-28). AI is priced at the most expensive listed Gateway provider token price for the served model, with applicable context tiers/peak rates and no blanket multiplier; unlisted models use the $3/$0.30/$15 per Mtok fallback rate. Sandbox time costs 1.25 credits per GB-hour while running (code 8 GB: 10/hour; chat 4 GB: 5/hour), standby free. When the pool runs out, AI and sandbox work stop; the team subscribes or buys a one-time $25 pack (2,500 credits); no automatic refill. Native Anthropic/OpenAI API keys pay for AI only; their sandbox time still draws on the pool. |
| Browser time | No separate grant (decided 2026-10-28). When hosted browser use ships, its time draws on the same credit pool as AI and sandbox time, at a published per-hour rate set from the chosen vendor's cost. Do not advertise an available browser feature before it exists. When a browser shares a sandbox, its time is already metered there; never charge it twice. |
| Included services | No AI-credit debits or per-unit customer fees for search, transcription, code storage, ingestion or embeddings. Meter their costs internally; provide clear beta capacity controls and manual exceptions where needed. |
| BYOK | Native Anthropic and OpenAI workspace-owned API credentials for user-requested inference. The provider bills the workspace directly. Lor's trial expiry and hosted compute allowance still apply. Background product services stay Lor-funded. |
| BYOS | Disabled for the hosted beta until the integration's provider eligibility is resolved. No risk-acceptance override. Preserve saved sessions and disconnect access. |
| Exhaustion | Pause Lor-funded AI when free and purchased credits are exhausted. On the first exhaustion of the free AI grant, email the workspace owner with a link to app billing and its $25 purchase action. Keep compute exhaustion separate. Purchasing credits does not activate a seat subscription, extend the trial or increase runtime allowances. No automatic refill or surprise charges. |
| Expiry | Stop new paid-resource work, running agents and recurring work. Preserve access to saved data. Proposed retention default: 30 days of read/export access; no automatic deletion until the retention and export implementation is ready. An extension is explicit and audited. |
| Future paid offer | See [Long-term pricing plan](#long-term-pricing-plan-2026-10-28). Paid activation is an explicit subscription, never automatic trial conversion. |

The earlier spreadsheet assumes a 3× inference multiplier and mostly 4 GB sandboxes. Its margin results are historical scenarios, not launch economics. Fully consuming the revised AI and sandbox grants across 25 teams costs approximately $625 in inference plus $414 in Blaxel compute (50 hours), or $1,039 before other services. Retaining the earlier typical included-service assumptions, browser allowance, up to two months of shared hosting and 20% contingency gives a full-cohort planning estimate of roughly $3,250 (the earlier $3,000 at 25 hours, plus the extra $207 of compute with contingency). This is not a spending ceiling: BYOK moves user-requested inference to the customer's provider, while Lor still pays for hosted compute and included/background services. Select an operator budget before opening admission; track actual cost and reserve headroom for in-flight work and provider reconciliation.

## Existing implementation and gaps

| Area | What exists | What must change |
|---|---|---|
| Billing | `autumn.config.ts`, `packages/billing/src/{constants,autumn,seats,promo}.ts` couple each $20 seat to 2,000 credits; signup promo is 2,000 credits. | Separate beta entitlements from paid checkout. The new standalone, expiring beta grant replaces the old signup promo in hosted-beta mode; reuse only the existing $25 one-time top-up product. |
| Credit checks | `checkCredits` allows work when Autumn is absent or unavailable. Worker preflight uses it. | Hosted beta now requires Autumn and fails closed on billing errors or unresolved debits. No Stripe subscription is required for the free grant. |
| Usage | `packages/billing/src/ledger.ts` persists usage and asynchronously debits Autumn. The worker also counts per-run spend. | Autumn is authoritative for free and purchased balances. Beta step usage is stored in microdollars and sent as fractional credits without the legacy per-event cent minimum or conversion multiplier. Outstanding vendor normalization and strict reservation work remains below. |
| Auth | `packages/auth/src/lib/auth.ts` has signup, organization and membership hooks. The API also joins members through link/domain flows. | Enforce admission and member limits across every entry path, with atomic claims instead of count-then-insert checks. |
| Waitlist | Database, public API and marketing form already exist. | Public availability and the existing waitlist are connected to web signup. Valid signed teammate invitations retain access after the cohort fills. |
| Models | Run funding is pinned in Postgres. Pi uses either Lor Gateway auth or isolated native Anthropic/OpenAI credentials. | Live provider verification remains; no Gateway-only BYOK or subscription tokens are offered. |
| Harness flags | `claudeCodeHarness` is currently true; `codexHarness` is false. | Apply the agreed beta BYOS restriction at linking, enqueue and execution, including previously queued work. |
| Sandboxes | Code uses 8 GB RAM/8 GB disk; ordinary sessions use 4 GB/2 GB. Provider names are durably registered against a trial; raw control-plane state is polled every 30 seconds. | Estimates are not provider invoices. Confirm stop/standby behavior on the configured account; unrestricted detached processes remain a vendor-level enforcement gap. |
| UI | Billing settings expect Autumn and offer subscription/top-up actions. | Present beta expiry, remaining allowances and BYOK independently of paid billing. |

## Implementation order

### 1 Beta policy and trial records

- [x] Add the versioned policy, paused enrollment campaign and workspace trial schemas, with UTC dates, $25 expressed in integer microdollars and runtime in seconds. Store granted totals, not spendable balances.
- [x] Snapshot activation, expiry, retention and grants once. A row-locked activation helper preserves an existing trial on retry and checks the configured campaign's window/cap; auth insertion is wired through the transaction in step 2. Deleted workspaces retain their cohort place through the surviving trial record.
- [x] Add operator commands to inspect policy/trials, configure a paused campaign and extend dates/member/grant totals. Adjustments require an operator label, reason and stable request id, with before/after values written in the same transaction.
- [x] Add `LOR_HOSTED_BETA` (default false) and `LOR_BETA_CAMPAIGN`, independent of Autumn. Auth, API and workers consume them; keep the flag off until the remaining launch gates are resolved.
- [ ] Apply the additive schema to the intended database during rollout. No database was changed in this implementation slice.

Files: `packages/db/src/schemas/beta.ts`, `packages/billing/src/{beta-policy,beta}.ts`, `packages/billing/src/scripts/beta.ts`, `packages/env/src/server-fields.ts`, package exports/scripts and `.env.example`.

Operator commands (after schema application; mutating commands target `DATABASE_URL`):

```sh
pnpm beta policy
pnpm beta configure private-beta <enrollment-start-in-UTC>
pnpm beta open private-beta
pnpm beta pause private-beta
pnpm beta show <workspace-slug-or-id>
pnpm beta exempt <workspace-slug-or-id> --operator <name> --reason <text>
pnpm beta unexempt <workspace-slug-or-id>
pnpm beta adjust <workspace-slug-or-id> --request-id <stable-id> --operator <name> --reason <text> --expires <new-expiry-in-UTC>
pnpm beta adjust <workspace-slug-or-id> --request-id <another-id> --operator <name> --reason <text> --ai-usd 35 --sandbox-hours 40 --members 8
```

Timestamps use ISO UTC, such as `2026-11-01T00:00:00Z` (example only). Adjustments set new total grants, not additional amounts; they only extend/increase terms, never reset usage or activation. Repeating a request id with identical terms is a no-op; changing its payload is refused. Campaign configuration is idempotent for matching dates/terms and always creates a paused campaign. `open` permits first-come-first-served admission only when the deployment flag is enabled and enrollment dates are current; it performs no per-team approval. `pause` closes new admission and preserves existing trials. Policy rows are append-only through the service; changed defaults require a new version.

Validation, 2026-10-27: Biome passes on the changed TypeScript and package files. `pnpm --filter @repo/db --filter @repo/billing --filter @repo/env check-types` passes. The schema has not been applied and database activation/concurrency behavior has not been exercised. No tests or test harnesses were added or run.

### 2 Admission and membership enforcement

- [x] Claim places first come, first served under a campaign row lock. Workspace, owner membership and trial commit together, so a failed insert cannot consume a place.
- [x] Wrap the Better Auth insertion adapter so both API and direct organization creation use the same admission boundary. Require a verified founder email. Membership insertion uses a workspace row lock across Better Auth and domain/invite-link joins; bot members do not count.
- [x] Suppress the legacy signup promo for hosted-beta workspaces. Provision the expiring $25 Autumn grant on the first billing check or the minute-by-minute worker sweep, with a stable grant ID.
- [x] Expose public signup availability and reuse the waitlist in web/desktop. Do not reserve places for unverified account signups. Existing signed teammate invitations still work when full.
- [x] Add mobile public-signup availability and workspace expiry/compute presentation. Native key management and credit purchases remain in web/desktop billing. Mobile signup closure directs users to the website waitlist; signed email invitations keep their existing flow.
- [x] Internal exemptions (2026-10-28): `pnpm beta exempt <workspace> --operator <name> --reason <text>` (and `unexempt`) writes `beta_exemption`. An exempt workspace has no trial and keeps normal access, membership, credit billing and purchases, with no beta banner, compute meter or member cap. A workspace with a trial cannot be exempt. Hosted-beta harness limits (Pi only) still apply.
- [ ] Before enabling on an existing deployment, exempt every internal workspace. Any other existing workspace without a trial becomes read-only. New workspaces created by internal users still take a cohort place.

Files: `packages/billing/src/beta.ts`, `packages/auth/src/lib/{auth,beta-adapter}.ts`, API workspace membership/public beta route, web signup/login/invite routes and waitlist component.

### 3 AI accounting and shared enforcement

- [x] Use Autumn as the authoritative free/purchased AI ledger. This supersedes the earlier separate Postgres wallet proposal now that beta top-ups are in scope. Postgres holds policy, trial and grant-sync metadata, pending usage events and email delivery state. Keep purchased credits separate from the expiring free grant.
- [x] Persist beta inference debits in integer microdollars; send fractional Autumn credits at 100 credits per dollar. No blanket markup or one-cent minimum on the beta path. Included background services retain zero customer debits.
- [ ] Normalize uncached input, cache reads, cache writes, output/reasoning and compaction. Record the served model, applicable rate version and stable event identity. Unsupported/unpriced managed routes must not silently use an inaccurate wildcard rate.
- [ ] Use durable reservations and incremental settlement across concurrent runs. Recheck expiry, funding and shared balance during execution, not just at start. Preserve spend-based stopping instead of adding arbitrary tool, step or token ceilings.
- [x] Settle beta usage at the existing per-step/compaction seam, with run/attempt/sequence identities and durable pending rows. Ignore the beta final aggregate for charging. Request synchronous Autumn tracking with idempotency keys; a documented duplicate 409 finalizes an already-accepted debit. A worker sweep retries pending settlement.
- [x] Fail closed on credit-check errors and unresolved debit rows; stop current runs on step failure or a heartbeat check. Preserve workspace readability. Cap debits at available credit, absorbing in-flight excess as Lor cost instead of creating customer debt.
- [ ] Add durable reservations before model calls and reconcile provider-reported costs after process loss. Current checks stop at step boundaries/heartbeats; multiple requests already in flight can exceed the sponsored budget. This is not a hard vendor-spend cap.
- [x] Apply the shared worker funding/compute/expiry checks to normal sessions, code, voice, Loops, Act/triggered runs and retries; fork creation also checks active workspace access. Included/background services retain their existing Lor-funded transports and zero AI-credit debits.

Primary files: `packages/billing/src/{credits,rates,ledger,policy}.ts`, `packages/db/src/schemas/{usage-events,agent-runs}.ts`, `apps/worker/src/lib/agent-run.ts`, `apps/worker/src/jobs/{lor-respond,voice-request,loop-run,triggered-run}.ts`, `packages/lor/src/{index,run,usage}.ts`.

Completion: two simultaneous sessions cannot each spend the same remaining balance; interrupted and resumed work settles once; no payment-service outage grants unlimited sponsored inference.

### 4 Compute accounting and BYOK

- [x] Persist cumulative estimated active milliseconds by provider sandbox name and trial. Serialize accounting under the trial row lock; multiple viewers share one resource, separate machines consume time separately. Guard creation, attachment, file reads/writes, process starts and bridge preview access. A later access fences out an older standby observation.
- [ ] Establish how Blaxel reports active versus standby time before displaying an exact remainder. Use bounded leases for real-time allowance enforcement and reconcile against provider evidence; do not substitute agent wall time and call it exact compute.
- [ ] Pause or stop compute when the allowance or trial expires, including a dev server continuing after the agent finishes. Cleanup must survive worker crashes and cannot depend on a browser tab remaining open. Preserve durable files/checkpoints and make resume possible.
- [x] Keep browser accounting behind its feature rollout. Never count browser hosting twice when it shares a sandbox; separately record any distinct browser-provider instance.
- [x] Add encrypted workspace API credentials with existing billing/admin authority checks, masked metadata, rotation and removal. Never return the key through the API or put it in model prompts, logs or a tool-accessible filesystem.
- [x] Resolve the payer and credentials per run; keep Lor-funded background services on separate transports. A customer's quota/key failure must not fall back to Lor-funded inference. Credential deletion/rotation must be handled at run boundaries and on resume.
- [x] Native Anthropic and OpenAI are the launch BYOK scope (explicit user choice). Offer models from the installed Pi native catalog. Disable Gateway options/fallbacks for native transport, use an isolated in-memory credential store, and retain Lor Gateway credentials only for separately funded background services.
- [x] Disable the hosted-beta subscription path consistently across API, realtime, workers and clients. Preserve historic content and disconnect controls; drain existing workers when deploying the change.

Primary files: `packages/lor/src/sandbox/{session-sandbox,blaxel}.ts`, `apps/worker/src/lib/session-sandboxes.ts`, `packages/lor/src/models.ts`, `packages/lor/src/session-core/pi-runtime.ts`, the session/voice entry points, credential schemas/routes and `packages/utils/src/features.ts`.

Completion: BYOK never spends Lor's AI grant and never bypasses compute/expiry; a detached dev server cannot keep spending indefinitely. Boat is a later provider integration, not required by this slice.

### 5 Beta experience and expiry

- [x] Expose trial expiry, free AI and purchased AI dollars in billing; only billing-authorized users can purchase.
- [x] Add ordinary-member entitlements with trial state, expiry and estimated remaining sandbox time. Show a workspace banner on web/desktop and an allowance panel in mobile workspace settings. Billing/key management still requires billing authority.
- [x] Show separate AI and estimated compute balances in billing, with exhausted/expired states and BYOK settings. The sandbox guard reports compute exhaustion separately; key failures never silently switch payer. Some older run preflight messages still use the generic out-of-credits label; the workspace banner/billing view carries the specific entitlement state.
- [x] Hide and server-block seat subscriptions and auto-refill enablement in hosted beta. Permit only a $25 top-up while the trial is active. Existing top-up checkout grants credits through Autumn after payment; visiting the return URL grants nothing. Purchases never alter trial dates. No live plans have been pushed.
- [x] Save one free-AI-exhaustion email per trial with a billing deep link and immutable recipient/body inputs. A worker sends it with a stable Resend idempotency key. Failed delivery retries; unresolved attempts older than 23 hours require operator reconciliation rather than risking a duplicate after Resend's 24-hour key window.
- [ ] Add 80% warnings, compute exhaustion notices and seven/one-day expiry reminders. Do not call AI exhaustion a 30-day trial expiry.
- [x] Enforce expiry at workspace API writes, auth organization mutations/member joins, shared channel write access, bot/connector posting, uploads, scheduled runs, source/attachment indexing, native BYOK requests, sandbox wakeups and voice activity. Existing LiveKit join tokens are capped at trial expiry; transcription leases stop and the worker ends inactive beta rooms. Keep stop/key-removal/account-disconnect/read paths available. Live sandbox filesystem reads require compute; saved conversations, repository checkpoints and existing stored artifacts stay on their read paths. Do not promise a complete sandbox export (ignored/untracked files may only exist on its disk).
- [x] Cover web/desktop together and mobile's signup, membership and session flows. Read mobile instructions before editing mobile code. Stop controls and access to saved work remain available.

Primary files: `apps/api/src/routes/v1/billing/`, workspace authorization/mutation boundaries, `apps/web/src/components/workspace/billing-section.tsx`, onboarding/signup/session UI, `apps/www/app/components/waitlist-form.tsx`, `apps/mobile/` and realtime handlers.

Completion: beta purchases are explicit $25 credit packs; seat billing never starts automatically. Every member can understand why work paused, and full workspace/compute expiry is enforced by the server rather than client visibility.

### 6 Launch controls and rollout

- [ ] Provide internal spend reporting for every vendor category, including nonbillable search, voice, storage, ingestion and embeddings. Add cohort/workspace cost alerts and an operator pause mechanism. Monitor growth/retention and unusually expensive included workloads without turning them into customer fees.
- [ ] Define a cohort budget and in-flight reserve before opening admission. A global operational pause is an emergency control, not a promise that included services cost nothing or that provider billing stops instantly.
- [ ] Ship schema changes and dormant enforcement first; explicitly mark internal workspaces and reconcile existing promo/beta grants before enabling the new mode. Do not automatically reset existing accounts into fresh trials.
- [x] Review critical concurrency/retry/expiry paths and run focused lint, type checking and builds that do not execute tests. Do not generate or run tests, ad hoc test scripts, evals, browser harnesses or `pnpm run validate` under the repository policy.
- [x] Check that no rollout command invokes a prohibited runner. Record any validation limitation and unresolved provider-metering dependency accurately.
- [ ] Once the launch prerequisites are complete, open first-come-first-served enrollment for all 25 team places. Keep the operator pause switch available; it closes admission without revoking existing trials.

## Follow after the free beta launch

### Long-term pricing plan (2026-10-28)

Agreed with Jacob, not built. Vendor prices were checked on 2026-10-28.

| Decision | Plan |
|---|---|
| Seat | $20 per human seat per month, including about $10 of credits pooled across the workspace. The seat keeps about $10 for hosting, included services and margin. |
| Beta teams | $20 per seat for life. The lifetime promise covers the seat price only; usage always follows the published rates. |
| Later teams | A small free credit grant (about 25 dev-box hours' worth, pooled with AI), then a subscription at a higher seat price ($25 or $30, to decide). |
| One pool | AI and sandbox time draw from the same credits. When the pool runs out, the team subscribes (beta) or buys more credits (paid). No lockout: subscribing restores normal use. |
| Leaving the beta | Subscribing ends beta mode completely: no member cap, no read-only state, normal billing. Offer it when the trial ends or the pool runs out. |
| AI rate | Highest listed Gateway provider price for the served model. |
| Sandbox rate | 1.25 credits per GB of RAM per hour, published per box: dev box (8 GB) 10 credits/hour ($0.10), chat box (4 GB) 5 credits/hour ($0.05). $10 buys about 100 dev-box or 200 chat-box hours. |
| Cost basis | Price around Boat (about $0.036/h for 8 GB, $0.018/h for 4 GB), not Blaxel ($0.33/h and $0.17/h). The beta runs on Blaxel at a loss of about 23¢ per dev-box hour; that is a beta-only subsidy. |
| Transparency | Publish the rates and the formula. Describe the seat as paying for the product; do not claim "no markup" while `CREDIT_CONVERSION_RATE` is above 1. |
| Cost data | Record the Gateway's actual cost for every request next to the charged list price. Required before opening admission. Built 2026-10-28 for the main Lor loop (steps and compactions): the Gateway reports what it billed in each streamed reply (`provider_metadata.gateway.cost` on `message_delta`), read through Pi's `provider_stream_event`. The per-step run update adds it to `agent_run.gateway_actual_usd`, and the list price Lor charged for the same calls to `gateway_charged_usd`. No extra requests or jobs. Background services (write-back, ingestion, embeddings) and voice are not recorded yet. |

Infrastructure: launch the beta on Blaxel. Within weeks, move to Boat after (1) confirming start/resume quotas at Lor's volume and whether plan fees count toward usage, (2) measuring resume latency and file persistence, and (3) restarting in-sandbox processes after a resume (Boat keeps disk, not memory) and using named snapshots for sessions idle over 14 days. Boat counts every start against account limits (200/day on the $20 plan, 840 on $100, 1,680 on $500); Lor's post-turn idle window keeps starts to returning users. Self-hosting (E2B's Apache-2.0 runtime) is reconsidered at about $10k/month of sandbox spend. Before launch, check whether Blaxel's keep-alive bills while Lor waits on the model.

Boat notes (docs.boat.dev, 2026-10-28): webhook events `ready`, `archived` (stopped), `error`, `hydrated`, `degraded`, `recovered` give exact running intervals, so metering moves to webhooks (charge at stop) with no polling; build that in the provider swap. There is no pause: a stop removes the machine and keeps the disk, so each wake is a VM boot (resume latency not yet measured; Blaxel resumes in ~25 ms with memory). Auto-stop defaults to 1 h after create or resume. Possible EU-only region (from a comparison page, unverified). Blaxel's docs list no usage webhooks, only the Billing API (not confirmed with Blaxel support). Decision 2026-10-28: launch on Blaxel; evaluate Boat right after launch.

Build order:
- [x] Actual Gateway cost per request (2026-10-28, see Cost data).
- [x] Subscription exits beta mode (2026-10-28). `workspace_beta_trial.subscribed_at` mirrors an active `pro` subscription. `syncBetaCredits` sets or clears it from the Autumn customer it already fetches: on the minute sweep, on the billing page (so returning from checkout applies at once) and on a `subscription_changed` webhook. While set, the trial behaves like an exempt workspace: normal access, membership, credit billing and purchases, with no member cap, compute meter, expiry lock, banner or exhaustion email. Cancelling clears it and the trial's terms apply again (an expired trial is read-only). Trial teams may subscribe at any time; the web billing page makes Subscribe the main action when the trial has ended or the AI or sandbox allowance is used up, and expiry messages point to it. Leftover beta credits stay in Autumn until they expire.
- [ ] Lifetime $20: the current `pro` plan is $20. Before raising the seat price, version the Autumn plan so existing beta subscribers keep $20 (Autumn plan versioning is not yet verified).
- [x] Sandbox time debits the shared credit pool, outside beta mode (2026-10-28, chunk A). The `sweep-sandbox-usage` worker job runs every 5 minutes: one paged Blaxel Billing API query (`GET /v0/accounts/{BL_ACCOUNT_ID}/metrics`, `sandbox_compute_runtime_gbs`, hourly, grouped by sandbox name, last 3 hours) returns each sandbox's GB-seconds and Blaxel cost. Rows for other Blaxel workspaces are dropped; `ses-`/`call-` names map to the workspace. `sandbox_usage` keeps one row per sandbox-hour (usage, Blaxel cost, credits charged). Credits = round(GB-seconds ÷ 3600 × 1.25); each sweep debits the increase through Autumn with a key naming the hour's charged total, so retries never double-charge. Idle time the box stays awake is charged (decided 2026-10-28). Data lags a few minutes, so a team can overshoot by minutes; Lor absorbs it. Unset `BL_ACCOUNT_ID` disables metering. Beta-mode workspaces are recorded but not charged until chunk B.
- [x] Chunk B (2026-10-28): the beta is one 3,000-credit pool. `beta_compute_resource`, its queries and the 30-second Blaxel state poll are deleted (the worker removes the old `sweep-beta-compute` schedule). Beta sandbox time is charged by `sweep-sandbox-usage` like everyone else, with Autumn `cap` so a beta team never owes Lor. `syncBetaCredits` sets or clears `workspace_beta_trial.credits_empty_at` from the Autumn balance (minute sweep, billing page, webhook). `guardSandbox` and the run checks read that column (a 15-second in-process cache for allowed answers), so sandbox access never calls Autumn. Each usage sweep stops this hour's sandboxes in beta workspaces that are expired or out of credits: it requests run stops, revokes previews and kills running processes, without deleting the VM. Commands keep the normal runaway timeout. The exhaustion email offers subscribing or a $25 pack. Billing shows one balance in credits plus the published rates; the banner and mobile show "credits used up". `pnpm beta adjust --credits <total>` replaces `--ai-usd`/`--sandbox-hours`. The as-built `beta_compute_resource` note below is superseded.
- [ ] Mobile subscribe: mobile points admins to web billing; no in-app checkout.

**Paid conversion:** version the Autumn offer and avoid mutating existing purchased-credit promises. Paid conversion requires an affirmative purchase, not elapsed trial time.

**Boat:** assess the current harness interface, filesystem/checkpoint restoration, stop/resume semantics, previews, networking, isolation, region/latency and provider capacity. Increase included runtime once the integration and costs are measured. Do not promise always-on environments on launch-day Blaxel economics.

**Self-hosting:** treat cheaper sandboxes and suitable open-weight inference as future cost improvements. Keep customer entitlements independent of vendor implementation so savings can fund larger inclusions without a pricing rewrite.

## Implementation verification and rollout status (2026-10-27)

No production database, Autumn product, Stripe account or email recipient was changed. Schema changes remain unapplied and `LOR_HOSTED_BETA` remains false. The current slice adds:

- `workspace_inference_key`: AES-256-GCM ciphertext, masked metadata and a new key ID on rotation. Only billing managers can set/remove it; no plaintext key is returned. Run funding is pinned in `agent_run.inference_funding` across attempts. Removing, rotating or switching funding interrupts existing requests at the next boundary/heartbeat and requires a new response. Provider failures never fall back to Lor credits. Native request usage still appears in run counters, but debits and Lor spend caps exclude it.
- `beta_compute_resource`: one cumulative estimated meter per actual sandbox name. Access and meter updates serialize on the trial. Thirty-second raw provider-state polling does not itself wake a VM. Active observations count time, standby counts zero; an unobserved gap contributes at most 60 seconds per accounting interval, with uncertainty absorbed by Lor. Charges are never generated from these estimates. Concurrent machines share the same 50-hour pool. Commands have timeouts bounded by their remaining allowance and trial date; worker sweeps request run stops, revoke previews and kill registered running processes, retrying failed shutdowns.
- Shared trial expiry/read-only enforcement, pre-request/compaction checks, background ingestion/scheduler gates, hosted BYOS gates, a member entitlement API and web/mobile status presentation. Search, code storage, transcription, embeddings and ingestion remain included while active. AI purchases neither add compute nor extend the trial.

### Remaining rollout gates

1. Apply the combined schema changes, including the new inference and compute tables and run funding column, before deploying consumers. PR #206 also removes the obsolete `model_rate` schema/seeds and adds model preferences/catalog fields; inspect the generated database diff and preserve any historical rate data before dropping that table. No model-rate seeding command remains. Supply the same `INTEGRATION_ENCRYPTION_KEY` to API/worker processes; back up the encryption key separately. Drain old workers/sandboxes when changing hosted policy. Resolve existing internal accounts and existing promo grants before enabling hosted mode; un-enrolled workspaces are read-only in this mode.
2. Configure and review the paused campaign and dates, Gateway pricing availability, Autumn's $25 top-up plan and Stripe/Resend configuration. Verify native provider access, Autumn standalone grant IDs, checkout fulfillment, duplicate settlement recovery and email delivery in the deployment environment. Nothing here has contacted those live accounts.
3. **Blaxel is not a hard spending cap.** Its SDK has no general stop operation; file-preserving archive is private preview. The implementation stops registered processes and removes previews, then permits automatic standby, without deleting a VM. Independently detached processes, external connections and provider outages require operational monitoring/reconciliation. The provider's old seven-day idle deletion policy still applies to sandbox-only files. Do not call the estimate invoice-accurate or promise unlimited durable sandbox storage. Confirm shutdown/standby behavior on the configured account before launch; a provider-supported suspension or complete durable restore path is still needed for a strict cap.
4. Durable AI reservations, detailed cache-write/rate normalization, provider cost reconciliation, cohort spend alerts and proactive expiry/80% emails remain follow-up work from the checklist. Current pre-request checks and capped settlement absorb in-flight overshoot rather than charging customer debt. Choose operating headroom before opening the campaign.

Provider contracts: [Autumn Track API](https://docs.useautumn.com/api-reference/core/track), [Create Balance](https://docs.useautumn.com/api-reference/balances/createBalance), [Blaxel standby control](https://docs.blaxel.ai/Sandboxes/Standby-control), [Blaxel archive](https://docs.blaxel.ai/Sandboxes/Archive), [Blaxel billing explorer](https://docs.blaxel.ai/Security/Billing-Explorer-API), installed autumn-js 1.2.44 / Blaxel 0.3.11 / Pi 1.3.0 SDKs, and [OpenAI API authentication](https://developers.openai.com/api/reference/overview).

Validation uses focused source review, `pnpm run check` and `pnpm run check-types` (including upstream builds). No tests, test scripts, evals or browser harnesses were added or run. Live provider behavior and database concurrency are unexercised; the deployment flag remains off.


## PR #206 reconciliation (2026-10-28)

Integrated dev revision `f06abf1a` into the beta branch. Commercial terms, Autumn/Stripe responsibilities, expiry and compute gates remain unchanged.

- Gateway rates replace the seeded rate table. Each request is priced at its own input-context tier; the resulting USD goes directly into microdollar beta settlement. The final turn aggregate never debits a beta workspace again. Zero-cost/tiny requests have no one-cent minimum and `CREDIT_CONVERSION_RATE` does not mark up beta debits.
- The published charging rule is the most expensive listed provider token price for the model that served the request, including applicable peak rates, so a fallback route never under-bills. This is disclosed in billing. `costUsd` is the calculated charge basis, **not a verified provider invoice cost**. A model the Gateway does not list uses the $3/$0.30/$15 per Mtok fallback rate; a previously fetched list can be used during refresh outages. A turn's model pick the payer cannot serve quietly runs on the default model (Lor's, or the workspace key's). Price snapshots, cache-write normalization and invoice reconciliation remain outstanding. (Revised 2026-10-28: the lowest-route rule, the unknown-price pause and the unsupported-pick rejection were reverted.)
- Workspace BYOK saves a provider credential and a default model. The workspace-authenticated model catalog returns the native provider's models and supported effort levels. Each message may pick one; the worker validates and pins the resolved model with its payer/key identity before execution. Retry attempts keep that model. Changing a model does not require changing the credential. Key removal/rotation still stops old runs; native requests cannot fall back to Gateway.
- The catalog API now lives at `/v1/workspaces/{workspaceSlug}/agent-models`. Deploy API and web/mobile consumers together. Queries are workspace-scoped and key changes invalidate the local web catalog. Until a catalog loads, clients omit a remembered model so the server chooses the current workspace default. Server validation rejects incompatible stale picks.
- The new model picker retains hosted-beta Pi-only restrictions; catalog access also enforces harness flags and hosted restrictions. Included services retain their separate Lor-funded transports.

Validation: focused merge review, repository lint and full dependency-aware type checking. No tests or runtime/provider flows were run. Database rollout, native provider calls, live checkout/settlement, internal-workspace migration and strict sandbox shutdown remain launch gates. The public Gateway pricing response was read only to confirm response field names; no paid request or external account mutation was made.
