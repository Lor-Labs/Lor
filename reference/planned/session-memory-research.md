# Session memory: research record

> Status: research notes, kept as the source record for
> [`session-memory.md`](./session-memory.md) and any later write-up. Literature
> pass run 2026-10-14; code audits 2026-10-13 to 2026-10-16. Numbers are copied
> as reported; check them in the source before quoting them.

## How to read the labels

- **✓**: checked against the primary source in the main session.
- **P**: read in the primary source by the research agent (2026-10-14), not
  re-checked in the main session.
- **S**: secondary source or search snippet only.

Where only a title and authors are marked ✓, the results are still **P**.

## Questions and the decisions they fed

| Question | Decisions in `session-memory.md` |
|---|---|
| Q1. What retrieval unit works best: whole session, turn, facts or summaries? | 6, 12, 13; Phase 2 stores real text |
| Q2. Do distilled lessons from past agent runs beat raw traces? | 12, 13 |
| Q3. What do production systems index from past conversations? | 9, 10, 11; timing |
| Q4. Is model-written text safe to index next to human text? | 13 |
| Q5. Deterministic links vs model-extracted links | 1, 6 |
| Q6. Summarize at session end or along the way? | 9, 10, 11 |

## Q1. Retrieval granularity in conversational memory

| Source | Setup | Result | Label |
|---|---|---|---|
| Wu et al., **LongMemEval**, ICLR 2025, [arXiv 2410.10813v2](https://arxiv.org/html/2410.10813v2) | Stella V5 retriever; Llama 3.1 8B wrote the summaries, keyphrases and facts | Session-level recall@5 by key: raw value 0.706, summary 0.572, fact 0.642, keyphrase 0.482, raw + summary 0.689, raw + fact 0.732, raw + keyphrase 0.710 | ✓ |
| | | Keys kept user-side text only: "When sessions or rounds are used as the key, we only keep the user-side utterances." | ✓ |
| | | "Despite their more focused semantics, using these condensed forms alone does not enhance the memory recall performance." | ✓ |
| | | Round-level key expansion 0.582 to 0.644. Average over readers (GPT-4o, Llama 3.1 70B and 8B): +9.4% recall@k, +5.4% accuracy | P |
| | | Replacing values with summaries or facts hurts QA "due to information loss", except for multi-session reasoning. Rounds beat sessions with GPT-4o as reader | P |
| | | Commercial assistants, online vs offline: ChatGPT 0.5773 vs 0.9184; Coze 0.3299 | P |
| | | Single-session-assistant questions ("what did the assistant say"): 56 of 500 | P |
| Maharana et al., **LoCoMo**, 2024, [arXiv 2402.17753](https://arxiv.org/html/2402.17753) | DRAGON retriever, gpt-3.5-turbo-16k reader | Overall F1: dialog top-5 31.7; observations top-5 41.4; summaries 29.9 (top-2) and 31.5 (top-10). Summaries do "not significantly improve the performance despite high recall accuracies, likely due to loss of information" | P |
| Pan et al., **SeCom**, 2025, [arXiv 2502.05589](https://arxiv.org/html/2502.05589) | LoCoMo, GPT4Score, GPT-3.5-turbo, BM25 | Turn 65.58, session 63.16, summary 53.87, topic segment 71.57 | P |
| Tao An, **Fidelity Before Structure: Verbatim Chunks Beat Lossy Artifact Extraction in Long-Conversation LLM Memory**, submitted 2025-12-23, [arXiv 2601.00821](https://arxiv.org/html/2601.00821v3) | BGE-m3, bge-reranker-v2-m3, GPT-4o | Verbatim chunks beat typed extracted artifacts: LoCoMo 43.9 vs 28.0; LongMemEval-S 67.4 vs 45.4. Chunks plus artifacts 42.5, no better than chunks alone. 69% of artifact failures were facts never extracted. "A graph cannot restore what no node contains" | Title, author ✓; results P |
| Rishabh Sharma, Rishika Lall, **When Does Selection Replace Extraction? A Pre-Registered Test of Agent Memory with a Typed Decision Model**, submitted 2026-09-28, [arXiv 2609.34227](https://arxiv.org/abs/2609.34227v1) | Selector is the authors' own model, Jev | At a tight budget, raw turns are non-inferior to model extraction and 3,061× cheaper to write. "At generous budgets ... extraction systems are more accurate." | Title, authors ✓; results P |

## Q2. Memory from past agent runs

| Source | Setup | Result | Label |
|---|---|---|---|
| Zhu et al., **SWE Context Bench: A Benchmark for Context Learning in Coding**, 2026, [arXiv 2602.08316v3](https://arxiv.org/html/2602.08316v3) | Claude Sonnet 4.5; 99 related tasks, SWE-ContextBench Lite | Resolved: no context 26.26%; oracle full trajectory 27.27%; oracle summary 34.34%; summaries the agent picked itself 22.22%. Summaries average 217.1 tokens, trajectories 25,633.7 | ✓ |
| Fan et al., **VibeMemBench: Evaluating Memory Systems for Coding Agents on Real Repository Coding Tasks**, 2026, [arXiv 2609.23570v1](https://arxiv.org/html/2609.23570v1) | Mem0, SimpleMem, MemoryOS and A-MEM built from earlier runs on the same repo | "eleven of twelve solver and system pairings fail to exceed the matched memory-off baseline". "the harm operates through transcript volume rather than instruction semantics". "A record helps with no observed downside when the solver fails the target without memory and the record reaches at least a directory or identifier anchor": raised the resolve rate in 55.2% of 58 pairings, lowered it in none | ✓ |
| Wang et al., **Agent Workflow Memory**, 2024, [arXiv 2409.07429](https://arxiv.org/html/2409.07429) | WebArena, Mind2Web | WebArena 35.5% vs BrowserGym 23.5%. Against Synapse (raw examples): +5.0 element accuracy, +4.0 step success rate. Concrete examples "may bias agents to select elements similar to those presented" | P |
| Zhao et al., **ExpeL**, [arXiv 2308.10144](https://arxiv.org/html/2308.10144) | HotpotQA, ALFWorld | Insights only vs retrieval only: HotpotQA 36 vs 31; ALFWorld 50 vs 55. Full ExpeL 39 and 59: the two complement each other | P |
| Ouyang et al. (Google), **ReasoningBank**, [arXiv 2509.25140v2](https://arxiv.org/html/2509.25140v2) | Gemini-2.5-flash | WebArena: no memory 40.5, Synapse 42.1, AWM 44.1, ReasoningBank 48.8. SWE-bench-Verified: 34.2 / 35.4 / 38.8 (three conditions as reported; mapping to conditions not recorded) | P |
| Park et al., **Generative Agents**, 2023, [arXiv 2304.03442](https://ar5iv.labs.arxiv.org/html/2304.03442) | TrueSkill ratings | Full architecture 29.89 vs no reflection 26.88 | P |
| Xiong et al., [arXiv 2505.16067](https://arxiv.org/html/2505.16067) | Experience stores | Add everything vs strict curation, EHRAgent: 13.05 vs 38.50. Errors in stored experience propagate to later tasks | P |
| Jinming Hu, Haodong Zhao, Qi Jia, Die Chen, Tianhang Zhao, Sufeng Duan, Gongshen Liu, **Learning from Others, Acting for You: Cross-User Memory Sharing for LLM Agents** (ShareMem), submitted 2026-09-26, [arXiv 2609.32511](https://arxiv.org/html/2609.32511) | Mind2Web | Sharing distilled procedures across users: +2.35 to +4.10 pp. With agent rollouts instead of gold demos: shared −5.90 pp vs local-only −1.53 pp. Agents applied other users' preferences "despite source labels" | Title, authors ✓; results P |
| [GitHub Copilot Memory docs](https://docs.github.com/en/copilot/concepts/agents/copilot-memory) | Product docs | Repository facts are shared with every user who can access the repo | P |

No source studied teammates retrieving each other's raw agent sessions.

## Q3. Production systems

| Source | What it indexes and when | Label |
|---|---|---|
| **Mem0** paper, 2025, [arXiv 2504.19413](https://arxiv.org/html/2504.19413) | GPT-4o-mini extracts facts per message pair, then ADD / UPDATE / DELETE / NOOP. LoCoMo J: Mem0 66.88, Mem0g (graph) 68.44, full context 72.90, best RAG about 61. p95 latency 1.44 s vs 17.12 s full context. Mem0g costs about 2× tokens (14k vs 7k) and p95 2.59 s | P |
| **Mem0 v3** ([migration](https://docs.mem0.ai/migration/oss-v2-to-v3), [blog](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm), [changelog](https://docs.mem0.ai/changelog/highlights), 2026-04-14) | Moved to ADD-only: "Overwrites sometimes erased key information... Deletes sometimes removed information that would be relevant later." Agent-generated facts now "first-class"; the old algorithm had "a blind spot" for them. Hybrid retrieval (semantic + BM25 + entity matching). External graph stores removed. Reported LoCoMo 71.4 to 91.6, LongMemEval 67.8 to 93.4, models not stated | P |
| **Zep / Graphiti**, [arXiv 2501.13956](https://arxiv.org/html/2501.13956) | Keeps raw episodes as a "non-lossy" store, with links from extracted facts. LongMemEval with gpt-4o: 71.2 vs 60.2 full context. Single-session-assistant questions fell 17.7% | P |
| **Letta** ([benchmark blog](https://www.letta.com/blog/benchmarking-ai-agent-memory/), [memory docs](https://docs.letta.com/configuration/memory)) | Filesystem + grep + semantic search on GPT-4o mini: LoCoMo 74.0% vs Mem0g 68.5%. A "dreaming" step runs after N steps or on context compaction | P |
| **Claude** ([support article](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)) | Past-chat search is RAG over raw chats, used as a tool when the user prompts it, scoped per project. Memory is saved "as you chat, rather than summarizing conversations after they end." | P |
| **ChatGPT** | Chat history used as derived "insights" that change over time; June 2026 "Dreaming" is background synthesis for staleness and correctness. OpenAI pages returned 403 | S |
| **GitHub Copilot** ([engineering blog](https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/)) | The agent stores fact + citations + reason through a tool call during the task. Offline curation rejected for cost and complexity. Citations checked against the current branch before use; unused memories expire after 28 days. PR merge rate 90% vs 83% | P |
| **Cursor** ([changelog 1.0](https://cursor.com/changelog/1-0), [staff reply](https://forum.cursor.com/t/memories-not-showing/143820)) | Memories shipped June 2025 as "facts from conversations"; removed in 2.1.17 with no reason given; users told to export them to Rules | P |
| **Devin** ([knowledge docs](https://docs.devin.ai/product-guides/knowledge)) | Knowledge items, auto-suggested "based on your feedback in chat"; users edit or dismiss them | P |
| **Unblocked** ([inside the engine](https://getunblocked.com/blog/inside-the-unblocked-context-engine/)) | Graph edges from "time-based correlations, shared identifiers, the thread that mentions the ticket that links the PR". Expert graph from PR, review and commit activity. "Code is the strongest ground truth." Does not say whether it indexes agent sessions | P |

Pattern across systems: keep the raw text, add derived keys, verify at read
time. Mem0 and Zep both had trouble with what the assistant said.

## Q4. Model-written text as memory

| Source | Result | Label |
|---|---|---|
| Sunhao Dai, Yuqi Zhou, Liang Pang, Weihao Liu, Xiaolin Hu, Yong Liu, Xiao Zhang, Gang Wang, Jun Xu, **Neural Retrievers are Biased Towards LLM-Generated Content**, KDD 2024, [arXiv 2310.20501](https://arxiv.org/abs/2310.20501) | BM25: +23.9% NDCG@1 toward human text (SciFact + AIGC). monoT5 reranker: −67.3% NDCG@1, a strong preference for LLM text. Tested on 2023-era models | Title, authors ✓; results P |
| Wei Huang, Keping Bi, Yinqiong Cai, Wei Chen, Jiafeng Guo, Xueqi Cheng, **Relevance Supervision Can Teach Neural Retrievers to Prefer LLM-Generated Text**, submitted 2026-04-07, [arXiv 2604.06163](https://arxiv.org/abs/2604.06163) | Attributes the bias to relevance training data | Title, authors ✓; result P |
| **Perplexity Trap**, [arXiv 2503.08684](https://arxiv.org/abs/2503.08684) | Attributes the bias to low perplexity | S |
| **Spiral of Silence**, ACL 2024, [arXiv 2404.10496](https://arxiv.org/abs/2404.10496) | LLM text displaces human content in retrieval rankings | P |
| Xiong et al.; ShareMem (Q2) | Errors in stored experience propagate; agent rollouts as shared memory cost −5.90 pp | P |
| Unblocked (Q3) | Documents are "intent rather than fact" | P |

## Q5. Deterministic links vs model-extracted links

| Source | Result | Label |
|---|---|---|
| VibeMemBench (Q2) | Identifier or directory anchors were the one consistent win | ✓ |
| Han et al., [arXiv 2502.11371v3](https://arxiv.org/html/2502.11371v3) | Model-built knowledge graphs held 65.8% (HotpotQA) and 65.5% (NQ) of answer entities | P |
| Mem0 (Q3) | Mem0g gained 1.56 J for 2× tokens and a higher p95; v3 replaced the graph with an entity-linking boost | P |
| [LazyGraphRAG](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/) (Microsoft Research) | Noun-phrase extraction instead of model extraction; indexing costs 0.1% of full GraphRAG | P |
| Tao An (Q1) | "A graph cannot restore what no node contains" | P |
| Unblocked (Q3) | Edges from identifiers, PRs and authorship | P |

No study found compares deterministic and model-extracted links head to head.
VibeMemBench covers coding agents and repo anchors, not team sessions; carrying
the result over is an assumption.

## Q6. Timing: session end vs along the way

| Source | Result | Label |
|---|---|---|
| Zhang et al., **ACE**, 2025, [arXiv 2510.04618](https://arxiv.org/html/2510.04618) | Fully rewriting the context collapsed it from 18,282 to 122 tokens; accuracy fell from 66.7% to 57.1% (baseline 63.7%). Fix: incremental delta edits | P |
| LongMemEval (Q1) | ChatGPT was seen to "overwrite crucial information as the chat continues" | P |
| Mem0 v3 (Q3) | Dropped UPDATE and DELETE for the same reason | P |
| Tan et al., **RMM**, [arXiv 2503.08026](https://arxiv.org/html/2503.08026) | Session-end topic memories plus an RL reranker. LongMemEval with GTE: R@5 69.8, accuracy 70.4, vs RAG 62.4 / 63.6. Gains mix both parts | P |
| **LightMem**, 2026, [arXiv 2510.18866](https://arxiv.org/html/2510.18866) | Offline "sleep-time" consolidation matched online updates (68.64 vs 67.78) at lower cost | P |
| **Mastra** ([observational memory](https://mastra.ai/blog/observational-memory)) | Compresses incrementally at a 30k-token threshold; gpt-4o scores 84.23 on LongMemEval; raw messages are discarded | P |
| Claude, GitHub Copilot (Q3) | Both save memory during the task, not after it | P |

No study found compares summary quality at session end vs incrementally.

## Not verified

- That Claude memory was once synthesized every 24 hours (secondary sources).
- OpenAI "Dreaming" details, including a reported 67.9% to 82.8% recall.
- Why Cursor removed Memories.
- Which models Mem0 v3 used for its benchmark scores, and its assistant-recall
  gain (+51.8 in the blog, +53.6 in a search snippet).
- Whether Unblocked uses a model for its edges, and whether it indexes agent
  sessions.
- Whether source bias holds for current embedders and rerankers (Dai et al.
  tested 2023-era models).
- Mem0's best RAG baseline configuration, and LongMemEval Table 3's per-reader
  QA columns.

## Internal findings (this codebase)

Read from code, not reproduced by running unless noted.

| Date, commit | Finding | Where it went |
|---|---|---|
| 2026-10-13, `99d8fb69` | Sessions are not a retrieval unit. Message search is keyword-only and cuts hits to 500 characters; hits carry no session id. Write-back skips a turn when a workspace-wide Redis lock is held; the gate sees only the new turn | `session-memory.md` As built; Steps 2, 3, 4 |
| 2026-10-14, `99d8fb69` | Tool results can't drive links by URL: many return no URL, some nest it or return another item's URL. `@ai-sdk/mcp` 2.0.5 `mcpToModelOutput` drops `structuredContent` (✓ read in `node_modules`). One GitHub PR appears under several URL forms; Linear and Notion URLs carry title slugs | Decision 6; Step 5 specs |
| 2026-10-14 | MCP spec (2025-11-25 and 2026-07-28): `structuredContent` and `outputSchema` optional; clients "MUST consider tool annotations to be untrusted unless they come from trusted servers" ([tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)) | Decision 6 (P) |
| 2026-10-15 | `source` leak: `searchSources` filters by workspace and status only (✓). Raw content discarded; upsert never updates `connectionId`; Remember off by default | Step 1 |
| 2026-10-16, `9b011db5` | `fetch_source` made summary-only in `a9bf58f1` so live reads pass profile and approval gates. Built-in catalog tools carry a reviewed `readOnlyHint` | Permission rules; Step 5 |
| 2026-10-16 | Scoped memory writes collide with the workspace `/projects` folder under the old unique key (`brain_node_parent_name_uq` ignored scope) | Fixed in Step 3b |
| 2026-10-16 | Postgres `ts_headline` docs don't say whether an empty `StartSel` is allowed (✓, [docs](https://www.postgresql.org/docs/16/textsearch-controls.html)) | Step 2 uses `**` markers |
| 2026-10-16 | Better Stack's MCP docs and its plugin's investigation skill list tools but no input parameter names for incident or error calls (✓, [docs](https://betterstack.com/docs/getting-started/integrations/mcp/), [skill](https://github.com/BetterStackHQ/claude-plugin/blob/main/skills/investigate-incident/SKILL.md)) | Better Stack touch specs deferred |
| 2026-10-16 | The bound tools' runtime input schemas, as read out by Lor in a channel with the connector: incidents take `id`; errors take `application_id` + `pattern` (no single error id); sources and monitors take `id` | Better Stack touch specs added |
