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

## 5. Execution order (single pass, bottom-up; repo doesn't type-check mid-way)

1. `packages/db` — constants (`LOR_USER_ID`, `LOR_EMBED_DIMENSIONS`), git mv
   `seeds/merlin.ts` → `seeds/lor.ts` (`seedLorUser`), schemas (columns,
   enums, `operation_class` values, types `MerlinToolCall`→`LorToolCall`
   etc.), `queries/channel-access.ts` (`MerlinRunScope`→`LorRunScope`).
2. `packages/realtime-types` — events, `LOR_RESPOND_QUEUE = "lor-respond"`,
   `LorRespondJobData`, notification types/copy, wire field names.
3. `packages/utils` — git mv `merlin.ts`/`merlin.test.ts` → `lor.*`, export
   path `"./merlin"` → `"./lor"`.
4. `packages/env` — the 18 var renames.
5. `packages/merlin` → **`packages/lor`** — git mv dir, package name
   `@repo/lor` (update dep entries in api/worker/realtime package.json + all
   import specifiers), models consts `LOR_MODEL` etc., prompt heads
   (index.ts, placement.ts, project-archive.ts, meeting-insights.ts),
   `merlin[bot]` → `lor[bot]` commit author, `createLogger("lor")`,
   blaxel.toml/Dockerfile comments, eval seed identity, transcript.test.ts
   fixtures ("Lor: wire $100…" — guard itself is structural, name-agnostic).
6. `packages/{auth,billing,messaging,connectors,ui}` —
   `addLorToWorkspace`, "Manage agent profiles" label, billing email copy
   ("Lor credits"), push copy, CSS tokens per §1 exception 1.
7. `apps/worker` — git mv `jobs/merlin-respond.ts` + 4 `lib/merlin-*.ts` →
   `lor-*`, identifiers, log strings, `lor:writeback:*` keys,
   `LOR_ERROR_FALLBACK`, `actorName: "Lor"` (loop-run.ts).
8. `apps/realtime` — git mv `services/merlin*.ts` (+tests) → `lor*`, session
   key prefixes, routing/trigger identifiers.
9. `apps/api` — openapi schema consts + descriptions, wire field names, DM
   error copy ("You can't DM Lor — @mention it in a channel instead."),
   `env.LOR_*` refs, scope-runs/proposals/loops constant renames.
10. `apps/web` — git mv 8 merlin-named files, identifiers, ~60 copy strings,
    composer mention (replace raw UUID literal with `LOR_USER_ID` import +
    `label: "Lor"`), settings tab id `"agent"`, DOM ids, `bg-agent` classes,
    demo file, notification-settings labels.
11. `apps/mobile` — git mv 6 merlin-named files, identifiers, copy, socket
    event names, theme keys, **replace hardcoded avatar fallback `"M"` with
    an initial derived from the author row name** (parity with web; also the
    last hardcoded client-side identity — custom-agent prep).
12. `apps/www` — copy sweep, `#merlin` anchor → `#lor`, `MERLIN_AVATAR_URL` →
    `https://cdn.lor.chat/avatars/lor-profile.png` (Jacob uploads the R2
    object; old URL keeps working meanwhile).
13. Docs — git mv `merlin-architecture.md` → `lor-agent-architecture.md`,
    `merlin-mvp-spec.md` → `lor-mvp-spec.md`; update CLAUDE.md + active-doc
    cross-references; sweep active docs' prose; leave historical logs.
14. `.github/workflows/version-guard.yml` path regex (`packages/merlin` →
    `packages/lor`), `pnpm install` (lockfile), full `pnpm run check-types` +
    `pnpm run check:fix`.

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
