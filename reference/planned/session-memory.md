# Session memory: what Lor keeps from sessions

> Status: planned, not built. Research and decisions with Jacob on 2026-10-13
> and 2026-10-14. Code facts checked on `dev` at `99d8fb69`; re-check file:line
> refs before each step. Related: [`context-engine.md`](./context-engine.md)
> (deterministic edges, eval), [`workspace-model.md`](../workspace-model.md)
> (sessions), [`lor-mvp-spec.md`](../lor-mvp-spec.md) (brain, write-back).

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

## Locked decisions (Jacob, 2026-10-14)

1. **Deterministic first.** Session memory starts with refs to what a session
   touched. No model call.
2. **No workspace-wide write-back lock.** Concurrency control is per page.
   Creating a page fails if the path exists. `edit` is a compare-and-swap on
   `version`. Accepted trade-off: parallel write-backs cannot see each other's
   new pages, so near-duplicate pages at different paths can happen. Same-path
   collisions cannot. Version history makes mistakes recoverable.
3. **`write` creates pages only.** On an existing page it returns an error that
   tells the model to use `edit`. Enforced in code, not in the prompt.
4. **Every page update keeps the previous body.**
5. **No session summaries or outcome items for now.** See Deferred.
6. **No embeddings of session turns for now.** See Deferred.

## Steps

Build order: Step 1 and Step 3 change existing behavior with no new tables.
Step 2 and Step 4 each need a `db:push`. Step 2 must land before the lock is
removed. Each step is about 300 to 400 lines.

### Step 1: session-aware search hits

[ ] built · [ ] committed

- `packages/lor/src/index.ts` `searchMessages`: join `agent_session` on the
  thread root; return `sessionId` and `sessionTitle`. Replace `slice(0, 500)`
  with a window around the match (`ts_headline` over the pool rows only; it
  re-parses the document, so never run it over the whole table). Make the
  `search` description match what comes back.
- `read_thread`: return the session title when the root is a session anchor.
- `apps/api` workspace search: add `sessionId` and `sessionTitle` to results;
  match `agent_session.title` too.
- Web ⌘K and header search: show the session title on session hits. The
  session route takes a target message and `SessionDocument` scrolls to it
  (`useConversationScroll` already supports `targetMessageId`).
- Mobile search results: show the session title.

### Step 2: brain page safety

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
- Remove the write-back lock (`lor-respond.ts:1302-1315`, `WRITEBACK_LOCK_TTL`).
  This also removes the lock-held return that skips `runWriter.close()`.
- Tool descriptions change. No new prompt rules: the tool errors teach the
  model.
- Project-archive synthesis and answer-phase writes get `edit` through
  `brainWriteTools` with no extra work.

### Step 3: write-back sees the session

[ ] built · [ ] committed

- Gate input on continued turns: session title, seed context
  (`agent_session_context`), earlier human turns under a token cap, then the
  latest exchange. Today it is the delta only.
- Archive stop: run write-back on the completed part when the stop came from
  an archive, not from a person pressing Stop. Check how `requestRunStop`
  (`apps/api/src/routes/v1/runs/handlers.ts:304`) can carry that reason.
- Write-back transcript: pass the compacted projection, not the raw
  `priorMessages`.

### Step 4: session refs

[ ] built · [ ] committed · [ ] db:push · [ ] backfill run

- Schema: `session_ref` (`workspaceId`, `sessionId` FK cascade, `runId` and
  `messageId` nullable, `kind`, `value`, `how`, `createdAt`). Unique
  `(sessionId, kind, value, how)`; btree `(workspaceId, kind, value)`. Same
  shape as `artifact_ref` in `context-engine.md` §5.2 so it can merge later.
- `how`: `read`, `wrote`, `cited`, `seeded`, `mentioned`.
- Writers, after each run persists:
  - Tool calls in this run's `agent_run_step` rows, one small extractor per
    tool. Examples: `fetch_linear` → read; `create_linear_issue`,
    `update_linear_issue`, `comment_linear` → wrote; `fetch_github` → read;
    `propose_code_change` → wrote; `fetch_source`, `read_call`, `read_thread`
    → read; `create_artifacts` → wrote; brain `read` / `write` / `edit` →
    read / wrote.
  - Verified citations in the final reply (`citations.ts` grammar) → cited.
  - `agent_session_context` at session start → seeded.
  - Identifiers in human prompts (`context-engine.md` §5.4 regex with the
    workspace's real Linear team keys) → mentioned.
- Reader: identifiers in a `search` query look up sessions that touched them,
  ranked `wrote` > `cited` > `read` > `mentioned`, then recency. Hits come back
  as a `session` kind with title, channel, date and `how`. Same audience filter
  as messages (`privateAudienceFilter`).
- One-off backfill from `agent_run_step` and session messages.
- Open: person refs ("who worked on this") stay out until the context engine
  settles its surveillance line (§5.6).

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

Reopen when the eval shows decision or finding questions that Steps 1 to 4
miss. If reopened: items sit next to the raw messages, never replace them;
every item cites message ids; a processed-up-to marker on the session; items
are appended, never rewritten.

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

Reopen when the eval shows paraphrase recall that FTS plus Steps 1 to 4 miss,
and agent-written items do not take more of the top-k than their share of the
corpus.

## Eval (reopen trigger for both deferrals)

Reuses the judged pool in `context-engine.md` §5.11.

- 100 to 200 real questions with gold session and message ids. A model may
  draft them from real sessions; a person checks every one.
- Tags: decision or finding; paraphrase with no shared keywords; exact
  identifier; what Lor said vs what a person said.
- Conditions: FTS; + Step 1; + Step 4; + outcome items; + turn embeddings
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
| ✓ [LongMemEval](https://arxiv.org/html/2410.10813v2) (ICLR 2025) | Session recall@5 by key: raw 0.706, summary 0.572, fact 0.642, raw + fact 0.732, raw + summary 0.689. Keys kept user-side utterances only | Deferred outcome items; never replace raw text |
| ✓ [SWE Context Bench](https://arxiv.org/html/2602.08316v3) | Claude Sonnet 4.5: no context 26.26%, oracle trajectory 27.27%, oracle summary 34.34%, agent-picked summary 22.22% | Wrong memory is worse than none; gate retrieval |
| ✓ [VibeMemBench](https://arxiv.org/html/2609.23570v1) | 11 of 12 memory-system pairings did not beat memory-off; harm from transcript volume; directory or identifier anchors helped in 55.2% of 58 pairings with no losses | Decision 1; turn embeddings deferred |
| [Dai et al.](https://arxiv.org/html/2310.20501) (KDD 2024) | Neural retrievers and rerankers favour LLM-written text; BM25 favours human text | Turn embeddings deferred |
| [Mem0 v3](https://docs.mem0.ai/migration/oss-v2-to-v3) | Moved to add-only: "Overwrites sometimes erased key information"; dropped external graph stores | Decisions 3 and 4 |
| [ACE](https://arxiv.org/html/2510.04618) | Full context rewrite collapsed 18,282 tokens to 122; accuracy 66.7% to 57.1% | Decisions 3 and 4 |
| [Han et al.](https://arxiv.org/html/2502.11371v3) | LLM-built knowledge graphs held about 65% of answer entities | Decision 1 |
| [GitHub Copilot memory](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/) | Stores fact + citations in-task; verifies citations before use; rejected offline curation | Read-time verification; timing |
| [Claude memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) | Past-chat search is RAG over raw chats as a tool; memory saved while chatting | Timing |

Not verified: OpenAI "Dreaming" numbers, why Cursor removed Memories, the
models behind Mem0 v3's benchmark scores.

## Notes for other docs

- `context-engine.md` §5.2: the proposed `artifact` table collides with the
  existing `artifact` table (`packages/db/src/schemas/artifacts.ts:30`).
  `artifact_ref` has no session or run column. §3 omits sessions.
- `workspace-model-runbook.md:1579-1584` still lists search results as open;
  `session-files-runbook.md` Step 1 closed it.
- `lor-mvp-spec.md` says the answer loop is read-only; it binds brain write
  tools (`index.ts:2100-2101`). `context-engine.md` §6 item 6 already flags
  the spec as stale.
