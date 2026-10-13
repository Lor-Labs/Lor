# Sync engine

> Status: planned, not committed. Written 2026-10-11 with Jacob; the research
> was widened the same day. Only the timing is decided: no data-layer change
> before the `app-redesign-sessions` branch merges. Whether we adopt a sync
> engine at all is still open. Library facts were checked on the web on
> 2026-10-11; check them again before any spike, because these projects move
> fast.

## Plan

- Keep hand-patched React Query (cancel, snapshot, patch, settle) until the
  `app-redesign-sessions` branch merges, including all of Phase F (mobile) in
  `reference/workspace-model-runbook.md`. Changing the data layer on web and
  mobile while porting 16 mobile steps doubles the risk.
- Until then, prefer socket pushes that carry the changed row over pushes that
  only ask for a refetch. That removes most refetch races, and it helps with
  either engine below.
- If we go ahead after the merge, run a one-week spike on one slice: the
  sidebar and sessions. Try Zero first and judge it against the
  [spike gates](#spike-gates-zero). If Zero fails a gate, try TanStack DB query
  collections on the same slice (see
  [Fallback](#fallback-tanstack-db-query-collections)).
- Never build our own sync engine; Linear spent years on theirs.
- Lor's token streaming, typing, presence and voice stay on Socket.IO, and
  search stays on the server, in every option.

## Why look at a sync engine

The bugs we fixed in Step 19c (optimistic UI) are the bugs a sync engine
removes:

- One thing lives in many caches. A session is in the session page cache, the
  sidebar snapshot, its subscriber list and the channel's session list, and
  every optimistic change patches each by hand (`patchSidebarSession`,
  `patchSessionCache`, `showWriteSubscribers`, …).
- Refetch races. Most pushes say "something changed" and the client refetches,
  so a stale refetch can overwrite an optimistic change. That is why we need
  `cancelQueries`, mutation-key gating, and care about when the server pushes
  `workspace:activity:updated`.
- Optimistic UI is per feature. The 2026-10-11 audit found 16 actions that
  waited on the server; a sync engine makes writes instant by default.

## Our data layer (2026-10-11)

The facts that decide fit:

- **Postgres is the source of truth.** Postgres 16 on Railway, pgvector
  installed by hand, 64 tables applied with `drizzle-kit push`. No views,
  triggers or Postgres functions. Every table has a primary key.
- **Most rows come from server processes, not users.** `apps/worker`,
  `packages/lor` and `packages/voice` write run steps, run events, Lor
  messages, voice transcripts and embeddings. An engine must deliver rows
  written straight to Postgres.
- **Read filtering lives in one place**,
  `packages/db/src/queries/channel-access.ts`: workspace membership; audience
  inherited from the parent category; `audience = "members"` needs a
  `channel_member` row; DMs (`workspaceId = null`) need membership on the
  channel itself; a forbidden channel returns `not_found`. Live-call threads
  are visible only to connected participants
  (`packages/db/src/queries/session-chat-access.ts`).
- **The sidebar is not a table.** `getWorkspaceActivity`
  (`apps/realtime/src/services/workspace-activity.ts`) aggregates runs, plans,
  approvals and `thread_read_state` into per-user session state, capped at 200
  sessions.
- **Realtime:** 49 server-to-client events. About 30 carry the changed data, 8
  only signal a refetch, and 11 are streams or ephemeral state. Many web
  handlers invalidate even when the event carries data.
- **Clients:** web has about 107 `useQuery`, 81 `setQueryData` and 106
  `invalidateQueries` calls. Mobile uses React Query with no local storage;
  offline-first sync is a v1 non-goal (`MOBILE_ARCHITECTURE.md`). The Tauri
  desktop app loads the web build.
- **Data is kept forever.** `agent_run_event` (one row per streamed frame) is
  the only pruned table. Messages load 50 per page.

## Candidates

| Option | Verdict | Main reason |
|---|---|---|
| Zero | First choice for a spike | Syncs from our Postgres, mutators run on our server, permissions live in our endpoint, stable |
| TanStack DB (query collections) | Fallback | No new infrastructure, but sync correctness stays with us |
| PowerSync | Only if offline-first becomes a goal | Sync rules allow no `LIMIT` or `ORDER BY`; a second permission system |
| Electric | Ruled out | Bought by Databricks, Cloud shut down, engine work slowed |
| Convex | Ruled out | Replaces Postgres and most of the backend |
| Automerge, Jazz, Ditto, LiveStore | Ruled out for app data | Each wants to own the data store |
| InstantDB, Triplit | Ruled out | Shutting down or dormant |

### Ruled out

- **Electric.** Databricks bought Electric on 2026-08-11 and shut down Electric
  Cloud on 2026-09-28. Commits to the sync engine fell from about 36 a month to
  9–12. The company now calls itself "the agent platform built on sync".
  Technically it fits (subquery shapes went GA in 1.7.10, so "channels I am a
  member of" works), but we would self-host an Elixir service with a shrinking
  upstream. It was TanStack DB's main route to true sync.
- **PowerSync.** Mature, funded, and the best at offline. Against us: Sync
  Streams allow no `LIMIT` or `ORDER BY`, so endless message history means
  whole-channel buckets or a "recent" flag we keep up to date; permissions
  become a second rule set in YAML (inner joins only, no `NOT IN`); bucket
  storage keeps another copy of every synced row; FSL licence; the Tauri SDK is
  alpha; WebKit on iOS 26.2 kills the page after the WASM module loads
  (powersync-js #1081). Revisit only if offline-first becomes a product goal.
- **Convex.** All data moves into Convex's own tables (on Postgres it stores
  opaque blobs, so Drizzle and pgvector can't read them). Hono, Drizzle, BullMQ
  and pgvector search get rewritten. Search is weaker: vector search runs only
  in actions and returns at most 256 results, and there is no trigram match.
  Optimistic updates are still written by hand for each mutation. No offline
  layer.
- **Automerge, Jazz, Ditto, LiveStore.** None can sit on top of Postgres as a
  sync layer. LiveStore's docs say to use Zero or Electric if you already have
  a source-of-truth database, and it has no partial sync inside a store. Ditto
  is proprietary, filters permissions only on `_id`, and has no Postgres
  connector. Jazz v2 is alpha, with breaking releases every few days and a
  6.4 MB WASM bundle. Automerge syncs whole documents and has no queries across
  them.
- **InstantDB, Triplit.** InstantDB's team joined OpenAI, and Instant Cloud
  shuts down on 2027-08-31. Triplit's team joined Supabase, and there has been
  no release since July 2025.

Keep in view:

- Automerge with Keyhive for end-to-end encrypted DMs: the sync server only
  relays ciphertext. Keyhive is alpha; check again when it is stable.
- Jazz v2's row policies (`allowRead.where(anyOf([...]))`) as a reference for
  how to write our read rules.

### Zero vs TanStack DB

TanStack DB is a client-side query layer that we plug a data source into. Zero
is a complete sync engine, client and server, built on Postgres.

| | Zero (Rocicorp) | TanStack DB query collections |
|---|---|---|
| What it is | A client store, plus `zero-cache`, which keeps a SQLite replica of Postgres through logical replication | Client-side collections, live queries and optimistic transactions on top of our existing API |
| Maturity | 1.0 on 2026-03-24, 1.10 on 2026-10-09; about one minor release a month; no breaking changes from 1.0 to 1.9; Apache-2 | 0.13 on 2026-10-10; 1.0 was due December 2025; breaking changes still land in minor releases; one maintainer wrote about 75% of commits since August |
| Sync correctness (ordering, gaps after reconnect, rows leaving a paged window) | Zero handles it | We handle it. PR #2065 says pushed rows can't keep a limited window correct |
| Rows written by workers and webhooks | Arrive through replication | Our sockets must push full rows |
| Writes | Mutators run on the client (optimistic), then on our server in a Postgres transaction (Drizzle adapter); a throw reverts the client change | Optimistic transactions; our handler calls the API; rollback on error |
| Permissions | A Hono endpoint receives each named query and returns a filtered ZQL query; relational rules (`exists`) work | Unchanged: `assertWorkspaceAuthority` in each handler |
| Performance | Local reads in the next frame; incremental queries on client and server; scale out by adding view-syncers | Fast client queries (the docs claim 0.7 ms per update on a sorted 100k-row collection); freshness depends on our endpoints and pushes |
| Path to true sync | Already there | Electric (ruled out) or PowerSync (poor fit) |
| New infrastructure | `zero-cache`; logical replication on Postgres | None |
| React Native, Tauri | expo-sqlite or op-sqlite on native; IndexedDB on web, with a memory fallback when WebKit fails to open it | SQLite persistence for Expo, op-sqlite, Tauri and browser OPFS |
| Known limits | No aggregates, text search, column-level permissions or offline writes; arrays sync but can't be filtered; `vector`/`halfvec` columns don't replicate; replica under about 100 GB recommended; about 100 KB gzipped with React bindings | Pre-1.0; on-demand mode refetches every live query on each pushed row (PR #2065 open); an on-demand cache is not yet an offline snapshot |

Why Zero first: TanStack DB on our sockets removes the multi-cache patching, but
ordering, gaps after reconnect and membership changes stay with us. That is a
partial sync engine of our own, which the plan rules out. Its upgrade path to
true sync is now weak.

## Spike gates (Zero)

Each gate is go/no-go. If one fails and has no workaround, stop and try the
fallback.

1. **Migrations.** `zero-cache` needs expand/contract schema changes: add the
   column, wait for replication, then ship the API and clients; remove in the
   reverse order. A one-step `db:push` that drops or renames a column breaks
   clients that are already deployed. Native apps need their own
   `onUpdateNeeded` handler. This is the largest change to how we work. Also
   check that `drizzle-zero` (0.21) generates a usable schema from
   `packages/db`.
2. **Sidebar.** ZQL has no aggregates or counts. Running, queued, approval and
   unread state must become stored columns, or the client derives them from
   related rows. Prove that one of these reproduces `getWorkspaceActivity`.
3. **Small publication.** Use a custom publication with column lists. Leave
   out `agent_run_event`, run step payloads, the embedding tables,
   `attachment_chunk`, and the `secrets` jsonb columns on `mcp_server` and
   `custom_tool` (Zero has no column-level permissions yet). Zero recommends a
   replica under about 100 GB and we keep data forever, so measure `message`
   with its jsonb columns (`lorToolCalls`, `lorReasoningSegments`) and decide
   what stays on REST. Replication topped out at about 2,000–2,500 writes per
   second in Rocicorp's benchmarks.
4. **Permissions.** Write the `channel-access.ts` rules as ZQL in a Hono query
   endpoint: inherited category audience, members-only channels, DMs,
   live-call threads. Confirm that losing access removes rows already on the
   client (the design implies it; the docs don't say it). Role logic computed
   in JS stays fixed until a re-transform
   (`ZERO_AUTH_RETRANSFORM_INTERVAL_SECONDS`, unset by default). Call
   `zero.delete()` on logout.
5. **Message paging.** `orderBy().limit(50)` with `start()`, or `zero-virtual`
   for chat lists (needs Safari 26+). Check permalinks and jump-to-message.
   1.10 fixed stale rows in relationship + OR + `limit()` queries, which is the
   shape of our channel queries; test that shape.
6. **Platforms.** Expo SDK 57 / React Native 0.86 (the official sample uses SDK
   54). In Tauri's WebKit view, check `zero.kvStore.kind` for the memory
   fallback. Use token auth, because cookies don't reach `zero-cache` from
   `tauri://localhost` or React Native. The desktop CSP must allow `wss` to
   `zero-cache`.
7. **Railway.** Set `wal_level=logical` and restart. The upstream connection
   must be direct (no pooler), and Postgres must allow at least 5 ChangeDB
   connections plus 1 per view-syncer. The replication slot keeps WAL on disk
   while `zero-cache` is down, so watch disk use. Start with one `zero-cache`
   node on a volume; more nodes need S3 backups (Litestream) and sticky
   sessions.
8. **Offline.** Zero queues writes for about a minute, then rejects them.
   Confirm that is acceptable on mobile.

Cloud Zero (from $30 a month, still onboarding) keeps the replica in
Rocicorp's AWS account unless we pay for BYOC. Self-host for the spike.

## Fallback: TanStack DB query collections

If Zero fails a gate:

- Eager collections for small tables (workspaces, channels, subscriptions,
  roles). On-demand collections with `useLiveInfiniteQuery` for messages.
- Every socket push carries the full row and goes in through `writeUpsert` or
  `writeDelete`. Add per-channel sequence numbers so the client can find gaps
  after a reconnect.
- Check first that the on-demand refetch regression (PR #2065) is fixed.
- Persistence is optional: SQLite packages exist for Expo, op-sqlite, Tauri and
  the browser.

## Sources (read 2026-10-11)

Zero:

- [Docs index](https://zero.rocicorp.dev/llms.txt)
- [Release notes](https://zero.rocicorp.dev/docs/release-notes)
- [Status](https://zero.rocicorp.dev/docs/status)
- [Postgres support](https://zero.rocicorp.dev/docs/postgres-support)
- [Queries](https://zero.rocicorp.dev/docs/queries) and [auth](https://zero.rocicorp.dev/docs/auth)
- [Mutators](https://zero.rocicorp.dev/docs/mutators)
- [Self-hosting](https://zero.rocicorp.dev/docs/self-host)
- [React Native](https://zero.rocicorp.dev/docs/react-native)
- [drizzle-zero](https://github.com/rocicorp/drizzle-zero) and [zero-virtual](https://github.com/rocicorp/zero-virtual)
- Benchmark and incidents: [#6438](https://github.com/rocicorp/mono/pull/6438), [#6311](https://github.com/rocicorp/mono/pull/6311), [#6585](https://github.com/rocicorp/mono/pull/6585)
- [InfoQ: Zero reaches 1.0](https://www.infoq.com/news/2026/06/zero-version-1/)

TanStack DB:

- [Changelog](https://github.com/TanStack/db/blob/main/packages/db/CHANGELOG.md)
- [0.5: query-driven sync](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync)
- [0.6: persistence, offline support, includes](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes)
- [1.0 release candidate issue](https://github.com/TanStack/db/issues/1319)
- [On-demand refetch fix (PR #2065)](https://github.com/TanStack/db/pull/2065)

Electric and PowerSync:

- [Electric joins Databricks](https://electric.ax/blog/2026/08/11/electric-joining-databricks)
- [Electric Cloud shutdown (PR #4812)](https://github.com/electric-sql/electric/pull/4812)
- [Electric shapes](https://electric.ax/docs/sync/guides/shapes)
- [PowerSync Sync Streams](https://docs.powersync.com/sync/streams/overview) and [supported SQL](https://docs.powersync.com/sync/supported-sql)
- [PowerSync: phasing out Sync Rules](https://releases.powersync.com/announcements/our-plan-for-phasing-out-sync-rules)
- [powersync-js #1081 (WebKit)](https://github.com/powersync-ja/powersync-js/issues/1081)

Convex:

- [Optimistic updates](https://docs.convex.dev/client/react/optimistic-updates)
- [Limits](https://docs.convex.dev/production/state/limits)
- [Self-hosted backend](https://github.com/get-convex/convex-backend)
- [Object sync engine](https://stack.convex.dev/object-sync-engine)

Local-first:

- [LiveStore: when to use it](https://docs.livestore.dev/evaluation/when-livestore/)
- [Jazz permissions](https://jazz.tools/docs/auth/permissions)
- [Ditto data authorization](https://docs.ditto.live/sdk/latest/auth-and-authorization/data-authorization)
- [Automerge Keyhive](https://github.com/automerge/automerge-repo-keyhive)
- [Instant team joins OpenAI](https://www.instantdb.com/essays/instant_team_joins_openai)
- [Triplit joins Supabase](https://supabase.com/blog/triplit-joins-supabase)
