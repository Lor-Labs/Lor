# Context engine — linked, ranked, permission-safe company context for Lor

> Status: research and design, not built. Written 2026-10-10 from six research
> passes: Unblocked's public material, OSS graph-memory frameworks, code context
> engines, people/linking/rule mining, retrieval and ranking, and storage/sync/
> permissions. Repo facts were checked against code on 2026-10-10; verify again
> before building. Decisions in §8 are open until the owner locks them.
> Broader priorities: [`product-direction.md`](../product-direction.md).
>
> Phase 1 is planned in [`session-memory.md`](./session-memory.md) (decisions
> locked 2026-10-14): scope `source`, session-aware search, safe brain writes,
> and the general `touch` table with sessions as its first origin. The item
> table keeps the name `source`, and default ingestion is phase 2. Phase 1 was
> built 2026-10-16. Revised 2026-10-17: §7 holds the current build order and
> §8 the decisions; item-to-item links (§5.4), time-correlation hints and all
> code work are dropped or deferred.

## 1. Goal

Lor answers and acts with context that is **linked** across code, PRs, issues,
chat, calls, docs and people, **ranked** by more than text similarity, and
**permission-safe** for everyone who will read the answer.

The reference product is [Unblocked](https://getunblocked.com/): a context
layer that feeds coding agents (Claude Code, Cursor, Copilot, Codex) over MCP.
Lor differs in two ways that matter for the design:

- **Lor owns the conversation.** Channels, threads, sessions and call
  transcripts are native rows, not a Slack ingest.
- **Lor acts.** The product thesis is that company-brain products stop at
  retrieval; Lor uses the context to work. The engine serves Lor's own runs
  first. Exposing it to outside agents (MCP) is a later option.

## 2. What Unblocked does (as published)

Sources: [inside the engine](https://getunblocked.com/blog/inside-the-unblocked-context-engine/),
[how a context engine works](https://getunblocked.com/blog/how-a-context-engine-actually-works-and-why-you-need-to-care-now/),
[AI info page](https://getunblocked.com/ai-info/).

- **Graph.** Nodes are raw artifacts: code, PRs, issues, docs, incident
  channels, conversations, people. Edges come from shared identifiers ("the
  thread that mentions the ticket that links the PR"), time correlation, and
  authorship/review. Published edge types: `authored_by`, `reviewed_by`,
  `references`, `mentions`, `owns`, `supersedes`, `linked_from`.
- **Ingestion.** Historical backfill + webhooks + a reconciliation sweep for
  dropped webhooks. Code is chunked on AST boundaries.
- **Per-query pipeline.**
  1. Scope by asker identity and intent (their repos, collaborators).
  2. Retrieve in parallel: semantic, lexical, graph traversal, structured.
  3. Rank by recency, authority (code beats docs), expert graph, proximity
     to the asker.
  4. Surface conflicts with context; let the agent or person decide.
  5. Treat AI-written docs as intent, not fact.
  6. Compress to salient snippets with citations.
- **Expert graph.** From PR and commit activity, with time decay.
- **Rules.** "Recurring feedback becomes a candidate rule", from PR review
  comments.
- **Admission model.** They replaced cosine-top-100 → cross-encoder with Jev
  for memory selection: precision 34.8% → 46.4%, recall 63.8% → 77.6%, cost
  about equal, p50 latency 0.20 s → 0.35 s
  ([post](https://getunblocked.com/blog/jev-in-production-vs-cross-encoder/)).

Their OSS does less than their marketing. `unblocked/engineering-social-graph`
computes expertise from commits only, per directory; review activity feeds
team clustering only. `unblocked/repo-rules-agent` indexes existing rules files
(CLAUDE.md, .cursorrules, …); it does not mine review comments. The comment
mining and concept-level expertise are closed.

## 3. Lor today (as built, 2026-10-10)

| Store | Holds | Search | Notes |
|---|---|---|---|
| `brain_node` / `brain_edge` | Lor-written markdown pages; 6 typed edges | Vector only | Edges only via the `link` tool; no provenance to sources; `metadata` and `status = archived` never set |
| `source` | Summary + pointer per remembered connector event | Vector only (summary) | Opt-in per trigger ("Remember"); no scope column; `author` is a raw login |
| `message` | Channel chat | FTS only (`ts_rank`, OR-ed terms) | Never embedded (MVP spec §11); DMs excluded |
| `agent_session` + session messages | Lor sessions: prompts, Lor replies; tool calls in `agent_run_step` | FTS only, through `message` | Hits carry no session id or title; tool calls and results are not searchable (`session-memory.md`) |
| `attachment_chunk` | Image/PDF/slide text | FTS + vector, RRF k=60 | The only hybrid kind |
| `voice_passage` | Ended-call summaries and topic sections | FTS + vector, RRF | Action-item owners are free-text names |
| Live connector tools | GitHub, Linear, Notion reads | Provider APIs | GitHub reads use the installation token |

`search` (`packages/lor/src/index.ts`) runs all kinds in parallel, then one
`voyage/rerank-2.5` pass over about 90 candidates with a 0.45 cutoff
(`packages/lor/src/rerank.ts`). Embeddings are `alibaba/qwen3-embedding-4b`,
halfvec(2560).

**Gaps against the goal:**

1. No graph over artifacts. Nothing links a message to the issue to the PR.
2. No identifier extraction. `LINEAR_IDENTIFIER` / `GITHUB_PULL_REF` in
   `packages/lor/src/voice.ts` only validate model output.
3. No identity mapping or people model. No expertise, authority or recency
   signal in ranking.
4. Thin, opt-in ingestion. Review, comment, deployment and push webhooks
   arrive and are ignored, or are not subscribed.
5. Uneven access control on derived data (see §6).
6. Evals check top-1 of vector-only `searchBrain`, not the reranked `search`
   path (`packages/lor/src/eval/fixtures.ts`).

## 4. Open-source landscape

Maturity checked with `gh api` on 2026-10-10. **Conclusion: adopt no framework
as a dependency.** Every serious graph-memory option is Python and most need a
graph database. The useful parts are formulas and schema ideas, small enough to
port to TypeScript.

### Graph-memory frameworks

| Project | Verdict | Take |
|---|---|---|
| Graphiti (Zep), Python, Apache-2.0, 31.6k★ | Borrow ideas | Bi-temporal edges (`valid_at`/`invalid_at`/`expired_at`); episodes vs entities; cheap-first dedup cascade. No Postgres backend (maintainers declined, [#1781](https://github.com/getzep/graphiti/issues/1781)). Open invalidation bug retires unrelated facts: 16–49% retired, most audited cases wrong; a small open-weight judge scored 0/30 on contradictions ([#1728](https://github.com/getzep/graphiti/issues/1728)) |
| Cognee, Python, Apache-2.0 | Borrow ideas | `contradicts` edges that keep both facts; supersede only for declared one-to-one relations; rules mining. Postgres graph store is "a demo feature" |
| Mem0, Python/TS, Apache-2.0 | Skip | OSS v3 **removed** graph memory; now single-pass extraction + entity linking for ranking. Evidence that cheap linking does the work |
| Microsoft GraphRAG, MIT | Skip | Maintenance mode; extraction ~75% of index cost; incremental update appends and never refreshes old summaries |
| LightRAG, MIT | Skip | Closest fit, but Postgres graph needs Apache AGE plus a Python sidecar; no time model |
| HippoRAG 2, MIT | Borrow idea | Personalized PageRank from query seeds |
| LlamaIndex PropertyGraphIndex | Skip | `ImplicitPathExtractor` (reuse existing links, no LLM) is the idea; LlamaIndexTS is archived |
| Neo4j LLM Graph Builder | Skip | Human review of duplicate-entity merges |

### Code and engineering context

| Project | Verdict | Take |
|---|---|---|
| Aider repo map, Python | Borrow idea | Tree-sitter tags → file reference graph → PageRank personalised to chat files and mentioned identifiers |
| Sourcegraph SCIP / zoekt, Go | Skip | Undirected file graph for static rank (directed edges over-rank generated files) |
| Continue indexing, TS | Borrow idea | Content-hash catalog + branch tags: a branch switch re-tags, does not re-index |
| colbymchenry/codegraph, TS + Rust, MIT | Possible adopt | Embeddable Node library: tree-sitter symbols and call/import edges in SQLite. Could run in a worker and copy rows to Postgres |
| claude-context (Zilliz), TS, MIT | Reference code | AST chunking in TS; skip its Milvus dependency |
| Onyx, Python, MIT core | Borrow ideas | Knowledge graph in Postgres; declarative "metadata field → typed edge" rules per connector; ACL model (§5.5) |
| Potpie, Python | Borrow idea | "The LLM proposes a name; code computes the key" — stops agent-written edges from forking entities |
| GitNexus, GPL/AGPL tools, Serena | Skip | License (noncommercial, GPL) or needs language servers |

**Industry shift:** coding tools moved off code embeddings. Cursor turned
semantic indexing down in July 2026 ("models have gotten really good at using
grep") and uses a regex index; Continue deprecated `@Codebase`; Sourcegraph
dropped embeddings for Cody in 2024. Unblocked and Augment still embed, but
their edge is cross-artifact links. Cursor's evidence is from frontier models;
Lor runs open-weight models, so measure before deciding (§5.8).

### People, linking, rules

| Project | Verdict | Take |
|---|---|---|
| unblocked/engineering-social-graph, Python, MIT | Borrow formulas | §5.6 |
| unblocked/repo-rules-agent, Python, MIT | Borrow schema | Rule = title, description, severity (must/should/can), category, tasks, languages, scope; dedupe at similarity ≥ 0.85; flag 0.5–0.85 with different severity as a conflict |
| code-maat, Hercules, Truck-Factor | Borrow ideas | `regex => area` component mapping; identity merge as union-find over email↔name |
| graphology + graphology-communities-louvain, JS, MIT | Adopt if needed | Only if team clustering is ever needed |
| Backstage identity resolvers, TS | Borrow idea | Match on immutable provider IDs, not logins |
| Greptile, Cursor Bugbot, CodeRabbit, Qodo (closed) | Borrow ideas | §5.9 thresholds and lifecycle |

### Retrieval

| Option | Verdict | Notes |
|---|---|---|
| tsvector + `ts_rank` | Keep | Weak scoring (no IDF), but the reranker sets final order |
| Tiger Data pg_textsearch, PostgreSQL license | Later | Real BM25; needs PG 17/18 and `shared_preload_libraries` |
| ParadeDB pg_search | Skip for now | AGPL-3.0, custom image |
| RRF in plain SQL | Adopt | Σ 1/(60 + rank) over CTEs |
| pgvector iterative scan (≥ 0.8) | Adopt | Filtered HNSW can silently return short lists without it |
| Recursive CTEs | Adopt | 1–2 hops, `CYCLE` clause, per-hop `LATERAL … LIMIT` |
| LLMLingua-2, Provence, RECOMP | Skip | Python sidecar, or CC BY-NC (Provence); use window extraction instead |
| RAGAS, ARES | Skip | Python; nDCG/recall in TS is ~20 lines |

### Storage, sync, permissions

| Option | Verdict | Notes |
|---|---|---|
| Plain Postgres edge tables | Adopt | 1–2 hop expansion is the hot path; one SQL statement does ACL + vector + trigram + edge join. Postgres CTEs beat Neo4j ~4x on neighbourhood reachability in one benchmark |
| Apache AGE | Skip | Weak on variable-length paths; `agtype` does not fit Drizzle; small volunteer team |
| Neo4j, FalkorDB, Memgraph, SurrealDB | Skip | Second datastore, dual writes, ACLs enforced twice; licenses (SSPL, BSL) |
| Kuzu | Skip | Archived 2025-10 |
| Nango | Skip, borrow ideas | ELv2; free self-host excludes Syncs and Webhooks. Borrow checkpoints and delete tracking |
| Airbyte | Skip | Warehouse ELT, Python |
| OpenFGA, SpiceDB | Skip | Filtered retrieval is their weak case; copy the tuple model into Postgres |

## 5. Recommended design

### 5.1 Principles (proposed)

1. **Postgres only.** No graph database, no sidecar, no new extension in v1.
2. **Deterministic edges first.** Identifiers, API fields, authorship and time
   windows cost no inference. LLM-extracted edges run last, budgeted, on
   threads/docs/incidents only.
3. **Artifacts and brain pages stay separate.** Raw artifacts are ingested;
   brain pages stay Lor-authored (`automation-primitives.md`: no direct brain
   writes from inbound paths). Pages cite the artifacts they came from.
4. **A webhook is a signal.** Refetch canonical state; reconcile on a schedule.
5. **Filter by audience, not asker.** A Lor answer in a channel is read by
   every channel member.
6. **Relevance gates; priors reorder.** Recency can never lift an irrelevant
   item.
7. **Surface conflicts. Never delete.** Supersession is a dated edge.
8. **Expertise is a hidden ranking signal.** No per-person scores in UI.
9. **Code is a link anchor first.** Code embeddings only if evals show a gap.

### 5.2 Data model (sketch)

Naming (decided 2026-10-14): the item table keeps the name `source` and grows
into the shape below. `artifact` is taken by session deliverables
(`packages/db/src/schemas/artifacts.ts`). Refs live in one general `touch`
table ("this work read, wrote, cited, started from or mentioned that thing"),
built first with sessions as its origin (`session-memory.md` Step 5).

```
source                        -- today's `source`, extended
  id, workspace_id, connection_id, provider, kind (enum),
  external_id, url, title, body_text,
  author_identity_id, container_id, scope_channel_id,
  state, source_created_at, source_updated_at,
  content_hash, status (active | tombstoned), embedding, tsv
  unique (workspace_id, provider, external_id)

source_chunk                  -- long docs only
  source_id, ord, text, embedding

touch                         -- extracted refs; join key for links
  session_id | message_id | source_id | brain_node_id (exactly one),
  kind (enum), value, action (enum), created_at
  btree (kind, value)

item_edge
  workspace_id, from_id, to_id (nullable), to_ref (unresolved target),
  type (enum), origin (api | identifier | authorship | temporal | llm | human),
  origin_source_id, extractor_version, confidence, evidence,
  valid_from, valid_to, created_at, expired_at
  unique (origin_source_id, from_id, to_ref, type)

person_identity
  workspace_id, provider, external_user_id (immutable), login, email,
  user_id (nullable = placeholder), match_method (enum)

access_container              -- repo, Linear team, Notion connection
  connection_id, external_id, kind, visibility, access_mode, perm_synced_at
container_reader
  container_id, user_id, stale, synced_at

sync_cursor                   -- per connection + container + stream
ingest_event                  -- delivery id unique (idempotency)
brain_node_input              -- page → source provenance + ACL taint
  brain_node_id, source_id
```

Changes to existing tables:

- `brain_edge` gains `valid_at`, `invalid_at`, `expired_at`,
  `invalidated_by_edge_id`, and a `contradicts` type.
- `message` gains an embedding only if §8 decision 2 says so.

Edge `type` is a controlled enum (MVP spec §11). Starting set: `references`,
`closes`, `part_of`, `authored_by`, `reviewed_by`, `assigned_to`, `changes`
(PR → file), `deploys` (deploy → commit), `discussed_in`, `supersedes`,
`possibly_related` (time-window candidate, never auto-promoted).

Edges point at external refs, not only foreign keys, so a link can exist before
its target is ingested (Backstage). Reprocessing a source replaces exactly
the edges whose `origin_source_id` is that source (Backstage, DataHub).

Per-kind fields that are queried (PR `merged_at`, `head_sha`) go in narrow
typed side tables, not jsonb.

Rough cost (estimates; 2 vectors and 10 edges per item; Railway RAM
$10/GB-month; embeddings $0.02/M tokens):

| | 10k items | 1M items |
|---|---|---|
| Disk | ~0.35 GB | ~32 GB (~$5/month) |
| RAM to keep HNSW hot | ~0.16 GB | ~16 GB (~$160/month), the main cost |
| Embedding, one-time | $0.30 | $30 |
| LLM edges, one pass, gpt-oss-120b class | ~$3.5 | ~$350 |
| LLM edges, one pass, kimi-k3 class | ~$105 | ~$10,500 |

### 5.3 Ingestion

BullMQ queues, all in `apps/worker`:

| Queue | Job |
|---|---|
| `webhook` | Verify signature, record delivery id in `ingest_event`, debounce-enqueue `fetch` per item |
| `fetch` | Per-connection Redis token bucket from provider headers; refetch; upsert only if `source_updated_at` is newer; 404/delete → tombstone (drop content and vectors, keep the row) |
| `link` | Deterministic edges (refs, API fields, authorship, time windows) |
| `embed` | Only when `content_hash` changes |
| `llm-link` | Low priority, budgeted; threads, docs, incidents |
| `backfill` | Newest first, checkpointed in `sync_cursor` |
| `reconcile` | Hourly watermark pass with overlap; daily ID-only sweep for deletes and unshares (Onyx "slim" connectors) |
| `perm-sync` | Scheduled, plus membership webhooks |

BullMQ per-group rate limiting is Pro only; use the token bucket and delay the
job. Job ids must not contain `:`.

Provider facts that shape this:

- **GitHub** never redelivers failed webhooks; 10 s timeout. Installation
  limit 5,000–12,500 req/h; secondary limit 100 concurrent, 900 points/min.
  Add subscriptions: issue comment, PR review comment, PR review thread, push,
  member, membership, team, organization, repository. Reviews, deployment
  status and workflow runs already arrive and are dropped.
- **Linear** retries 3 times (1 min, 1 h, 6 h); 5 s timeout. Webhook scope is
  "all public teams, or a single team"; private teams may need per-team hooks
  (verify for OAuth apps). 5,000 req/h and 2M complexity points/h.
- **Notion** webhooks are signal-only and mostly aggregated (delayed); up to 8
  retries over ~24 h. 180 req/min per connection. No API lists who can see a
  page.

User deletions propagate through tombstones; everything else is kept forever
(system-of-record retention).

### 5.4 Linking

> **Dropped 2026-10-17** (§7 step 11): no item-to-item link table for now. Lor
> follows references through its tools, and stored text plus search finds
> identifiers. Session-to-item links live in `touch`. A lighter option, a
> `refs` list on each ingested item shown in search hits, was also considered
> and skipped: no half version. Revisit the full graph only if the eval's
> multi-hop questions fail. Kept for history.

**Identifiers** (run on `source`, message and session-step writes; never DMs):

- Linear keys: allowlist the workspace's real team keys from the API. A bare
  `[A-Z]+-\d+` matches ISO-8601, UTF-8, SHA-256, AES-128, COVID-19 and parts of
  CVE ids.
- GitHub: `owner/repo#N`, PR/issue/commit URLs, SHAs. Bare `#N` needs a
  channel-default repo. Hex colours look like SHAs.
- Skip fenced code, logs and quotes.
- Confirm the target exists with a cached API lookup before writing a resolved
  edge; otherwise keep `to_ref` unresolved.
- Map Linear's words to edge types: close/fix/resolve/complete/implement →
  `closes`; ref/part of/contributes to → `part_of`; relates to → `references`.
  Linear itself never links from PR comments.

**Declarative metadata edges** (Onyx): per connector, map fields to edges, e.g.
Linear `assignee` → `assigned_to`, PR `requested_reviewers` → `reviewed_by`,
merged PR files → `changes`.

**Time correlation** produces `possibly_related` candidates with a stated
reason ("deployed 14 min before the alert on the same service"), top 3,
±1 h window (Azure Gandalf, PagerDuty). A person confirms before promotion.
Source: `deployment_status` (already delivered) joined with Datadog and
CloudWatch alerts.

**Identity ladder** for `person_identity`, most to least trusted:

1. GitHub App user authorization (off today; see `github-connector.md`).
2. Exact provider email (Linear, Attio; Notion only with the email capability).
3. Parse GitHub noreply `ID+login@users.noreply.github.com`.
4. Fuzzy name match only as a prompt the person confirms.

Unknown people become placeholder rows with `user_id` null (Onyx). Never key on
logins; they change.

### 5.5 Permissions

> **Superseded 2026-10-16** by the permission rules in
> [`session-memory.md`](./session-memory.md): no per-connection access modes
> or ACL sync. Connecting a service shares what it can see with the whole
> workspace; Lor's own data and remembered sources follow their channel; data
> derived from private input stays private; tool access never hides data. The
> proposal below is kept for history.

- **ACL on the container** (repo, Linear team, Notion connection), not per
  document. A repo going private is one row update.
- **Access mode per connection:** `workspace` (today's behaviour), `channels`
  (only bound channels), `sync` (mirror source ACLs; fail closed until the first
  sync completes).
- **Audience filter.** Allowed containers = those every audience member can
  read. Audience = channel members for private channels/projects, all members
  for public channels. Cache per audience in Redis; bump a version on
  membership change.
- **Derived pages inherit** the most restrictive ACL of their inputs via
  `brain_node_input`. Archive synthesis is the main laundering risk today.
- **Sources with no ACL API** (Notion): connection-level access, or a
  query-time check with the user's own token.
- Every hop of graph expansion applies the same filter as the seed query.

### 5.6 Expertise

From `unblocked/engineering-social-graph` source (the code, not the README):

- Review interaction per PR: review 1.0, inline comment 0.7, issue comment 0.4.
  Score `(1 + log10(n)) × avg_weight`, normalised per PR. Drop bots and
  self-reviews.
- Gaussian decay `exp(-t² / 112²)`, t in days (C = 16 weeks); lookback 336 days.
- Area expertise per directory (depth ≤ 2): recency 0.35, decayed lines 0.30,
  file breadth 0.20, decayed commits 0.15 (Cury et al. 2022). The README's
  40/30/20/10 does not match the code.
- Default filter drops contributors under 7 PRs/month; startups need 0.

Adjustments from research:

- **Count review at least equal to authorship.** Meta's production study: time
  reviewing an author's past diffs is the strongest feature (33.9%); authored
  diffs only 4.9% ([arXiv 2312.17169](https://arxiv.org/html/2312.17169v2)).
- Add chat signal: knowledge that version control misses was 56% of misses in
  Avelino et al. Use authored messages only, never views or reads.
- Compute at query time over the retrieved items' authors and reviewers,
  or materialise nightly (`review_edge`, `area_expertise`) if that is too slow.
- For "who might know": rotate among the top 3 (Meta: −11.6% time-in-review)
  and prefer learners when one person holds the knowledge (Sofia).

**Surveillance line** (product rule: no surveillance surfaces): fine = hidden
ranking weight; "people who worked on this" with evidence links and no scores;
each person can see and correct their own inferred areas. Not fine = heat maps,
leaderboards, reviewer×author matrices, "single owner" badges, "new to this
area" labels about others, any signal from viewing behaviour. Version-control
expertise agrees with developers' own view only ~65% of the time, so visible
scores would also be wrong.

### 5.7 Retrieval and ranking

1. **Agent fills filters.** `search` gains `author`, `channel`, `since`/`until`,
   `kind`, `state`. No planner model call. Structured questions ("open issues
   owned by X") go to connector tools or a structured `source` query.
2. **Parallel SQL per kind:** FTS + vector (`SET LOCAL hnsw.iterative_scan =
   relaxed_order`) + trigram on titles/refs + exact `touch` hits, fused
   with RRF. Then 1–2 hop expansion over `item_edge` with the same ACL
   filter. Estimate 20–100 ms (guess).
3. **One relevance call** over ~90 candidates: Voyage `rerank-3` (or
   `rerank-3-lite`) or a Jev fan-out (question as state, up to 20 candidates as
   questions per request, ~5 parallel requests). ~$0.002 per search either way.
4. **Gate, then fuse, in code:**

   ```
   p = calibrated relevance        keep if p ≥ τ
   s = logit(p) + βr·R + βa·A + βe·E + βp·P
   ```

   - **R recency:** half-life per kind — chat ~30 d, calls ~60 d, open
     issues/PRs no decay, docs/memory ~1 y. Age runs from the latest of
     updated, last cited, last linked: "still referenced" means still current.
   - **A authority:** merged code/PR > human doc > issue > call ≈ chat >
     Lor-written text (intent, not fact).
   - **E expertise** of the author in the item's area (§5.6).
   - **P proximity:** same channel/scope, the asker's projects, items the asker
     authored or was assigned. Never DM signals.
   - Start β at 0.25–0.5 by hand; fit by logistic regression on the judged pool.
5. **Conflict check** only when two or more kept items share a topic (§5.10).
6. **Window extraction:** split long hits into 300–500 character windows,
   score them in the same relevance call, return top windows with `…` and a
   citation.

Estimated total: 0.6–1.2 s and under $0.005 per search.

The 0.45 Voyage cutoff came from about a dozen queries on one workspace. τ
must be tuned on the judged pool (§5.11) for a target admission rate. Jev via
AI SDK `experimental_decide` needs `ai` ≥ 7.0.128 (installed: 7.0.11); the raw
gateway route `POST /v1/evaluate` works without the upgrade.

### 5.8 Code

| Tier | Build | Cost |
|---|---|---|
| 0 | `code_file(repo_id, path, blob_sha, language, rank)` at default-branch HEAD; `code_symbol(repo_id, path, name, kind, start_line, end_line, exported)` from tree-sitter tags (`web-tree-sitter` or codegraph in a worker); `code_ref` file→file edges; FTS + trigram on paths and symbols. Content read live (`grep_code`, `read_file`) | CPU only |
| 1 | `pr_file` from the merged-PR files API; review comments mapped `path:line` → symbol; commit → file; merged-PR diff summaries on the `source` row (Augment "context lineage") | One small-model call per merged PR |
| 2 | Function-level embeddings or NL summaries per file/dir (Greptile: +12% similarity vs raw code) | Only if evals show a gap with agentic grep on open-weight models |

Freshness: key parse output by git `blob_sha` so unchanged content is never
re-parsed. A `push` on the default branch enqueues a job that calls
`compare before...after` (max 300 files); for more, walk trees and descend only
into changed subtree SHAs. Session branches are an overlay of the branch diff,
not a second index (Cursor, Continue). No Merkle tree needed; git already is one.

Ranking: static file rank from an **undirected** file graph (Sourcegraph);
per-query personalised PageRank seeded by the asker's recent PRs/files and the
identifiers in the question (Aider, HippoRAG). graphology's `pagerank` has no
personalisation; a ~40-line power iteration in TS does.

This reorders [`code-channels.md`](./code-channels.md) §11, which puts
`code_chunk` embeddings first.

### 5.9 Conventions from review comments

Pipeline (thresholds from the sources; the combination is a proposal):

1. Classify review comments; keep actionable ones. Classifiers reach ~59%
   (5 classes); good enough to filter, not to decide.
2. Normalise each to a one-line rule; embed.
3. Cluster per repo. Candidate when **≥ 3 matches** (Greptile) from **≥ 2
   reviewers on ≥ 2 PRs** (Unblocked's "independent evidence").
4. Shape with the repo-rules-agent schema; dedupe at 0.85.
5. A person approves through the change-proposals flow
   ([`change-proposals.md`](../change-proposals.md)) with evidence attached.
   Rules are attributed to evidence, never to individuals.
6. Lor reads rules through a tool call scoped by repo + globs + language, not
   by rebuilding the system prompt (prompt-cache stability).
7. Lifecycle: candidate → active → disabled on negative signal (Bugbot);
   check cited code still exists before use (Copilot Memory); prune on low
   adoption (BitsAI-CR "outdated rate").

Tables: `convention` (state, scope, severity, schema fields) and
`convention_evidence` (links to comments/threads).

### 5.10 Conflicts

- **Write time.** For a new brain page, ask one `choice` question against its
  top-5 neighbours in the same scope: duplicate / consistent / contradicts /
  supersedes / unrelated. On supersedes: add the edge and set `invalid_at` on
  the old one. On contradicts: add a `contradicts` edge; keep both.
- **Narrow candidates.** Only retire a fact that shares endpoints, or whose
  relation is declared one-to-one (Cognee). Never take invalidation
  candidates from a workspace-wide semantic search (Graphiti #1728).
- **Query time.** For kept results on one topic, one batched boolean: "do these
  disagree about the answer?" (~15 pairs at k = 6).
- **Presentation.** `search` returns `conflicts[]`; each item carries `asOf`,
  `author`, `authority`, `aiGenerated`. Lor shows both sides, says which weighs
  more and why, and cites both.

### 5.11 Evaluation

- **Judged pool (TREC style):** union of the top-30 from every method compared;
  LLM grades each pair 0–3 (UMBRELA scale); grade 10% twice to check the
  grader (Unblocked: 93% exact agreement).
- **Metrics:** nDCG@k, recall@k, precision at a fixed admission rate, and how
  often the system correctly returns nothing.
- **Fit τ and β on some workspaces; report on held-out ones.**
- **Never use production logs as labels.** Unblocked: 72% of opened notes had
  already been injected by the old system.
- Point `packages/lor/src/eval/` at `search`, not `searchBrain`.

## 6. Prerequisites — fix before building on top

Found by reading code on 2026-10-10; not reproduced by running.

1. **`source` leaks across private boundaries.** `searchSources`
   (`packages/lor/src/sources.ts:23`) filters by workspace and status only; a
   Remember on a private channel's trigger is visible to every run. Fix
   planned in `session-memory.md` Step 1.
2. **Installation-token tools ignore repo privacy.** `search_github` and
   `investigate_code` can read any installed repo from any channel with the
   GitHub capability. Accepted 2026-10-16 by permission rule 3 in
   `session-memory.md`: connecting a service shares what it can see with the
   whole workspace.
3. **Scoped citations may be stripped.** `groundCitations`
   (`packages/lor/src/index.ts:2974`) calls `pageExists` without a scope.
   Fixed in `session-memory.md` Step 3b.
4. **Scoped `/projects/<name>` writes may collide.** The seeded workspace-wide
   `/projects` folder and the scope-less unique key
   `brain_node_parent_name_uq` conflict when a scoped run creates its folder.
   Fixed in `session-memory.md` Step 3b (scope joins the unique key).
5. **Filtered vector search may return short lists.** No code sets
   `hnsw.iterative_scan`. Check the hand-installed pgvector version (≥ 0.8) and
   run `EXPLAIN` on prod. Checked 2026-10-17: pgvector 0.8.2 on Postgres
   17.11, so the setting is available; set it in vector queries in §7 step 4.
6. **MVP spec is stale** on prefetch, the read-only answer loop, and §6's
   "stored summaries are workspace-visible" premise.

## 7. Build order (revised 2026-10-17)

Ordered by value against cost. Each step should be a runbook step when this
moves to root. Status and scope as decided with Jacob on 2026-10-17.

| # | Step | Status |
|---|---|---|
| 0 | Judged-pool eval baseline on current `search` (§5.11): 50 questions to start, drafted by a model from prod sessions and threads and checked by Jacob, LLM-graded 0 to 3 with 10% graded twice. Include multi-hop questions (the answer sits 2 to 3 references away) | Deferred 2026-10-17: no users yet, so too little real data to draft from. Until it exists, deferred items reopen on gaps seen in real use, and step 5 keeps its starting values |
| 1 | `source` scoped by channel (`session-memory.md` Step 1). `access_container` and connection access modes dropped (permission rules) | Done; rest in step 3 |
| 2 | `touch` table, session lookup in `search`, reverse hints (`session-memory.md` Step 5) | Done |
| 3 | Ingestion (`session-memory.md` Phase 2): GitHub and Linear first; PRs and issues with their comments and review comments, no releases; real text, no per-item summary; webhooks as a signal, reconcile, tombstones; no backfill on connect for now; Remember removed | Decided, not written as steps |
| 4 | Hybrid search for every kind; `search` filters (`author`, `channel`, `since`/`until`, `kind`, more later); `hnsw.iterative_scan`; `pg_textsearch` BM25 (needs the extension and `shared_preload_libraries` on Railway, installed by Jacob) | Decided |
| 5 | Calibrated relevance cutoff + priors: authority (merged code/PR > human doc > issue > call ≈ chat > Lor-written) and recency half-lives (chat ~30 d, calls ~60 d, open issues/PRs none, docs/memory ~1 y) as starting values; retune on the eval | Decided |
| 6 | People: identities across services and a hidden ranking signal from who did the work (name open: "involvement" or "familiarity"); never scores, heat maps or leaderboards. GitHub App user authorization waits for this step | Later |
| 7 | Conflicts: show both sides with dates and which weighs more; dated `supersedes` edges on brain pages instead of edits | Decided |
| 8 | Code index (Tier 0 + 1), code parsing | Deferred to code channels |
| 9 | Conventions from review comments via change proposals | Later |
| 10 | `possibly_related` time-correlation hints | Dropped |
| 11 | Item-to-item links (`item_edge`, §5.4) and 1 to 2 hop expansion; LLM edges; code Tier 2 | Dropped: Lor follows references through its tools, and stored text plus search finds identifiers. Revisit only if the eval's multi-hop questions fail |

## 8. Decisions needed

1. **Proprietary relevance models.** Every reranker on AI Gateway is
   proprietary (Cohere, Voyage), and so is Jev. Lor's current default
   `voyage/rerank-2.5` is already proprietary. Either the open-weight rule
   covers generation only, or rerank/decision models get an explicit
   exception. Open alternatives on the gateway: Laya (Apache-2.0, ~half Jev's
   zero-shot accuracy) or LLM-as-judge (slower, costlier). **Decided
   2026-10-17:** a written exception for rerank and relevance models;
   generation stays open-weight.
2. **Embed individual messages?** Reverses MVP spec §11 ("never embed
   individual messages"). Cost ~$1 per 1M messages; fixes paraphrase misses.
   Session turns: deferred behind an eval (`session-memory.md`, 2026-10-14).
   **Decided 2026-10-17:** channel chat messages are deferred behind the same
   eval.
3. **Ingest by default.** Reverses `github-connector.md` "no embedding by
   default of GitHub PRs/issues" and "webhooks not needed". The engine needs
   GitHub and Linear ingested without a per-trigger Remember. **Decided
   2026-10-14:** yes, as phase 2. Store the real text with no per-item
   summary, remove Remember, and do not ingest your own webhooks (the posted
   chat message is the record). See `session-memory.md` Phase 2.
4. **Code index order.** Move `code-channels.md` §11 `code_chunk` embeddings to
   Tier 2. **Decided 2026-10-17:** all code work (index, parsing) waits for code
   channels; decide the order then.
5. **Default access mode** for new connections: `workspace` (today) or `sync`.
   **Decided 2026-10-16:** no access modes; every connection is
   workspace-wide (`session-memory.md`, permission rules).
6. **GitHub App user authorization** for identity (off today). **Decided
   2026-10-17:** not now; it waits for the people step (§7 step 6) or code
   channels.
7. **pg_textsearch** (needs PG ≥ 17 + preload) — check `SHOW server_version`
   on Railway first. **Decided 2026-10-17:** yes. Railway runs Postgres 17.11;
   Jacob installs the extension and the preload; used from §7 step 4.
8. **Outside agents.** Whether Lor later exposes the engine over MCP to
   Claude Code / Cursor (Unblocked's product) or keeps it internal. **Decided
   2026-10-17:** internal for now.

Compatible with existing rules and not up for change: DMs never indexed;
data kept forever with deletions propagated; brain pages stay Lor-authored;
edge types are a controlled enum; Postgres only.

## 9. Rejected alternatives

- **Graph-memory frameworks as dependencies** (Graphiti, Cognee, LightRAG,
  GraphRAG, HippoRAG): Python sidecar, graph DB, unreliable contradiction
  judges on open-weight models, global recomputation or stale summaries.
- **A separate graph database or Apache AGE:** dual writes, ACLs twice, no
  need for deep traversal on the hot path. Revisit only for offline graph
  algorithms at very large scale, and even then write scores back to Postgres.
- **LLM extraction as the primary edge source:** cost scales with facts per
  document; noise; Mem0 dropped it.
- **Workspace-wide semantic invalidation:** Graphiti #1728.
- **Nango / Airbyte / OpenFGA / SpiceDB:** license limits, Python, or weak
  filtered retrieval.
- **LLM-as-judge reranking:** a vendor study found it 12–15% worse on nDCG@10
  and 25–60× costlier than a dedicated reranker (vendor-biased).
- **Per-person expertise UI:** surveillance line and ~65% accuracy.
- **Code chunk embeddings first:** industry evidence points to grep + links.
- **Non-commercial licenses:** Provence, jina-reranker-v3, GitNexus.

## Sources

Unblocked: [inside the engine](https://getunblocked.com/blog/inside-the-unblocked-context-engine/) ·
[how it works](https://getunblocked.com/blog/how-a-context-engine-actually-works-and-why-you-need-to-care-now/) ·
[Jev vs cross-encoder](https://getunblocked.com/blog/jev-in-production-vs-cross-encoder/) ·
[social graph](https://getunblocked.com/blog/oss-social-graph-builder/) ·
[engineering-social-graph](https://github.com/unblocked/engineering-social-graph) ·
[repo-rules-agent](https://github.com/unblocked/repo-rules-agent)

Graph memory: [Graphiti paper](https://arxiv.org/html/2501.13956v1) ·
[Graphiti #1728](https://github.com/getzep/graphiti/issues/1728) ·
[Cognee conflicts](https://docs.cognee.ai/guides/conflicting-and-outdated-memories) ·
[Mem0 v3 migration](https://github.com/mem0ai/mem0/blob/main/docs/migration/oss-v2-to-v3.mdx) ·
[GraphRAG methods](https://microsoft.github.io/graphrag/index/methods/) ·
[HippoRAG 2](https://arxiv.org/html/2502.14802) ·
[GraphRAG-Bench](https://arxiv.org/abs/2506.05690)

Code: [Aider repo map](https://aider.chat/2023/10/22/repomap.html) ·
[Sourcegraph ranking](https://sourcegraph.com/blog/ranking-in-a-week) ·
[Continue indexing](https://github.com/continuedev/continue/blob/main/core/indexing/README.md) ·
[Cursor regex index](https://cursor.com/blog/fast-regex-search) ·
[Augment context lineage](https://www.augmentcode.com/blog/announcing-context-lineage) ·
[Greptile semantic search](https://www.greptile.com/blog/semantic-codebase-search) ·
[Potpie ontology](https://github.com/potpie-ai/potpie/blob/main/docs/context-graph/ontology.md)

People and rules: [Meta reviewer recommendation](https://arxiv.org/html/2312.17169v2) ·
[Sofia](https://arxiv.org/pdf/2312.17236) ·
[Avelino et al.](https://homepages.dcc.ufmg.br/~mtov/pub/2018-ieeesw.pdf) ·
[Linear GitHub linking](https://linear.app/docs/github) ·
[Gandalf](https://www.usenix.org/system/files/nsdi20spring_li_prepub.pdf) ·
[Greptile noise filter](https://www.greptile.com/blog/make-llms-shut-up) ·
[Bugbot learning](https://cursor.com/blog/bugbot-learning) ·
[AutoCommenter](https://arxiv.org/html/2405.13565v1) ·
[BitsAI-CR](https://arxiv.org/pdf/2501.15134)

Retrieval: [pgvector](https://github.com/pgvector/pgvector) ·
[pg_textsearch](https://github.com/timescale/pg_textsearch) ·
[hybrid search in Postgres](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual) ·
[AI Gateway decision models](https://vercel.com/docs/ai-gateway/modalities/decision) ·
[Voyage rerank-3](https://blog.voyageai.com/2026/09/30/rerank-3/) ·
[UMBRELA](https://arxiv.org/abs/2406.06519)

Storage and sync: [Onyx models](https://github.com/onyx-dot-app/onyx) ·
[Backstage identity resolver](https://github.com/backstage/backstage/blob/master/docs/auth/identity-resolver.md) ·
[Nango self-hosting](https://nango.dev/docs/guides/platform/self-hosting) ·
[GitHub failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) ·
[Linear webhooks](https://linear.app/developers/webhooks) ·
[Notion webhook delivery](https://developers.notion.com/reference/webhooks-events-delivery) ·
[Postgres vs Neo4j benchmark](https://www.pedroalonso.net/blog/graphrag-vs-vector-postgres/)
