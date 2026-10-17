# Context engine phase 2: ingestion, search, ranking, conflicts

> Status: planned 2026-10-17, not built. Builds `context-engine.md` §7 steps 3
> (ingestion), 4 (search), 5 (ranking) and 7 (conflicts) on the
> `context-engine` branch. It ships in one release with phase 1
> ([`session-memory.md`](./session-memory.md)); the rollout is at the end.
> Code facts checked at `6663af23`; re-check file:line refs before each step.
> Each step is about 300 to 400 lines.

## Decisions

Jacob, 2026-10-17:

1. **One release.** Phase 1, phase 2 ingestion and §7 steps 4, 5 and 7 ship
   together.
2. **Attio is ingested too:** call recordings and notes, next to GitHub and
   Linear.
3. **Ingested items are workspace-visible** (permission rule 3). An item
   remembered in a private channel becomes visible to the whole workspace once
   it is ingested.

Earlier decisions that still hold: no backfill on connect; real text, no
per-item summary; Remember removed; your own webhooks are not ingested;
`fetch_source` stays stored-only; tool access never hides data (rule 5);
`pg_textsearch` yes; no item-to-item links.

Defaults set while planning. Change them before the step is built if wrong:

- **`source.channel_id` is dropped.** With Remember gone, no stored item comes
  from a channel, so the Step 1 column and its backfill script have no use.
  Neither has reached a database. Permission rule 2 is retired.
- **Existing `source` rows are deleted**, not refetched. They hold summaries,
  and there is no backfill.
- **Bot comments and reviews are skipped** (GitHub `user.type === "Bot"`,
  Linear `botActor`). Bot output is long and LLM-written, and neural
  retrievers favour LLM-written text (`session-memory-research.md`, Dai et
  al.). The item itself is kept even when a bot opened it.
- **Not ingested:** GitHub releases, commits and code; Attio list entries
  (an event, not content), records, tasks and comments; Notion; Better Stack.
- **Catch-up sweeps cover GitHub and Linear.** Attio redelivers failed
  webhooks for about 3 days, so it gets none.
- **Rate limits:** one queue limiter plus retries with backoff. No
  per-connection token bucket until a workspace hits a limit.

## Steps

Build order: Step 1 removes the only writer of today's `source` rows, so
Step 2 can reshape the table. Steps 3 to 5 fill it. Steps 6 to 9 change
`search`. Every step's schema change lands in the one `db:push` at rollout.

### Step 1: remove Remember

[ ] built · [ ] committed

~350 lines, mostly deletions.

- Schema: drop `connector_trigger.remember`, `connector_trigger.remember_hint`
  and `trigger_delivery.remembered`. The change-proposal trigger spec drops
  `remember` and `rememberHint` (`packages/db/src/schemas/change-proposals.ts`).
  Stored proposals keep the keys in jsonb; the zod parse drops them.
- `apps/api/src/lib/connector-triggers.ts`: remove the Remember effect and the
  `ingestSource` call. `RememberDraft` becomes `EventItem` (title, url,
  author, content), used only for the Act payload.
- `excludedFromMemory` on event cards: true when the event's item is ingested
  (GitHub PR and issue events, Linear issue events, Attio note and call
  recording events), because the item lives in `source`. Cards for releases,
  Attio list entries and your own webhooks stay searchable chat. Handlers pass
  `ingested`.
- Integrations and webhooks routes: schema and handler fields
  (`integrations/schema.ts`, `integrations/handlers.ts`, `webhooks/schema.ts`,
  `webhooks/handlers.ts`, `webhooks/index.ts`); `lib/change-proposals.ts`.
- Web: the Remember toggle and hint (`trigger-effects.tsx`),
  `connectors-section.tsx`, the webhook badge and fields
  (`channel-webhooks-tab.tsx`), "saves to memory" (`proposal-card.tsx`),
  `design-samples.ts`. Mobile: `proposal-card.tsx`.
- Lor: remove Remember from the trigger proposal tool's copy.
- Docs: `automation-primitives.md` (Remember effect removed; ingestion
  replaces it), `connector-tools.md`.

### Step 2: store real text

[ ] built · [ ] committed

~400 lines.

- Schema, `source`:
  - add `body` (text, not null, default `''`), `state`, `sourceCreatedAt`,
    `sourceUpdatedAt`, `contentHash` (null on rows from before phase 2) and
    `fetchedAt`;
  - drop `summary`, `embedding` with its HNSW index, `occurredAt`, and
    `channelId` with its index and relation;
  - status `archived` is the tombstone: body empty, chunks deleted, row kept.
- Schema, new `source_chunk`: `workspaceId`, `sourceId` (FK cascade),
  `position`, `text`, `embedding` (halfvec 2560); HNSW, a tsvector GIN
  expression index, unique (`sourceId`, `position`).
- `packages/lor/src/sources.ts`:
  - `SourceItem`: kind, externalId, url, title, author, state, body,
    createdAt, updatedAt.
  - `storeSourceItem(connection, item, onUsage)`: hash title, state and body.
    Upsert only when the stored `sourceUpdatedAt` is not newer. Always set
    `fetchedAt`. When the hash changed: split the body (`splitText`, 2,000
    characters, the title as a header line on every chunk, at most 60 chunks,
    body capped at 200,000 characters), embed in one batch, and replace the
    chunks in one transaction.
  - `tombstoneSource` and a by-prefix variant (a removed repo).
  - `searchSources(workspaceId, query, limit)`: keyword and vector over chunks,
    RRF (k = 60), at most 2 hits per item. Returns id, provider, kind, title,
    author, url, state, when, the chunk text and `truncated`.
  - `fetch_source(id, offset?)`: the stored body in 20,000-character pages,
    with title, url, kind, state and updated date.
  - `resolveSourceCitation`: no channel join.
  - Delete `ingestSource`, `summarize`, the live path of
    `fetchSourceContent`, and `SourceProvider.fetchContent`.
- Visibility: workspace, active row, active connection (rule 3).
- `search` (`index.ts`): the `sources` kind passes the query, its rerank
  document is title plus chunk, and the tool description and system prompt
  describe stored items (PRs, issues, notes, call transcripts) and
  `fetch_source`.
- Delete `packages/db/src/scripts/backfill-source-channels.ts`. New one-off
  `packages/db/src/scripts/delete-summary-sources.ts` deletes rows with
  `content_hash is null`: old summaries, your own webhook rows, releases,
  list entries.
- `session-memory.md`: mark Step 1's channel scope and rule 2 superseded.

### Step 3: ingest queue and GitHub

[ ] built · [ ] committed

~380 lines.

- `SOURCE_INGEST_QUEUE` (`packages/realtime-types/src/queues.ts`), job data
  `{ connectionId, kind, ref }`. `ref` is what the fetcher looks up; the
  stored key comes from the fetched item.
- API producer `apps/api/src/lib/source-ingest-queue.ts`: BullMQ
  deduplication (id `connectionId-kind-ref`, ttl 15 s) with a 15 s delay, so
  a burst of events for one item makes one fetch, and an event after the
  fetch starts makes a new job. 5 attempts, exponential backoff from 60 s.
- Worker `apps/worker/src/jobs/source-ingest.ts`: load the active connection,
  call its fetcher (`SOURCE_FETCHERS` in `packages/lor/src/providers`, keyed
  by `github`, `linear`, `attio`), then store or tombstone. A fetcher returns
  an item, `"missing"` (404 or deleted: tombstone), or throws (retry).
  Concurrency 2, limiter 5 jobs per second. Embedding usage is metered at true
  cost and never debited, like attachment indexing.
- GitHub fetcher: PR = `pulls.get`, issue comments, review comments and review
  bodies; issue = `issues.get` and comments; the first 100 of each list. Key
  `owner/repo#n`, lowercased. State open, draft, closed or merged.
- Webhooks (`github/events.ts`) enqueue on:
  - `pull_request` opened, edited, closed, reopened, ready_for_review;
  - `issues` opened, edited, closed, reopened, deleted, transferred;
  - `issue_comment` created, edited, deleted (the parent PR or issue);
  - `pull_request_review` submitted, edited, dismissed;
  - `pull_request_review_comment` created, edited, deleted.
  `installation_repositories.removed` tombstones that repo's rows. Trigger
  effects (Post, Act) stay separate.
- Docs: `github-connector.md` records the reversal of "No embedding by
  default" and "Webhooks not needed", and the new subscriptions.

### Step 4: Linear and Attio

[ ] built · [ ] committed

~380 lines.

- Linear fetcher: `client.issue(ref)` (identifier or id), comments (first
  100), state name, creator, timestamps; trashed is `"missing"`. Key = the
  identifier.
- Linear webhook (`linear/index.ts`): Issue create and update enqueue the
  identifier; Issue remove tombstones it; Comment create, update and remove
  enqueue `issue.identifier`, else `issueId`. Linear already sends Issues and
  Comments.
- Attio fetchers:
  - note: title, markdown body, the parent record's title, timestamps. Key
    `note#<id>`.
  - call recording: meeting title and transcript (`fetchAttioCallRecording`,
    `formatAttioTranscript`). Not completed: throw to retry; failed:
    `"missing"`. Key `call_recording#<meetingId>/<recordingId>`.
- Attio webhook (`attio/index.ts`): ingestion runs whether or not a trigger is
  on. `call-recording.created`, `note.created`, `note.updated` (title) and
  `note-content.updated` (body) enqueue; `note.deleted` tombstones. The
  webhook subscribes to the trigger events plus these. Existing Attio
  connections must reconnect to get the new subscriptions.
- Docs: `adding-a-connector.md` gains an ingestion step (fetcher, webhook
  events, sweep).

### Step 5: catch-up sweeps

[ ] built · [ ] committed

~280 lines.

- Schema, new `sync_cursor`: `connectionId` (FK cascade), `stream`, `cursor`
  (timestamp), `updatedAt`; unique (`connectionId`, `stream`).
- Maintenance job `sweep-source-updates`, hourly:
  - GitHub: for each installed repo, `GET /repos/{owner}/{repo}/issues` with
    `state=all`, `sort=updated`, `since` = cursor minus 10 minutes, up to 3
    pages of 100. Enqueue each item; move the cursor to the newest
    `updated_at` seen. About one request per repo per hour.
  - Linear: `issues` filtered on `updatedAt` after the cursor, including
    archived, up to 3 pages of 100.
  - A connection's first sweep only sets its cursor to now (no backfill).
- Maintenance job `verify-sources`, daily: per connection, enqueue the 100
  active rows with the oldest `fetchedAt`. A missing item is tombstoned. Over
  time this rechecks every stored row, which catches deletes that sent no
  webhook.

### Step 6: BM25 and hybrid search for every kind

[ ] built · [ ] committed

~350 lines. Needs `pg_textsearch` installed with `shared_preload_libraries`
on dev and prod before `db:push`.

- BM25 indexes (`USING bm25 (...) WITH (text_config = 'english')`) on message
  content, attachment chunk text, voice passage context and text, source
  chunk text, and brain page name and body.
- Keyword sides keep today's match (`@@` with `orTsQuery`, the existing GIN
  indexes) and order by `<@> to_bm25query(query, '<index name>')`, ascending
  (scores are negative). The index name must be explicit: the planner cannot
  infer it for parameterized queries.
- Brain gains a keyword side, fused with its vector side by RRF.
- Iterative scan: a helper runs each vector query in a transaction with
  `SET LOCAL hnsw.iterative_scan = relaxed_order`, then re-sorts by distance
  in code. Used by brain, attachments, calls and sources.
- Check: `EXPLAIN` the keyword and vector queries on prod after the install.

### Step 7: search filters

[ ] built · [ ] committed

~300 lines.

- `search` inputs: `author`, `channel`, `since`, `until` (ISO dates).
- Applied per kind:

  | Kind | author | channel | since / until on |
  |---|---|---|---|
  | messages | message author | channel | created |
  | attachments | sharer | channel | shared |
  | calls | no | channel | call start |
  | sources | item author | no | item updated |
  | memory | no | no | page updated |
  | sessions | no | channel | touch created |

- A kind that cannot apply a given filter is skipped, so "what did Ana say"
  returns no memory pages.
- `author` matches a display name or login, case-insensitive substring;
  `channel` matches a channel name.

### Step 8: ranking priors

[ ] built · [ ] committed

~220 lines.

- Keep the rerank cutoff (`RERANK_MIN_SCORE`, 0.45). Order the kept results by
  `logit(p) + 0.3 R + 0.3 A`, with p the rerank score.
- R (recency) = 0.5^(age / half-life): chat and session messages 30 days,
  calls 60 days, open issues and PRs no decay, closed items, files and memory
  365 days.
- A (authority): merged PR 1.0; files people shared 0.8; issues and open PRs
  0.6; calls and chat 0.4; Lor-written text (memory pages, Lor's messages)
  0.2; superseded memory pages 0 (Step 9).
- A pure function in `packages/lor/src/ranking.ts`; candidates carry `when`
  and their class. If the rerank fails, each kind keeps its order and no
  priors apply.
- Starting values, untuned. Retune when the eval exists.

### Step 9: conflicts

[ ] built · [ ] committed

~200 lines. No model call: the write-time and query-time classifiers in
`context-engine.md` §5.10 are not built.

- Hits carry `when`, `authority` (`merged_pr`, `file`, `issue`, `call`,
  `chat`, `lor`) and `aiGenerated` (memory pages, Lor's messages).
- Memory hits: links carry `since` (the edge's `createdAt`). A page with an
  incoming `supersedes` edge returns `supersededBy` (path and date).
- System prompt: when results disagree, give both sides with their dates and
  sources, say which weighs more and why, and cite both.
- Write-back and archive synthesis: a decision that replaces one in memory
  goes on a new page, linked `supersedes` to the old page; the old page stays
  as it was. `edit` is for corrections and additions.

## Rollout (Jacob, after every step is built)

1. Install `pg_textsearch` on dev and prod: `shared_preload_libraries`,
   restart, `CREATE EXTENSION pg_textsearch`.
2. `db:push` (phase 1 and phase 2 schema in one push).
3. Scripts, each with `--dry-run` first:
   `pnpm --filter @repo/db exec tsx src/scripts/delete-summary-sources.ts`,
   then `pnpm --filter @repo/lor exec tsx src/scripts/backfill-touches.ts`.
4. GitHub App settings (prod and dev): add the Issue comment and Pull request
   review comment subscriptions.
5. Deploy API and worker. Reconnect Attio to get the new webhook
   subscriptions.
6. Live checks: a PR comment and a Linear comment show up in `search` within
   a minute; a deleted Linear issue drops out; project memory writes;
   past-session lookup; the long-task eval for `edit`.
7. Merge.
