# Sync engine: TanStack DB or Zero

> Status: decision note, written 2026-10-11 with Jacob. Not started. Library
> facts were checked on the web that day; check them again before the spike,
> because both projects move fast.

## Decision

- Keep hand-patched React Query (cancel, snapshot, patch, settle) until the
  `app-redesign-sessions` branch merges, including all of Phase F (mobile) in
  `reference/workspace-model-runbook.md`. Changing the data layer on web and
  mobile while porting 16 mobile steps doubles the risk.
- Until then, prefer socket pushes that carry the changed row over pushes that
  only ask for a refetch. That removes most refetch races without new
  infrastructure.
- After the merge, run a one-week spike on one slice: the sidebar and
  sessions. Compare TanStack DB and Zero. Never build our own sync engine;
  Linear spent years on theirs.
- Lor's token streaming and search stay on sockets and the server in every
  option.

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

## The two options

In short: TanStack DB is a better client-side data layer that you plug a data
source into. Zero is a complete sync engine, client and server, built around
Postgres.

| | TanStack DB | Zero (Rocicorp) |
|---|---|---|
| What it is | A client-side query engine: collections, live queries, optimistic transactions | A complete sync system: a client store, plus a server (`zero-cache`) that keeps a replica of Postgres |
| Maturity (2026-10-11) | Pre-1.0 (0.9); persistence and offline support landed in 0.6 | Stable: 1.0 shipped June 2026, now at 1.9 |
| How data gets to the client | Our choice. "Query collections" use our existing API endpoints. True sync needs ElectricSQL or PowerSync added | `zero-cache` copies Postgres through logical replication and streams the subsets each client's queries need |
| Writes | Optimistic transactions on the client; we write the handler that calls our API, and it rolls back on failure | "Mutators" run on the client first (optimistic), then on our server against Postgres (authoritative); the client rebases on the result |
| Permissions | Whatever our API enforces today (`assertWorkspaceAuthority` as the first statement of each handler) | Queries resolve through our server endpoint, where we enforce permissions. Channel audiences, private channels and session visibility must be written again there |
| New infrastructure | None for query collections | `zero-cache` (self-hosted, or managed "Cloud Zero"); Postgres needs logical replication |
| React Native | Yes, SQLite persistence for React Native, Expo and Tauri | Yes, `zero-react-native` with op-sqlite storage |
| Known limits | Not 1.0 yet; true sync is a second backend | Postgres only; views don't sync; some column types (for example arrays) are not supported; about 232 KB gzipped; limited client handling of rejected writes |

## What each means for us

- **TanStack DB is the gradual path.** Move one slice (sidebar and sessions)
  into collections on top of the current API and sockets. It removes most
  multi-cache patching and needs no new servers. Tradeoffs: pre-1.0, and true
  sync later means adding Electric or PowerSync.
- **Zero is the Linear-style path.** Live data and instant writes everywhere,
  which would replace most socket "refetch" pushes. Cost: a bigger migration
  (schema definitions, queries rewritten in ZQL, server mutators, permission
  rules written again, running `zero-cache`). Check that our Railway Postgres
  can enable logical replication (Jacob installs extensions by hand there).
  `vector` columns (embeddings) would not sync, but those tables are server-only
  anyway.

Starting point for the spike: TanStack DB query collections first, because
they need no new infrastructure. Look at Zero if we decide we want true sync.

## Before the spike, check

- Both libraries' current versions and stability.
- React Native support in Expo SDK 57 (`apps/mobile`) and in the Tauri desktop
  app.
- How each handles our permission model (channel audiences, private channels,
  people-only session turns, DMs that will be end-to-end encrypted and must
  never be indexed).
- For Zero: logical replication on Railway Postgres, and where `zero-cache`
  would run.

## Sources (read 2026-10-11)

- [TanStack DB 0.6: persistence, offline support, includes](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes)
- [TanStack DB 0.9.0 release](https://newreleases.io/project/github/TanStack/db/release/@tanstack/db@0.9.0)
- [InfoQ: Zero reaches 1.0](https://www.infoq.com/news/2026/06/zero-version-1/)
- [Zero docs index](https://zero.rocicorp.dev/llms.txt)
- [Zero release notes](https://zero.rocicorp.dev/docs/release-notes)
- [Zero 0.23 (React Native)](https://zero.rocicorp.dev/docs/release-notes/0.23)
