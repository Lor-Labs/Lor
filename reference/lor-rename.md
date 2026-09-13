# Merlin → Lor rename (LOR-87)

Status: PLANNED, not executed. Full repo-wide rename of the agent from Merlin
to Lor — code identifiers, DB names, wire protocol, env vars, prompts, copy,
docs. ~1,400 occurrences across ~170 code files + 19 reference docs.

Related future work (not in this rename): per-workspace agent rename/avatar
and workspace-added custom agents. See §8.

## 1. Locked convention

- `Merlin` → `Lor`, `merlin` → `lor`, `MERLIN_` → `LOR_` — identifiers, file
  names, the `@repo/merlin` package, env vars, socket events, queue and Redis
  prefixes, DB column/enum names, seed identity, UI copy, marketing copy.
- Seed identity becomes: name `Lor`, username `lor`, displayUsername `Lor`,
  email `lor@lor.chat`. Same UUID (`LOR_USER_ID`, value unchanged).
- Prompt identity: "You are Lor, the knowledge keeper for this team's
  workspace." (drop the now-redundant "Lor workspace" phrasing everywhere).

### Deliberate exceptions (merlin→lor would be wrong or nonsense)

1. **CSS agent-accent tokens → `agent`, not `lor`.** `--color-lor-merlin*`
   would become `--color-lor-lor*`, and `bg-lor` would read as the brand
   color, not the agent accent. So: `--merlin`/`--merlin-foreground` →
   `--agent`/`--agent-foreground`; `--color-merlin*` → `--color-agent*`
   (utilities `bg-merlin` → `bg-agent` etc. across web + www);
   `--color-lor-merlin*` in lor-tokens.css → `--color-lor-agent*`; mobile
   theme keys `merlin`/`merlinMuted` → `agent`/`agentMuted`.
2. **"Merlin profiles" copy → "agent profiles".** The DB entity is already
   `agent_profile` and the UI label is already "Agent profiles". OpenAPI
   summaries, the auth permission label ("Manage Merlin profiles"), the web
   settings tab id `"merlin"` (`?tab=merlin`) → `"agent"`, and
   `merlin-profiles-section.tsx` → `agent-profiles-section.tsx`.
3. **Do NOT touch:** `--color-lor-*` brand tokens (lor-sidebar etc.),
   `lor://` scheme, `lor.chat` domains, `LOR-` Linear issue refs, Attio CRM
   "tasks", historical runbook prose (tasks-v2 deviations etc. keep their
   era's vocabulary).

## 2. Breaking wire/API renames (clients must update together)

- Socket events: `merlin:reasoning|memory|tool|steer` → `lor:*`.
- Message/wire fields: `merlinToolCalls`, `merlinMemories`, `merlinReasoning`,
  `merlinReasoningSegments`, `merlinTriggerMessageId`, `merlinMessageId`,
  `merlinThreadNotifications`, `isMerlinThread` → `lor*` equivalents.
- BullMQ queue: `merlin-respond` → `lor-respond` (job name `respond` is
  already clean; loops use Postgres `nextRunAt` + the `maintenance` sweeper,
  NOT repeatables — queue rename orphans nothing scheduled).
- Redis prefixes: `merlin:session:*`, `merlin:thread:muted:*`,
  `merlin:writeback:*` → `lor:*` (all TTL'd; old keys expire harmlessly).

## 3. DB round (Jacob runs db:push; assistant never does)

Schema renames drizzle will prompt for (answer as renames):
- enum `merlin_capability` → `lor_capability`
- enum `merlin_thread_notification` → `lor_thread_notification`
- columns `message.merlin_tool_calls|merlin_memories|merlin_reasoning|merlin_reasoning_segments`
  → `lor_*`; `user_notification_settings.merlin_thread_notifications` →
  `lor_thread_notifications`
- `brain_node` truncate prompt will reappear → "No, add the constraint
  without truncating"

**Known trap — `operation_class` enum VALUES change** (`merlin.quick`,
`merlin.standard`, `merlin.deep`, `merlin.agent` → `lor.*`): drizzle rebuilds
the enum via text conversion and the cast back fails if `usage_event` rows
hold old values (same failure as `task_card` in LOR-61). Expected recovery:

```sql
UPDATE usage_event SET operation_class = replace(operation_class, 'merlin.', 'lor.')
WHERE operation_class LIKE 'merlin.%';
```
then re-run `pnpm db:push`.

Manual data UPDATEs (after push):
```sql
-- confirm no collision first: SELECT id FROM "user" WHERE username = 'lor';
UPDATE "user" SET name = 'Lor', username = 'lor', display_username = 'Lor',
  email = 'lor@lor.chat' WHERE id = '00000000-0000-4000-8000-000000000001';
-- optional, analytics consistency (tool is plain text, not the enum):
UPDATE usage_event SET tool = replace(tool, 'merlin.', 'lor.')
WHERE tool LIKE 'merlin.%';
```
Old `message.content` rows containing "Merlin" (error fallbacks, event lines)
stay as-is — historical.

## 4. Env cutover (Jacob-side, deploy-blocking)

18 vars rename `MERLIN_*` → `LOR_*` in every deployed service env (api,
worker, realtime) AND local `.env`: MODEL, MODEL_FALLBACKS, SMALL_MODEL,
SMALL_MODEL_FALLBACKS, COMPACT_INPUT_TOKENS, CONTEXT_WINDOW,
TOOL_APPROVAL_SECRET, WORKBENCH_TIMEOUT_SEC, WORKBENCH_MAX_FILE_BYTES,
WORKBENCH_MAX_TOTAL_BYTES, WORKBENCH_MAX_FILES, WORKBENCH_IMAGE,
WORKBENCH_SANDBOX_TTL, CODE_SANDBOX_TTL, WORKBENCH_MEMORY_MB,
WORKBENCH_DISK_MB, EMBED_MODEL, EMBED_DIMENSIONS. Plus unschema'd
`MERLIN_REEMBED_CONCURRENCY` (reembed script). `MERLIN_EMBED_DIMENSIONS`
value stays 2560 — embed dims are locked unless reindexed; only the var name
changes. Mirror any required renames into TEST_ENV in
`apps/api/vitest.config.ts` (env-coupling gotcha).

## 5. Execution: 9 reviewable chunks (~250–450 LOC each, one commit each)

Strategy: temporary back-compat aliases at package boundaries keep every
chunk type-checking green so each is committable alone — deprecated
re-exports for consts/types, dual `lor:*`/`merlin:*` socket-event keys, dual
CSS tokens, dual `@repo/utils` export path, dual event emission in the
worker. All duals/aliases are removed in C9. Object PROPERTY names
(`merlinToolCalls`, `isMerlinThread`, `merlinMessageId`,
`merlinTriggerMessageId`, `merlinThreadNotifications` TS props, zod keys)
cannot be aliased — they move together in C6. Local dev keeps working across
chunks: the queue name is a shared const (value flip rebuilds everywhere at
once) and the worker dual-emits events until clients migrate.

Validate per chunk: `pnpm run check-types` + `pnpm run check`.

- [x] **C1 foundations** — packages/db: constants (`LOR_USER_ID` +
  deprecated aliases), git mv `seeds/merlin.ts`→`seeds/lor.ts` (identity →
  Lor/lor/lor@lor.chat), pg names (4 message columns, notification column, 2
  enum names), `operation_class` values `merlin.*`→`lor.*`, type renames +
  aliases, `queries/channel-access.ts`. packages/realtime-types: queue value
  `lor-respond` + const/type aliases, dual event keys, notification types +
  copy. packages/utils: git mv `merlin.ts`→`lor.ts`, dual export path.
  packages/ui: dual `agent` CSS tokens. packages/billing: enum-value
  mapping, email copy. packages/messaging: push copy. packages/auth:
  `addLorToWorkspace`, "Manage agent profiles". packages/connectors: type
  imports. Local db:push after this chunk (prod push waits for cutover, §6).
- [x] **C2 packages/merlin → packages/lor** — git mv dir, `@repo/lor` name +
  import specifiers in api/worker/realtime (package.json + sources),
  packages/env `MERLIN_*`→`LOR_*` + the 4 `env.MERLIN_*` refs in apps/api +
  vitest TEST_ENV mirror (no MERLIN_ keys existed there), prompts,
  `LOR_MODEL` consts, logger, `lor[bot]`, eval seed identity, usage tool
  strings `merlin.*`→`lor.*` + billing `BILLABLE_TOOLS`/ledger keys,
  transcript.test fixtures. Deviation: the version-guard workflow safe-path
  regex (`packages/merlin`→`packages/lor`) moved up from C9 — leaving it
  stale would have made every packages/lor change read as unsafe to that CI
  guard. Lockfile regenerated (`pnpm install`).
- [ ] **C3 apps/worker** — git mv `jobs/merlin-respond.ts` + 4
  `lib/merlin-*.ts` → `lor-*`, identifiers, log strings, `lor:writeback:*`
  key, `LOR_ERROR_FALLBACK`, `actorName: "Lor"`, dual-emit `lor:*` alongside
  `merlin:*` (old side removed in C9).
- [ ] **C4 apps/realtime** — git mv `services/merlin*.ts` (+tests) →
  `lor*`, `lor:session:*`/`lor:thread:muted:*` key prefixes, routing
  identifiers, logs.
- [ ] **C5 apps/api** — openapi schema consts + descriptions ("agent
  profiles"), DM copy, scope-runs/proposals/loops identifier renames,
  remaining `@repo/db` alias-import swaps.
- [ ] **C6 cross-cutting property renames** (one commit, all workspaces) —
  `merlinToolCalls`/`merlinMemories`/`merlinReasoning`/
  `merlinReasoningSegments`/`merlinTriggerMessageId`/`merlinMessageId`/
  `merlinThreadNotifications`/`isMerlinThread` → `lor*` across db TS props,
  API zod schemas, realtime-types, messaging, worker, api, web, mobile. The
  API wire shape changes here → api-client rebuild.
- [ ] **C7 apps/web** — git mv 8 merlin-named files, identifiers, ~60 copy
  strings, listeners → `lor:*`, `bg-agent` classes, composer raw UUID →
  `LOR_USER_ID` + `label: "Lor"`, settings tab id `"agent"`, DOM ids, demo.
- [ ] **C8 apps/mobile + apps/www** — mobile: git mv 6 files, identifiers,
  copy, listeners → `lor:*`, theme keys `agent`/`agentMuted`, avatar
  fallback `"M"` → initial derived from author name. www: copy sweep,
  `#merlin`→`#lor` anchor, avatar const → `lor-profile.png`.
- [ ] **C9 cleanup + docs** — remove all aliases, dual event keys, dual
  emits, dual CSS tokens, dual utils export path; docs git mvs
  (`merlin-architecture.md`→`lor-agent-architecture.md`,
  `merlin-mvp-spec.md`→`lor-mvp-spec.md`) + active-doc prose sweep +
  CLAUDE.md + `.github/workflows/version-guard.yml` regex + lockfile; final
  full validation.

## 6. Cutover order (Jacob-side)

1. Commit; db:push round (§3) + data UPDATEs.
2. Rename env vars on all services (§4) — boot fails with ZodError if missed.
3. Deploy api + worker + realtime + web together (queue/event/field renames
   are atomic). Jobs sitting in `bull:merlin-respond:*` at that moment are
   stranded — deploy in a quiet window; `sweepDeadRuns` +
   `sweepOrphanedPlaceholders` backstop any run that was mid-flight.
4. `eas update` for mobile after on-device QA (old bundles break on the wire
   renames until then — accepted pre-launch).
5. Upload `avatars/lor-profile.png` to R2; optionally set the bot user row's
   `image` to it so the product (not just www) shows the avatar.
6. Close LOR-87.

## 7. Deviations log

(append as executed)

## 8. Custom-agent readiness (assessed 2026-09-12, not scheduled)

Tier 1 — per-workspace rename + avatar of the default agent: EASY (days).
Clients already render name/avatar from the user row and honor per-message
`overrideName`/`overrideAvatarUrl` (the `APP_USER_ID` webhook path proves the
mechanism). Work: settings storage (natural home: `workspace_member` row,
which already carries per-workspace `avatarColor`), settings UI, stamp
overrides at the ~6 agent message-post sites, parameterize the prompt-head
name, and convert the dynamic copy strings ("Stop Lor", "Lor is responding",
notification titles) to use the workspace's agent name.

Tier 2 — multiple agents per workspace: real project (weeks, staged). Six
structural singletons: (1) compile-time `LOR_USER_ID` with ~55 sites of
binary human/agent logic (`ne(id, LOR_USER_ID)` in seats, prompt roster,
context deltas, `mentionsOtherUser`); (2) one-active-run-per-scope — two
agents in one thread contend for the scope slot; (3) Redis session/mute keys
and the `isLorThread` boolean carry no agent dimension; (4) `agent_profile`
is a capability preset, not an identity (no name/avatar/prompt/model/user
binding); (5) DM ban is id-specific; (6) no `agentId` on
`agent_run`/`plan`/`message`. Mention detection, member lists, presence, and
moderation already generalize (id/`isBot`-based) — those come free.
