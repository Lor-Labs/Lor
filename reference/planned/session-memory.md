# Session memory: context engine phase 1

> Status: planned, not built. Research and decisions with Jacob on 2026-10-13
> and 2026-10-14. This is phase 1 of [`context-engine.md`](./context-engine.md):
> it fixes the `source` leak, makes sessions findable, makes brain writes safe,
> and adds the general `touch` table with sessions as its first origin. Phase 2
> (default ingestion into `source`) is a decided direction, built later. Code
> facts checked on `dev` at `99d8fb69`, rechecked at `9b011db5` on 2026-10-16
> after per-tool approvals, profile tool access and the connector tool catalog
> (`connector-tools.md`) landed; re-check file:line refs before each step.
> Related: [`workspace-model.md`](../workspace-model.md) (sessions),
> [`lor-mvp-spec.md`](../lor-mvp-spec.md) (brain, write-back),
> [`automation-primitives.md`](../automation-primitives.md) (triggers, Remember).

## Goal

Knowledge compounds as a team uses Lor. Later runs, and people, find what past
sessions found, decided and produced. `positioning.md` already claims "Memory
from chat, voice and past sessions" as a built proof point.

## As built (rechecked 2026-10-16)

Sessions are not a unit anywhere in retrieval. Content from them comes back
only through paths built before sessions existed.

| Path | What reaches it | Gaps |
|---|---|---|
| Brain write-back (`lor-respond.ts:1317`) | Runs after every completed session turn: person turns, loop fires, Act events | Workspace-wide Redis lock skips the turn when held, no retry (`:1302-1315`). Lock TTL 120s, write-back can run 5 min. The salience gate sees only the new delta on continued turns (`:957-959`, `run-continuation.ts:262-272`) and never the seed context. Archive mid-run stops the run, so write-back is skipped. The agent re-reads the full uncompacted transcript every turn (`index.ts:3062`) |
| Lor `search`, `messages` kind (`index.ts:512-555`) | FTS over `message.content`, so session prompts and Lor replies match, archived sessions included | No session id or title in hits. Text is cut to the first 500 characters (`:191,553`), so a match deep in a long reply is invisible to the reranker. The tool description says hits carry "full text" (`:749`) |
| People search (`workspaces/handlers.ts:714-724`) | ILIKE substring over messages, session messages included | No session title search anywhere. ⌘K rows do not say a hit is in a session. (Web hits already open the session at the matched message, `?msgId`, since `fa404cb4`) |
| `source` (`packages/lor/src/sources.ts`) | One summarized, embedded row per item from a trigger with Remember on (off by default): GitHub PRs, issues, releases; Linear issues; Attio recordings, notes, list entries; your own webhooks. Notion and Better Stack have no events | **Leak:** no channel scope; `searchSources`, `fetchSourceContent` and `resolveSourceCitation` filter by workspace only, so a private channel's remembered data is found from any channel (`sources.ts:23-53, 111-118, 155-162`; `search` passes the private filter to the other kinds, not this one). Raw content is discarded (`:234`); only a 2 to 4 sentence summary is kept. Upsert never updates `connectionId`. Rows stay searchable after Remember is turned off or the trigger is deleted. `fetch_source` returns the stored summary only (`:72-82`): live reads go through enabled connector tools so profile and approval gates apply. The `search` description and system prompt still promise the full body from it (`index.ts:204, 749`) |
| Attachments | Files uploaded in sessions are indexed (FTS + embedding) | None for this doc |
| Not reachable | Session titles, artifacts, plans, tool results, `agent_run_step` | |

Brain page writes:

- `write` replaces the whole body and bumps `version`. The old body is lost
  (`brain.ts:439-445`). There is no history table.
- Folder and page creation is find-then-insert with no conflict handling
  (`brain.ts:126-154, 448-461`).
- Answer-phase writes (`index.ts:2232-2233`) and project-archive synthesis
  (`project-archive.ts:207-208`) bind the same write tools and never take the
  write-back lock. Concurrent writes already happen. Archive synthesis now
  drops approval-gated catalog tools, but brain tools are core and always bind.

Tool results (audit 2026-10-14) cannot drive touches through URLs:

- Many tools return no URL (CloudWatch, Datadog, `investigate_code`,
  `fetch_attio_activity`, Lor's own read tools).
- Some nest it or return another item's URL: `propose_code_change` nests the
  PR under `pullRequest`; `comment_linear` returns the comment's URL;
  `export_tool_result` returns the exported file.
- MCP results reach the model as text; `@ai-sdk/mcp` 2.0.5
  `mcpToModelOutput` drops `structuredContent`, which the MCP spec makes
  optional anyway. This includes Better Stack's 16 built-in tools, which run
  through its hosted MCP: typed inputs, untyped results. Custom tools return
  an untyped body.
- Workspace MCP `readOnlyHint` is now cached in `mcp_server.tool_metadata`
  for display only, as a provider declaration; the spec says to treat
  annotations as untrusted. Built-in connector tools carry a reviewed
  `readOnlyHint` in `CONNECTOR_TOOLS` (`packages/connectors/src/tools.ts`).
- URLs are poor keys: one GitHub PR appears as `/pull/n`, `/issues/n`, mixed
  case or `api.github.com/...`; Linear and Notion URLs carry title slugs; a
  Linear team move changes the identifier.

## Locked decisions (Jacob, 2026-10-14)

1. **Deterministic first.** A `touch` row records that a piece of work read,
   wrote, cited, started from or mentioned a thing. No model call.
2. **Fix the `source` leak in this phase.**
3. **The item table keeps the name `source`.** It grows into the context
   engine's item table in phase 2. `artifact` stays the name for session
   deliverables.
4. **One general table, `touch`.** Sessions are its first origin. Messages,
   sources and brain pages become origins in later phases. Named 2026-10-15;
   `item_ref` was too vague, and "related" belongs to typed edges.
5. **`kind` and `action` are pgEnums.** A new kind is an enum value plus a
   `db:push`.
6. **Touches come from data we control, not URLs:** a spec per built-in tool,
   provider keys in `@repo/connectors`, verified citations, reply links checked
   against the run's tool results, seed context, and identifiers people type.
   MCP and custom tools get no touches of their own; their items are covered
   only when Lor links them in a reply. This gap is accepted. For connector
   tools, read vs wrote comes from the reviewed `readOnlyHint` in
   `CONNECTOR_TOOLS` (added 2026-10-16).
7. **People come through a join, not touch rows.** Session starter
   (`agent_session.creatorId`), message authors and subscribers
   (`thread_subscription`) already record them. They feed the context engine
   as a hidden ranking signal and "people who worked on this" links, never
   scores (`context-engine.md` §5.6).
8. **Reverse hints.** A built-in read tool's result lists the earlier sessions
   that touched the same item: titles, dates and `action` only.
9. **No workspace-wide write-back lock.** Concurrency control is per page.
   Creating a page fails if the path exists. `edit` is a compare-and-swap on
   `version`. Accepted trade-off: parallel write-backs cannot see each other's
   new pages, so near-duplicate pages at different paths can happen.
   Same-path collisions cannot. Version history makes mistakes recoverable.
10. **`write` creates pages only.** On an existing page it returns an error
    that tells the model to use `edit`. Enforced in code, not in the prompt.
11. **Every page update keeps the previous body.**
12. **No session summaries or outcome items for now.** See Deferred.
13. **No embeddings of session turns for now.** See Deferred.
14. **Phase 2 direction:** ingest connected systems into `source` by default,
    store the real text, remove Remember, and do not ingest your own webhooks.
    See Phase 2.
15. **Better Stack touches cover incidents and errors only** (2026-10-16),
    keyed from tool inputs. Its other tools (lists, query help, logs) get none.
16. **A write touch needs a confirmed success** (2026-10-16). Notion and Attio
    writes that return `outcome: "unknown"` or `"failed"` record nothing.

## Permission rules (Jacob, 2026-10-16)

Clear boundaries, no new settings. Every read path (stored search, live tool
calls, citations, reverse hints) follows the same rules.

1. **Lor's own data follows its channel.** Chat, sessions, files and brain
   pages from a private channel stay in that channel (`privateAudienceFilter`,
   brain memory scope). Built.
2. **Stored connector data follows the channel it came from.** A remembered
   `source` row keeps its trigger's channel (Step 1).
3. **Connecting a service shares what it can see with the whole workspace.**
   This covers live tool calls today and phase 2 ingestion. The boundary is
   chosen when connecting: the repos the GitHub app is installed on, the
   Notion pages shared with the integration, and so on. If a connection can
   see a private repo or a private Linear team, everyone in the workspace can
   reach it through Lor; that is already true of live tools. To limit it,
   connect less. There is no per-connection visibility setting.
4. **What Lor writes from private data stays private.** A brain page written
   in a private channel stays scoped to it. Built through the brain memory
   scope; phase 2 adds provenance (`brain_node_input` in `context-engine.md`)
   for pages built from ingested items.
5. **Tool access only decides what Lor can do.** Profile `toolAccess` and
   workspace tool selections choose which tools bind. They never hide data
   that the channel's people can already see. Approvals stay a separate gate
   on actions.

## Phase 1 steps

Build order: Step 1 first (privacy bug). Steps 2 and 4 change existing behavior
with no new tables. Steps 1, 3 and 5 each need a `db:push`. Step 3 removes the
write-back lock only after its per-page checks are in. Each step is about 300
to 400 lines.

### Step 1: scope `source`

[x] built 2026-10-16 · [ ] committed · [ ] db:push · [ ] backfill run

As built (~190 lines): `visibleSource()` in `sources.ts` holds the shared
filter; `searchSources`, `fetchSourceContent` and `resolveSourceCitation`
take `privateContainerChannelId`. `groundCitations` takes the run scope, and
the worker resolves it once per reply (falls back to public-only). Search
results drop `hasMore`. Backfill: `packages/db/src/scripts/backfill-source-channels.ts`,
run after `db:push` with `--dry-run` first (command in its header).

- Schema: `source.channelId`, the channel of the trigger that stored the row
  (FK, cascade: deleting the channel deletes its remembered rows).
- Ingest: set `channelId` from the trigger. The upsert also updates
  `connectionId` and `channelId`; when two triggers remember the same item,
  the last one's channel wins.
- Readers: join `channel` and apply `privateAudienceFilter` in
  `searchSources`, `fetchSourceContent` / `fetch_source` and
  `resolveSourceCitation`, the same filter messages use. The audience is read
  at query time, so a channel made private later hides its rows. Pass
  `privateContainerChannelId` through `search`, `fetch_source` and citation
  grounding. Rows without a channel never match.
- `fetch_source` is summary-only. Fix the `search` description and system
  prompt that promise the full body from it (`index.ts:204, 749`). The live
  path in `fetchSourceContent` has no caller; leave it for phase 2's refetch.
- Backfill: rows do not record their trigger (`trigger_delivery` has no
  source key). Set `channelId` when all of the connection's Remember triggers
  sit in one channel. Archive rows where that is ambiguous, so the fix fails
  closed.

### Step 2: session-aware search hits

[x] built 2026-10-16 · [ ] committed

As built (~195 lines): Lor's `searchMessages` ranks in a subquery, then runs
`ts_headline` on the pool only: messages over 500 characters return their
matched passages (matched words in `**bold**`, since Postgres does not
document an empty highlight marker) with `truncated: true`. Hits and
`read_thread` carry `sessionTitle`. The API returns `sessionId` /
`sessionTitle` on message hits and up to 5 title-matched `sessions` on page 1,
archived included. Web ⌘K and header search pass `sessionId` straight to
navigation, skipping the location lookup. Mobile shows the title on message
hits, and channel search labels session hits with the title instead of
"In thread"; mobile has no Sessions group yet.

- `searchMessages`: join `agent_session` on the thread root; return
  `sessionId` and `sessionTitle`. Replace `slice(0, 500)` with a window around
  the match (`ts_headline` over the pool rows only; it re-parses the document,
  so never run it over the whole table). Make the `search` description match
  what comes back.
- `read_thread`: return the session title when the root is a session anchor.
- `apps/api` workspace search: add `sessionId` and `sessionTitle` to message
  results, and a separate `sessions` array for sessions whose title matches
  (same channel access rule).
- Web ⌘K: a Sessions group above Messages. ⌘K and header search show the
  session title on message hits from sessions.
- Mobile search results: show the session title.
- Already done (`fa404cb4`): web search hits open the session at the matched
  message (`?msgId`).

### Step 3: brain page safety

[x] 3a built 2026-10-16 · [ ] 3b built · [ ] committed · [ ] db:push

Split in two. 3a (~265 lines): `brain_node_version`, create-only `writePage`,
`editPage` (history row and compare-and-swap in one transaction; a lost race,
whether a 0-row update or the history unique key, returns "changed since you
read it"), race-safe `ensureFolderPath`, the `edit` tool (replay set, reserved
names, trail label), prompt lines that name the brain tools, and the write-back
lock removed. Answer-phase edits record the run id; write-back and archive
synthesis record none. 3b: the scope-aware unique key and path lookup, and
scoped citation checks (the last bullet below).

- Schema: `brain_node_version` (`nodeId`, `version`, `body`, `runId` nullable,
  `createdAt`). Written in the same transaction as every body change.
- `write`: create only. An existing path, or a unique violation from a
  concurrent create, returns "`<path>` already exists. Read it and use edit."
- New `edit(path, oldText, newText)`: in one transaction, read the page and its
  version; `oldText` must appear exactly once; insert the history row; update
  `where version = <read version>`. If zero rows are updated, roll back the
  transaction (including the history insert) before returning "The page changed
  since you read it. Read it again." Re-embed only after the transaction commits.
- `edit` uses the same `oldText` / `newText` convention as
  `edit_notion_content`. Add it to `SIDE_EFFECT_TOOLS` (replay; bulk export
  derives its deny list from that set, `export-tool.ts:13`) and to
  `RESERVED_TOOL_NAMES` (`custom-tools.ts:20`). No approval wiring: core
  memory tools are never gateable (`approval-targets.ts`).
- `ensureFolderPath`: insert with `on conflict do nothing`, then re-select.
- Two scope bugs from `context-engine.md` §6, folded in 2026-10-16: citation
  checks call `pageExists` without the run's memory scope (`index.ts:3155`;
  widen the `groundCitations` scope from Step 1), and the unique key
  `brain_node_parent_name_uq` ignores `scopeChannelId`, so a scoped
  `/projects` folder can collide with the workspace one (`brain.ts:68`).
- Remove the write-back lock (`lor-respond.ts:1302-1315`,
  `WRITEBACK_LOCK_TTL`). This also removes the lock-held return that skips
  `runWriter.close()`.
- Tool descriptions change. No new prompt rules: the tool errors teach the
  model.
- Project-archive synthesis and answer-phase writes get `edit` through
  `brainWriteTools` with no extra work.
- Check: the long-task eval (`packages/lor/src/eval/long`, `sessionTasks`)
  already corrects brain pages across turns (`billing-follow-ups`). Jacob runs
  it after Steps 3 and 4 to see that Lor uses `edit` and pages keep earlier
  facts.

### Step 4: write-back sees the session

[ ] built · [ ] committed

- Gate input on continued turns: session title, seed context
  (`agent_session_context`), earlier human turns under a token cap, then the
  latest exchange. Today it is the delta only.
- Archive stop: run write-back on the completed part when the stop came from
  an archive, not from a person pressing Stop. Check how `requestRunStop`
  (`apps/api/src/routes/v1/runs/handlers.ts:304`) can carry that reason.
- Write-back transcript: pass the compacted projection, not the raw
  `priorMessages`.

### Step 5: touches and reverse hints

[ ] built · [ ] committed · [ ] db:push · [ ] backfill run

**Schema.** `touch`:

- `id`, `workspaceId`, `createdAt`.
- Origin: `sessionId` (FK cascade) and `runId` (nullable). Later phases add
  `messageId`, `sourceId` and `brainNodeId` origin columns with an
  exactly-one check.
- Target: `kind` (pgEnum) and `value` (the stable key). `value` is text, not
  an FK: a target can be deleted or never ingested, and readers skip targets
  that no longer resolve.
- `action` (pgEnum): `read`, `wrote`, `cited`, `started_from`, `mentioned`.
- Unique `(sessionId, kind, value, action)`. Btree `(workspaceId, kind, value)`.
- Starting kinds, fixed when built: `message`, `call`, `brain_page`,
  `artifact`, `source`, `github_repo`, `github_pr`, `github_issue`,
  `linear_issue`, `notion_page`, `attio_record`, `attio_list_entry`,
  `attio_task`, `betterstack_incident`, `betterstack_error`, `url`. New kinds
  arrive with the tools that touch them (a Linear project tool adds
  `linear_project`).
- Comments and notes count as writes to their parent: `comment_linear` to the
  issue, `add_notion_comment` on a page to the page, `create_attio_note` to
  the record. A Notion discussion reply carries no page key and records
  nothing.

**Stable keys.** Each provider declares its keys and a URL parser in
`@repo/connectors`, exhaustive per provider like `CONNECTORS`. The URL parsers
start from the per-provider `urlHost` regexes in
`apps/web/src/lib/connector-ui.tsx`, moved so web and server share them.

- GitHub: `owner/repo#n`, lowercased; repos `owner/repo`. `source.externalId`
  keeps GitHub's original case (`github/events.ts`), so compare
  case-insensitively until phase 2 lowercases it at ingest.
- Linear: the identifier (`LOR-123`): what people type and what
  `source.externalId` uses. Take it from the result where there is one.
  `create_linear_issue` can return null, and `comment_linear` /
  `update_linear_issue` accept a UUID or an identifier as input. When only a
  UUID is available, record nothing; no extra API call. A team move changes
  the identifier, so old and new keys do not join; accepted.
- Notion: the page id without dashes. The write tools take dashed ids, so
  normalize.
- Attio: record, list entry and task ids for their kinds. Attio `source` rows
  are keyed `note#id`, `list_entry#id` and `call_recording#id`, so they never
  join record keys; accepted.
- Better Stack: incident and error ids from the tool inputs.
- Lor-native: message, call and artifact ids; brain pages by node id
  (resolve the path when the touch is written; show the current path when
  read).

**Writers.** After each run persists:

- Built-in tools: one `TouchSpec` per tool, a pure function from the tool's
  input and result (saved in `agent_run_step`) to touches.
  - `action`: connector tools take it from the reviewed `readOnlyHint` in
    `CONNECTOR_TOOLS` (true is `read`, false is `wrote`). Core Lor tools
    (brain, `read_thread`, `read_call`, `search`, plans) set it in their spec.
    `SIDE_EFFECT_TOOLS` is not a read or write signal: `investigate_code` is in
    it for billing replay, and the catalog marks it read-only.
  - Compiler reminder: declare `CONNECTOR_TOOLS` with `as const satisfies`,
    like `STANDALONE_TOOLS`, so its tool names form a literal union. The
    `TouchSpec` map is keyed by that union plus the core tool names. The
    connector runbook already requires every new tool in `CONNECTOR_TOOLS`,
    so a new catalog tool does not compile until it has a spec or an explicit
    `null`.
  - Writes need a confirmed success (decision 16). A guard receipt with
    `outcome: "completed"` (the write succeeded but its output was too large)
    counts, with keys from the input.
  - Better Stack incident and error tools key from their inputs, because
    their results are untyped MCP text. Other Better Stack tools, Datadog,
    CloudWatch, workspace MCP and custom tools map to `null`.
- Verified citations in the final reply (`citations.ts` grammar): `cited`.
- Markdown links in the final reply: parse with the provider URL parsers;
  record `cited` only if the item appeared in a tool result during the run.
  Links to unknown hosts become `url` touches (normalized: lowercase host, no
  fragment), under the same check. This is how MCP, custom and web items get
  touches.
- `agent_session_context` at session start: `started_from`.
- Identifiers people type in session prompts (`context-engine.md` §5.4 rules,
  with the workspace's real Linear team keys): `mentioned`.

**Readers.**

- `search`: identifiers in the query find the sessions that touched them,
  ranked `wrote` > `cited` > `read` > `mentioned`, then recency.
  Hits come back as a `session` kind with title, channel, date and `action`.
  Same audience filter as messages.
- Reverse hints: the tool wrapper runs the `TouchSpec` as the tool returns.
  When it yields a `read` touch, the result gains one line listing up to 3
  earlier sessions that touched the same item (title, date, `action`),
  audience-filtered, excluding the current session. Touch rows themselves are
  written after the run persists.
  Titles and ids only. This is not the removed brain prefetch: nothing is
  preloaded into the prompt.
- People: a join from `touch` to session starter, message authors and
  subscribers, for the context engine's ranking. No UI.

**Also.**

- One-off backfill from `agent_run_step` and session messages.
- `adding-a-connector.md` and `connector-tools.md`: add the provider key, URL
  parser and per-tool `TouchSpec` next to the existing "add it to
  `CONNECTOR_TOOLS`" rule.

## Phase 2: default ingestion (decided direction, not scheduled)

Decided with Jacob on 2026-10-14. Builds on `context-engine.md` §5.3 and §5.5.

- Ingest connected systems into `source` by default: backfill, webhooks as a
  signal to refetch, a reconcile sweep, tombstones for deletes.
- Store the real text: title and body, indexed with FTS and embeddings over
  chunks. No per-item summary call. Raw text beat summaries as a retrieval key
  in the research below.
- Visibility follows the permission rules above: ingested rows are
  workspace-visible (rule 3); remembered rows keep their channel (rule 2).
  No connection access modes (`context-engine.md` §5.5 is superseded).
- Remove Remember: the trigger toggle, `rememberHint`, the API and
  change-proposal fields, and the "Remember" copy. Connector event cards stay
  `excludedFromMemory` because the item lives in `source`.
- Do not ingest your own webhooks. The posted chat message is the record and
  stays in message search. Existing webhook `source` rows go with Remember; a
  webhook that had Remember on and Post off loses recall.
- Reverses two locked decisions in `github-connector.md`: "No embedding by
  default" and "Webhooks not needed". Record the reversal there when phase 2
  starts.
- `fetch_source` stays stored-only (the tool-access rule: live reads go
  through enabled connector tools). With real text stored, it returns the
  body.
- Tool access vs stored items (decided 2026-10-16, rule 5): a channel with
  Linear off can still find ingested Linear items through `search`. Turning a
  connector off stops Lor using it there; it does not hide data. This matches
  `connector-tools.md` ("stored-source visibility remain[s] separate from tool
  access").

## Deferred

### Session outcome items

A session-end pass (on archive, or after idle) where one small-model call
writes short structured items (decisions, findings, open questions, outputs),
each citing the messages it came from, indexed as extra search keys.

Deferred by Jacob on 2026-10-14:

- It reads as surveillance: a written record of each person's work session.
- It costs a model call per session, and its value is unproven.
- Deterministic links had the strongest evidence.

Evidence both ways: a well-chosen summary raised SWE Context Bench resolution
from 26.26% to 34.34%, but summaries the agent picked itself dropped it to
22.22%. In LongMemEval a summary used as the key scored 0.572 recall@5 against
0.706 for raw text.

Reopen when the eval shows decision or finding questions that phase 1 misses.
If reopened: items sit next to the raw messages, never replace them; every
item cites message ids; a processed-up-to marker on the session; items are
appended, never rewritten.

### Session turn embeddings

Embedding human prompts and Lor replies one by one.

Deferred by Jacob on 2026-10-14:

- Raw agent transcripts used as memory mostly hurt coding agents
  (VibeMemBench: 11 of 12 pairings did not beat memory-off; harm comes from
  transcript volume).
- Neural retrievers and rerankers favour LLM-written text, so embedded Lor
  replies could push human messages down. That study used 2023-era models.
- No study tests long agent replies on top of an existing FTS index.
- FTS already covers "what did Lor say" questions.

Reopen when the eval shows paraphrase recall that FTS plus phase 1 misses, and
agent-written items do not take more of the top-k than their share of the
corpus.

## Eval (reopen trigger for both deferrals)

Reuses the judged pool in `context-engine.md` §5.11.

- 100 to 200 real questions with gold session and message ids. A model may
  draft them from real sessions; a person checks every one.
- Tags: decision or finding; paraphrase with no shared keywords; exact
  identifier; what Lor said vs what a person said.
- Conditions: FTS; + Step 2; + Step 5; + outcome items; + turn embeddings
  (human prompts only, then agent-reply chunks). Each under RRF and the
  reranker.
- Measures: recall@5 and @10 at session and message level; gold hits found
  only by one condition; share of agent-written items in the top-k against
  their share of the corpus; answer accuracy with a fixed reader; correct
  abstention; injected tokens and write cost.

## Evidence

Research pass 2026-10-14. Rows marked ✓ were checked against the primary
source in this session; the rest come from the research pass's reading.

| Source | Finding | Used for |
|---|---|---|
| ✓ [LongMemEval](https://arxiv.org/html/2410.10813v2) (ICLR 2025) | Session recall@5 by key: raw 0.706, summary 0.572, fact 0.642, raw + fact 0.732, raw + summary 0.689. Keys kept user-side utterances only | Deferred outcome items; phase 2 stores real text |
| ✓ [SWE Context Bench](https://arxiv.org/html/2602.08316v3) | Claude Sonnet 4.5: no context 26.26%, oracle trajectory 27.27%, oracle summary 34.34%, agent-picked summary 22.22% | Wrong memory is worse than none; gate retrieval |
| ✓ [VibeMemBench](https://arxiv.org/html/2609.23570v1) | 11 of 12 memory-system pairings did not beat memory-off; harm from transcript volume; directory or identifier anchors helped in 55.2% of 58 pairings with no losses | Decisions 1 and 6; turn embeddings deferred |
| [Dai et al.](https://arxiv.org/html/2310.20501) (KDD 2024) | Neural retrievers and rerankers favour LLM-written text; BM25 favours human text | Turn embeddings deferred |
| [Mem0 v3](https://docs.mem0.ai/migration/oss-v2-to-v3) | Moved to add-only: "Overwrites sometimes erased key information"; dropped external graph stores | Decisions 10 and 11 |
| [ACE](https://arxiv.org/html/2510.04618) | Full context rewrite collapsed 18,282 tokens to 122; accuracy 66.7% to 57.1% | Decisions 10 and 11 |
| [Han et al.](https://arxiv.org/html/2502.11371v3) | LLM-built knowledge graphs held about 65% of answer entities | Decision 1 |
| [GitHub Copilot memory](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/) | Stores fact + citations in-task; verifies citations before use; rejected offline curation | Read-time verification; timing |
| [Claude memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) | Past-chat search is RAG over raw chats as a tool; memory saved while chatting | Timing |
| [MCP tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | `structuredContent` and `outputSchema` optional; annotations untrusted unless the server is trusted | Decision 6 |

Not verified: OpenAI "Dreaming" numbers, why Cursor removed Memories, the
models behind Mem0 v3's benchmark scores.

## Notes for other docs

- `workspace-model-runbook.md:1579-1584` still lists search results as open;
  `session-files-runbook.md` Step 1 closed it.
- `lor-mvp-spec.md`: the answer loop is not read-only (it binds brain write
  tools, `index.ts:2232-2233`; the spec's "Answer tools (read-only)" is at
  `:94`). §6 (`:131`) is wrong twice: "stored summaries are workspace-visible
  (accepted, since all channels are public-to-workspace)", and "full content
  live-fetched on demand", which no provider does any more.
- `automation-primitives.md` §2 (`:91-94`) says Attio transcripts are
  live-fetched; `fetch_source` now returns the stored summary for every
  provider.
- Profile tool editor copy (web and mobile): say that Off stops Lor using
  these tools in the channel. It must not suggest that Off hides data (rule 5).
- Attio loopback (unverified): Lor's new `create_attio_note` and
  `create_attio_list_entry` match the Attio `note_created` and
  `list_entry_created` events. If Attio sends webhooks for API-created
  changes, Lor's own writes come back through triggers, Remember or Act.
  Check during the Attio rollout (`connector-tools.md`).
