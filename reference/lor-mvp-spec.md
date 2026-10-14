# Lor MVP — Implementation Spec (as-built)

**Status:** MVP-core **implemented** (2026-06-17) — the full loop works: `@Lor` → answer grounded in chat + brain → autonomous write-back → semantic retrieval. Remaining for MVP: integrations (Track B) + polish (see §10).
**Audience:** anyone working on the Lor brain + harness.
**Relationship to `archive/lor-agent-architecture.md`:** that doc is the north-star vision; this is what actually got built. Where they differ, this wins.

## What this changed vs. `archive/lor-agent-architecture.md`

| Topic | Architecture doc | **As built** |
|---|---|---|
| Chat synthesis | Proactive, compile-time ("the tutor") | **Lazy / on-demand** — only on `@Lor` |
| Chat retrieval | Conversation chunks embedded | **Postgres FTS only** (expression GIN index); no chat embeddings |
| `conversation_chunks` / `memory_events` | In the model | **Dropped**; non-destructive page updates via `status` + `version` |
| Edge `type` | Free text (taxonomy-as-data) | **Controlled pgEnum** `brain_edge_type` — the graph needs a stable vocabulary |
| Brain table names | `nodes` / `edges` | **`brain_node` / `brain_edge`** |
| Brain tool names | — | bare **`ls`/`read`/`tree`/`write`/`mkdir`/`move`/`link`** (models know these) |
| Write-back | (implied) | **Autonomous** — Lor decides salience itself; Inkling gate + Kimi K3 agent |
| Grounding | Strict citations, hard-verified | Citation use is **prompt-conditional** (institutional vs general); emitted citations are hard-verified |
| Self-host / BYO-key | First-class (AGPL) | model roles are configurable across AI Gateway's providers; code investigation uses the same main model through Pi |
| Brain browser UI | Human-browsable | **Deferred** — agent-only brain |

---

## 1. The one principle

> **Embed the unit when the source emits discrete, high-signal units. Search live when the source emits a high-volume, low-signal stream. The synthesized brain compiles lazily, on demand.**

| Source | Volume | Unit | Strategy |
|---|---|---|---|
| Chat | high | none (stream) | live Postgres **FTS** (`to_tsvector` expression index); no embeddings |
| Brain pages | low | the page | Qwen-embedded (2560-d halfvec); written **lazily** during write-back |
| Chat attachments | low | image / page / slide | **eager** at send: vision transcription (images) or extracted text → Qwen embedding + FTS in `attachment_chunk`; never DMs — see `attachment-search.md` |
| Integrations (PR/issue/page) | low | the item | **eager** summarize + embed — *Track B, not yet built* |
| Code | huge | file@sha | anchored live-fetch — *deferred* |

The harness is the moat: tools, context construction, steering. Retrieval behind a tool is swappable (FTS→embeddings, etc.) without touching the harness.

---

## 2. MVP scope

**Built:**
- The brain: `brain_node` (folder/page tree) + `brain_edge` (typed graph) + pgvector embeddings on pages.
- The harness (`packages/lor`): a Kimi K3 tool-loop over the brain + chat; read-only when answering, read+write during write-back.
- The full `@Lor` loop: mention → stream a grounded answer → notify like a normal message → autonomous async write-back → "🧠 remembered" chip.
- Semantic retrieval: embed-on-write + question pre-fetch over page embeddings.
- Reply placement: Inkling routes broadly useful replies to the channel and narrow replies to a thread.
- Hard citation verification: emitted brain, message, and source citations are resolved before persistence; invalid markers are stripped.

**Deferred (not built):**
- Connectors beyond GitHub (Linear, …) — `source` ingestion, the GitHub connector, and the `search`/`fetch_source` tools are built; see `reference/github-connector.md`.
- Default taxonomy seed — Lor grows the tree organically via `mkdir`-on-write.
- Code write-back, compaction/decay, brain browser UI, and broader eval coverage.

---

## 3. The invocation loop (as built)

Stateless per invocation; the only persistent state is the brain in Postgres.

```text
1. TRIGGER    realtime message:send detects @Lor (LOR_USER_ID in the mention) →
              creates an empty Lor placeholder message (NO fanout) → broadcasts
              message:created → enqueues a `lor-respond` job.
2. ANSWER     worker, Phase 1 (read-only): semantic pre-fetch (embed the question →
              top-3 full brain pages + their linked pages) seeds the prompt; Kimi K3 tool-loop over chat
              (search_messages/read_thread) + brain (ls/read/tree); streams tokens
              back via `message:stream`. Grounding is conditional (see §4).
3. PERSIST    Phase 2: write final text to the message; run the normal notification
              fanout (so Lor's reply notifies like any message); emit stream `done`.
4. WRITE-BACK Phase 3 (autonomous, after the answer ships; per-workspace Redis lock):
              Inkling gate ("anything durable here?") → if yes, a Kimi K3 agent CONTINUES
              the answer's messages with brain read+write tools, decides update-vs-create,
              and writes/links pages. Each page write emits `lor:memory` → web chip.
5. SLEEP      job ends. No persistent process.
```

- **Answer latency is decoupled from write-back** — users wait only for steps 1–3.
- **Read-only answer / write-only write-back** — the answer loop has no write tools; only the write-back phase can mutate the brain.
- **Per-workspace lock** (`lor:writeback:<ws>`, Redis `SET NX EX`) serializes brain writes; if held, this write-back is skipped (knowledge resurfaces on a later mention).

### 3.1 Grounding & the cheap-model gate

- **Conditional grounding (in the system prompt, not a separate model):** for workspace questions Lor grounds in what it finds (brain + message search) or says "I don't have it in memory yet"; general questions (how-to, chit-chat) are answered directly. **Citations are verified** (§4): Lor cites brain pages it relied on as `[[/path]]` and specific messages as `[[msg:<id>]]`; the worker strips any that don't resolve. Message-id citations are clickable (jump-to-message).
- **Write-back salience gate (Inkling):** a cheap, forced structured tool call over the exchange decides whether to spin up the expensive write-back agent — skips trivial mentions.
- **Reply placement (Inkling):** a forced structured tool call routes narrow replies into a thread and broadly useful replies into the channel.

---

## 4. The harness (`packages/lor`)

An open-weight tool-use loop (Vercel **AI SDK v7**, `streamText` for the streamed answer and `generateText` for write-back and small-model tasks). The main model (MiMo V2.6 Pro on trial, Kimi K3 fallback) handles the main agent and durable write-back; the small model (GLM 5.3 Flash) handles the gate, reply placement, and source summaries. Small structured decisions use forced, schema-validated tool calls instead of provider-specific JSON response formats.

**Answer tools (read-only):**
- `search_messages(query, limit?)` — workspace-wide FTS (`to_tsvector` + `ts_rank`).
- `read_thread(messageId)` — full thread around a hit.
- `ls(path)` / `read(path)` / `tree(path, depth?)` — browse the brain. `read` and the semantic pre-fetch return each page's **linked pages** (edges: type + direction + connected path), so Lor traverses the graph via `read` — no separate edge-query tool.

**Write-back tools (answer tools + writes):** adds `write(path, body)` (mkdir-p; embeds on write), `mkdir(path)`, `move(from, to)`, `link(from, to, type)` where `type ∈ brain_edge_type`.

**Models:** the main model (`LOR_MODEL`, see below) for answers and write-back; GLM 5.3 Flash (`zai/glm-5.3-flash`) for small/background tasks (was Inkling until 2026-08-27). The small tier falls back to Kimi K3 through AI Gateway so normal inference stays on open-weight models. GLM 5.3 Flash was the main model from 2026-08-27 to 2026-10-13. It degenerates in long multi-tool runs, so LOR-104 moved main to MiMo V2.6 Pro (`xiaomi/mimo-v2.6-pro`, on trial) with Kimi K3 as its fallback. Main-model calls try DeepInfra first (`LOR_MODEL_PROVIDER_ORDER`), the only MiMo route flagged zero-data-retention and no-training. Kimi K3 is the proven main model, at about 10x the cost.

**Grounding:** whether an answer requires citations is prompt-conditional (above). **Citation verification is built:** when Lor emits citations, `groundCitations(workspaceId, text)` resolves brain pages (`pageExists`), messages (`messageExists`), and sources (`resolveSourceCitation`) before persistence. It keeps valid markers, unwraps unresolved page labels to plain text, and removes unresolved message/source markers so hallucinated citations cannot pose as sources. The worker runs verification before persist/fanout and logs stripped citations. Message citations are clickable; brain-page citations render as pills but remain non-clickable until the brain browser exists.

---

## 5. Data model (as built)

Postgres 16 + pgvector (extensions installed manually on Railway). UUID PKs. Embedding `halfvec(2560)` (Qwen3 Embedding 4B), HNSW cosine index.

- **`brain_node`** — the brain tree.
  - `id`, `workspaceId` (fk → workspace, cascade), `kind` (`folder` | `page`), `parentId` (self-ref, cascade; null = top-level), `name`
  - page payload: `body` (text), `metadata` (jsonb default `{}`), `embedding` (`halfvec(2560)`, null until embedded)
  - `status` (`active` | `archived`, default `active`), `version` (int, default 1, bumps on body update)
  - **unique `(workspaceId, parentId, name)` NULLS NOT DISTINCT** (so top-level names can't collide); HNSW on `embedding`
- **`brain_edge`** — typed graph between page nodes.
  - `id`, `workspaceId`, `fromNodeId`, `toNodeId`, `type` (**`brain_edge_type` enum**), `metadata` (jsonb), `createdAt`
  - `BRAIN_EDGE_TYPES` = `relates_to | supersedes | caused_by | depends_on | part_of | owned_by` (add values deliberately)
  - unique `(fromNodeId, toNodeId, type)`; indexes on `(workspaceId, fromNodeId)` / `(workspaceId, toNodeId)`

**Existing-table touches:**
- **`user`**: added `isBot` (boolean, default false). One global **Lor** bot user, fixed id `LOR_USER_ID` (`packages/db/src/constants.ts`, seeded via `seeds/lor.ts`). Lor authors messages as this user; it's a real workspace member (so it's mentionable + receives fanout) — auto-added on workspace creation (`packages/auth` `afterCreateOrganization`).
- **`message`**: added an **expression** GIN index `to_tsvector('english', coalesce(content,''))` (not a stored tsvector column — avoids touching the message zod schemas / a table rewrite). Existing `message_content_trgm_idx` kept for fuzzy fallback.

**Not built (Track B):** `lor_source`, `lor_page_source`, `lor_integration_connection` (see §6). `conversation_chunks`, `memory_events` — dropped.

---

## 6. Integration ingestion (Track B contract — not yet built)

Eager, event-driven, never indiscriminate. Per provider: a *unit* + a salience filter for which events warrant an Inkling summarization → upsert a `source` row (summary + pointer + metadata) → **embed the summary, not the document** (full content live-fetched on demand). Stale summary hurts recall, never correctness. Cross-source synthesis into brain pages stays lazy (write-back). Connections are workspace-level; stored summaries are workspace-visible (accepted, since all channels are public-to-workspace). The search/fetch source tools join the harness when this lands.

---

## 7. Topology (as built)

- **`packages/lor`** — the harness core: `index.ts` (`respond`, `writeBack`, system prompt, chat tools), `brain.ts` (brain ops + read/write tool sets + `searchBrain`), `embeddings.ts` (separate document and instructed-query embedding functions). No HTTP/sockets.
- **`packages/messaging`** — shared message-notification fanout (`buildMessageFanout`), called by both realtime (human send) and the worker (Lor completion).
- **`apps/realtime`** — `message:send` detects `@Lor`, creates the placeholder (no fanout), enqueues; relays streamed output. Blocks DM creation with Lor (it's workspace-scoped).
- **`apps/worker`** — `lor-respond` BullMQ job runs the 3 phases; emits `message:stream` + `lor:memory` through the `@socket.io/redis-emitter`.
- **`apps/web`** — `use-lor-stream` appends `message:stream` deltas (+ "thinking" indicator) and records `lor:memory` as a "🧠 remembered: /path" chip on the reply (transient `streaming` / `remembered` fields on `Message`).

Socket events (in `@repo/realtime-types`): `message:stream { channelId, messageId, delta, done }`, `lor:memory { channelId, messageId, path, action }`.

---

## 8. Brain taxonomy

**Minimal scaffold seeded; structure still emerges.** On workspace creation (`packages/auth` `seedBrainTaxonomy`, alongside Lor membership) three top-level folders are inserted — **`/people`, `/projects`, `/decisions`** — so Lor has obvious places to file knowledge cold-start. Beyond that the tree grows organically: `write` (and `mkdir`) create parent folders on demand (mkdir-p) during write-back. Seed is folders only, idempotent, best-effort, and only on creation (existing workspaces are unaffected — mkdir-p covers them). Taxonomy is data, not schema.

---

## 9. Models & cost posture

- **Explicit Gateway transport:** Vercel AI Gateway is the single transport for language models and embeddings, authenticated with `AI_GATEWAY_API_KEY`; `AI_GATEWAY_BASE_URL` is an optional endpoint override. Main, small, fallback, embedding, and dimension choices remain centrally configurable without provider-specific call-site code.
- **Embeddings:** Qwen3 Embedding 4B (`alibaba/qwen3-embedding-4b`), stored as `halfvec(2560)`. Query embeddings receive task-specific retrieval instructions; page/source document embeddings do not.
- **Embedding migration:** `pnpm db:reembed` idempotently converts legacy columns, embeds every missing brain page and source summary, and restores both HNSW indexes. Tune bounded parallelism with `LOR_REEMBED_CONCURRENCY` (default 4).
- **Answer + write-back:** MiMo V2.6 Pro (`xiaomi/mimo-v2.6-pro`, on trial, DeepInfra first), falling back to Kimi K3 (`moonshotai/kimi-k3`).
- **Salience gate, reply placement, source summaries:** GLM 5.3 Flash (`zai/glm-5.3-flash`).
- **Code investigation:** Pi (from our Blaxel sandbox image, exact-pinned) runs the configured main model (MiMo V2.6 Pro by default, with default gateway routing: the provider order is not passed to Pi). It has only read-only repository tools and ignores repo-provided extensions, skills, prompts, and context files.
- **Code-investigation billing:** every successful Pi invocation records its token usage and debits customer credits at the centrally configured served-model rate; stable per-response invocation keys prevent duplicate retry charges while allowing multiple investigations in one answer.
- **Ingestion is never metered** (product principle); write-back cost is bounded by the small-model gate.
- Gateway prompt caching is requested for the main tier with `caching: "auto"`.

> Env note: `AI_GATEWAY_API_KEY` is the canonical inference credential for both Lor and Pi code investigations. `AI_GATEWAY_BASE_URL` remains an optional transport override.

---

## 10. Build status & next steps

**Done — MVP-core (built in order 1 → 2 → 4 → 3):**
1. Schema (`brain_node`/`brain_edge`, HNSW), Lor bot user, message FTS index.
2. Brain tools (`ls`/`read`/`tree`/`write`/`mkdir`/`move`/`link`) + chat tools + the agentic answer loop.
3. (as #4) Autonomous write-back: Inkling salience gate + Kimi K3 agent, per-workspace lock, `lor:memory` chip.
4. (as #3) Embeddings: embed-on-write + semantic pre-fetch (top-3 full pages + their linked pages).
   Plus: realtime trigger, worker job, web streaming/chip, fanout extraction (`@repo/messaging`), workspace auto-membership, DM guard, `summary`/`aliases` frontmatter convention.

**Since validated end-to-end (loop observed working: answers grounded in chat + brain, autonomous write-back writing real pages, retrieval, threaded streaming). Also built since MVP-core:**
- **Vision** — image attachments downloaded and sent inline (base64) to the answer model; supported types only, 5MB/8-image caps.
- **Reply-placement router** — Inkling decides channel vs. thread for main-channel mentions (`packages/lor/placement`, called from realtime); thread session + per-thread mute rules; `contextThreadRootId` so threaded replies still read channel context.
- **Brain-page citation verification** — `[[/path]]` contract + `groundCitations` strips unresolved citations (§3.1/§4).
- **Default taxonomy seed** — `/people` `/projects` `/decisions` on workspace creation (§8).
- **Streamdown** markdown renderer (sanitized, shiki, streaming-aware); **login redirect** to last workspace/channel.

**Next steps (priority order):**
1. **Eval harness (implemented; keep expanding).** Seeded generation, direct retrieval, placement, citation, tool-loop, reasoning, and positive/negative write-back fixtures. Run it against a throwaway `EVAL_DB_URL` before every model or prompt rollout; use `EVAL_EXPECT_SERVED_MODEL` when explicitly testing gateway fallback.
2. **Integrations (Track B):** `lor_source` / `lor_page_source` / `lor_integration_connection` tables + per-provider connectors + `search_sources`/`fetch_source` tools (§6).
3. **Image-aware write-back** — the salience gate is text-only, so knowledge living only in an image never gets saved.
4. **Optional / when-needed:** page chunking (gated on pages growing large); frontmatter → `metadata` parse (when a consumer exists, e.g. tag filtering); brain-browser UI (makes brain-page citations clickable); streamdown `@source` decoupling from `apps/web/node_modules`.

---

## 11. Non-negotiables

- **Never embed individual messages** — chat is FTS; only pages (and later source summaries) are embedded.
- **pgvector, embedding-as-column.** No second datastore.
- **Tree (`parent_id`) and graph (`brain_edge`) are separate.** Folders/pages are real node kinds.
- **Edge `type` is a controlled enum**, not free text.
- **Lazy, autonomous write-back** — no proactive chat synthesis; Lor decides what to remember, after answering, async.
- **Conditional grounding** — workspace answers grounded or "not in memory"; general questions answered freely. (Hard verification: later.)
- **Never hard-delete brain content** — `status=archived`, `version` bumps.
- **Retrieval behind a tool is swappable without touching the harness.**
- **Lor is workspace-scoped** — never in DMs; a member of every workspace.
