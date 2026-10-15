# Session memory: context engine phase 1

> Status: planned, not built. Research and decisions with Jacob on 2026-10-13
> and 2026-10-14. This is phase 1 of [`context-engine.md`](./context-engine.md):
> it fixes the `source` leak, makes sessions findable, makes brain writes safe,
> and adds the general `touch` table with sessions as its first origin. Phase 2
> (default ingestion into `source`) is a decided direction, built later. Code
> facts checked on `dev` at `99d8fb69`; re-check file:line refs before each
> step. Related: [`workspace-model.md`](../workspace-model.md) (sessions),
> [`lor-mvp-spec.md`](../lor-mvp-spec.md) (brain, write-back),
> [`automation-primitives.md`](../automation-primitives.md) (triggers, Remember).

## Goal

Knowledge compounds as a team uses Lor. Later runs, and people, find what past
sessions found, decided and produced. `positioning.md` already claims "Memory
from chat, voice and past sessions" as a built proof point.

## As built (2026-10-14)

Sessions are not a unit anywhere in retrieval. Content from them comes back
only through paths built before sessions existed.

| Path | What reaches it | Gaps |
|---|---|---|
| Brain write-back (`lor-respond.ts:1317`) | Runs after every completed session turn: person turns, loop fires, Act events | Workspace-wide Redis lock skips the turn when held, no retry (`:1302-1315`). Lock TTL 120s, write-back can run 5 min. The salience gate sees only the new delta on continued turns (`:957-959`, `run-continuation.ts:262-272`) and never the seed context. Archive mid-run stops the run, so write-back is skipped. The agent re-reads the full uncompacted transcript every turn (`index.ts:2845`) |
| Lor `search`, `messages` kind (`index.ts:492-535`) | FTS over `message.content`, so session prompts and Lor replies match, archived sessions included | No session id or title in hits. Text is cut to the first 500 characters (`:173,533`), so a match deep in a long reply is invisible to the reranker. The tool description says hits carry "full text" |
| People search (`workspaces/handlers.ts:714-724`) | ILIKE substring over messages, session messages included | No session title search anywhere. ⌘K rows do not say a hit is in a session. Web opens the session but does not scroll to the message (`session-document.tsx` passes no target) |
| `source` (`packages/lor/src/sources.ts`) | One summarized, embedded row per item from a trigger with Remember on (off by default): GitHub PRs, issues, releases; Linear issues; Attio recordings, notes, list entries; your own webhooks | **Leak:** no channel scope; `searchSources`, `fetch_source` and `resolveSourceCitation` filter by workspace only, so a private channel's remembered data is found from any channel (`sources.ts:23-53`; `search` passes the private filter to the other kinds, not this one). Raw content is discarded (`:227`); only a 2 to 4 sentence summary is kept. Upsert never updates `connectionId`. Rows stay searchable after Remember is turned off or the trigger is deleted |
| Attachments | Files uploaded in sessions are indexed (FTS + embedding) | None for this doc |
| Not reachable | Session titles, artifacts, plans, tool results, `agent_run_step` | |

Brain page writes:

- `write` replaces the whole body and bumps `version`. The old body is lost
  (`brain.ts:438-441`). There is no history table.
- Folder and page creation is find-then-insert with no conflict handling
  (`brain.ts:126-154, 448-460`).
- Answer-phase writes (`index.ts:2100-2101`) and project-archive synthesis
  (`project-archive.ts:209-210`) bind the same write tools and never take the
  write-back lock. Concurrent writes already happen.

Tool results (audit 2026-10-14) cannot drive touches through URLs:

- Many tools return no URL (CloudWatch, Datadog, `investigate_code`,
  `fetch_attio_activity`, Lor's own read tools).
- Some nest it or return another item's URL: `propose_code_change` nests the
  PR under `pullRequest`; `comment_linear` returns the comment's URL;
  `export_tool_result` returns the exported file.
- MCP results reach the model as text; `@ai-sdk/mcp` 2.0.5
  `mcpToModelOutput` drops `structuredContent`, which the MCP spec makes
  optional anyway. Custom tools return an untyped body. Nothing reads MCP
  `readOnlyHint`, and the spec says to treat annotations as untrusted.
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
   only when Lor links them in a reply. This gap is accepted.
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

## Phase 1 steps

Build order: Step 1 first (privacy bug). Steps 2 and 4 change existing behavior
with no new tables. Steps 1, 3 and 5 each need a `db:push`. Step 3 removes the
write-back lock only after its per-page checks are in. Each step is about 300
to 400 lines.

### Step 1: scope `source`

[ ] built · [ ] committed · [ ] db:push · [ ] backfill run

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
- Backfill: rows do not record their trigger (`trigger_delivery` has no
  source key). Set `channelId` when all of the connection's Remember triggers
  sit in one channel. Archive rows where that is ambiguous, so the fix fails
  closed.

### Step 2: session-aware search hits

[ ] built · [ ] committed

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
  session title on message hits from sessions. The
  session route takes a target message and `SessionDocument` scrolls to it
  (`useConversationScroll` already supports `targetMessageId`).
- Mobile search results: show the session title.

### Step 3: brain page safety

[ ] built · [ ] committed · [ ] db:push

- Schema: `brain_node_version` (`nodeId`, `version`, `body`, `runId` nullable,
  `createdAt`). Written in the same transaction as every body change.
- `write`: create only. An existing path, or a unique violation from a
  concurrent create, returns "`<path>` already exists. Read it and use edit."
- New `edit(path, oldText, newText)`: in one transaction, read the page and its
  version; `oldText` must appear exactly once; insert the history row; update
  `where version = <read version>`. Zero rows updated returns "The page changed
  since you read it. Read it again." Re-embed after the update.
- `ensureFolderPath`: insert with `on conflict do nothing`, then re-select.
- Remove the write-back lock (`lor-respond.ts:1302-1315`,
  `WRITEBACK_LOCK_TTL`). This also removes the lock-held return that skips
  `runWriter.close()`.
- Tool descriptions change. No new prompt rules: the tool errors teach the
  model.
- Project-archive synthesis and answer-phase writes get `edit` through
  `brainWriteTools` with no extra work.

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
  `linear_issue`, `notion_page`, `attio_record`, `url`. New kinds arrive with
  the tools that touch them (a Linear project tool adds `linear_project`).

**Stable keys.** Each provider declares its keys and a URL parser in
`@repo/connectors`, exhaustive per provider like `CONNECTORS`:

- GitHub: `owner/repo#n`, lowercased; repos `owner/repo`. Matches
  `source.externalId`.
- Linear: the identifier (`LOR-123`). Every Linear tool result carries it
  (`create_linear_issue` and `update_linear_issue` return no UUID), it matches
  `source.externalId`, and it is what people type. A team move changes it, so
  old and new keys do not join; accepted.
- Notion: the page id without dashes.
- Attio: the record id.
- Lor-native: message, call and artifact ids; brain pages by node id
  (resolve the path when the touch is written; show the current path when
  read).

**Writers.** After each run persists:

- Built-in tools: one `TouchSpec` per tool, a pure function from the tool's
  input and typed result (saved in `agent_run_step`) to touches, each with its
  `action`. Specs live in one map typed as exhaustive over the built-in tool
  names, so a new tool does not compile until it has a spec or an explicit
  `null`. The spec sets `action` itself: `SIDE_EFFECT_TOOLS` is not a read or
  write signal (`investigate_code` is in it for billing replay but only
  reads).
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
- `adding-a-connector.md`: add the provider key, URL parser and per-tool
  `TouchSpec` to the checklist.

## Phase 2: default ingestion (decided direction, not scheduled)

Decided with Jacob on 2026-10-14. Builds on `context-engine.md` §5.3 and §5.5.

- Ingest connected systems into `source` by default: backfill, webhooks as a
  signal to refetch, a reconcile sweep, tombstones for deletes.
- Store the real text: title and body, indexed with FTS and embeddings over
  chunks. No per-item summary call. Raw text beat summaries as a retrieval key
  in the research below.
- Scope every row to its container's audience. Private repos and private
  Linear teams follow the access modes in `context-engine.md` §5.5; the
  default mode is still open.
- Remove Remember: the trigger toggle, `rememberHint`, the API and
  change-proposal fields, and the "Remember" copy. Connector event cards stay
  `excludedFromMemory` because the item lives in `source`.
- Do not ingest your own webhooks. The posted chat message is the record and
  stays in message search. Existing webhook `source` rows go with Remember; a
  webhook that had Remember on and Post off loses recall.
- Reverses two locked decisions in `github-connector.md`: "No embedding by
  default" and "Webhooks not needed". Record the reversal there when phase 2
  starts.

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
  tools, `index.ts:2100-2101`), and §6's "stored summaries are
  workspace-visible (accepted, since all channels are public-to-workspace)"
  is no longer true.
- `automation-primitives.md` §2 says Attio transcripts are live-fetched; the
  code returns only the stored summary for Attio.
