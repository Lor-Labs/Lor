# Code Channels — multiplayer AI coding environment

> Status: design, not built. Agreed 2026-10-05 as the target architecture for
> code channels. Details are expected to be re-litigated at implementation
> time; the **locked decisions** (§3) and **rejected alternatives** (§8) record
> why the shape is what it is. Broader priorities: [`product-direction.md`](./product-direction.md).

## 1. Goals

- **Live edits** — everyone watches agent (and human) edits as they happen; opt-in co-editing.
- **Inspect a prompt** — @mention a teammate on a specific step; they open the exact prompt, agent actions, and diff.
- **Handoff with full context** — give a coworker the session (conversation + code) and they continue where you left off.
- **Fork from any point** — nobody's place is ever overwritten; forks of forks work.
- **Rewind** — go back N steps without destroying anything.
- **Subchannels** — fork a channel's recent context into a sub (code) channel.
- **Clone locally** — `git clone` a session and continue in your own IDE.
- **Ship** — finished work lands on GitHub as a PR.

## 2. Concepts

| Term | Meaning |
|---|---|
| **Code channel** | A channel bound to a repo. Where people talk; permissions = channel membership. |
| **Session** | One line of work: conversation + session branch + runtime. A channel has one main session by default; forks, branching threads and subchannels create their own. |
| **Step** | One agent or human turn. The unit of checkpoint, @mention, rewind and fork. |
| **Checkpoint** | State after a step = conversation up to the step (Postgres) + a code commit (git host). |
| **Base branch** | The GitHub branch work starts from and ships back to (e.g. `dev`). Never live-edited. |
| **Session branch** | The git-host branch the session works on (ephemeral namespace on Code Storage), e.g. `sessions/homepage-a1b2`. |
| **Driver** | The one person (plus their agent) currently steering a session. |

**The primitive:** after every step, commit the code and record that commit on the step. Every feature above is built from it.

## 3. Where things live (locked)

| Layer | Holds | Why |
|---|---|---|
| **Postgres** | Chat, both agents' full transcripts (Lor + coding sub-agent), steps, fork/branch tree, rewind branches, driver lock, mentions/comments, permissions, `commit_sha` per step | Shared, queryable, permissioned, deletable team data. Forks are parent pointers over immutable rows. |
| **Git host** — Code Storage or Cloudflare Artifacts (§10) | Session branches; one commit per code-changing step | Real git remote (local clone), cheap branches, push events, server-side read APIs. |
| **Yjs** (`apps/realtime`) | Live docs for files open in a session | Concurrent-edit merging. Live layer only — never the durable store, never forked. |
| **Sockets** (existing) | Agent edit stream, presence, notifications, Yjs transport | Already built. |
| **Blaxel** | Disposable runtime; live preview URLs | Rebuilt from any checkpoint. Never source of truth. |
| **GitHub** | Base branch; final PRs | The team's real repo. Lor writes only on publish. |

Locked decisions:

- **Conversation in Postgres, code in Git, joined by `commit_sha` on the step.** Commits are content-addressed and immutable, so the pointer cannot drift; a crash between push and row write leaves a harmless orphan commit.
- **The git host sits behind a checkpoint interface** (`saveCheckpoint`, `restore`, `fork`, `getCloneUrl`). Artifacts vs Code Storage is decided at phase 1 (§10). Artifacts is not self-hostable (only ArtifactFS is open source); Forgejo or a thin `git http-backend` endpoint are the swap-in fallbacks (e.g. a customer requiring code in their own cloud).
- **The agent never holds a push token.** Lor commits and pushes from its own commands with an explicit refspec (same rule as `propose_code_change` today).
- **Nothing in the sandbox is the only copy of anything.**
- **Preview URLs come from the sandbox (Blaxel), not Artifacts.** Workers Builds previews only apply to Workers-hosted projects (possibly V2 generated apps).

## 4. Data model (sketch)

```
code_session
  id, workspace_id, channel_id, repo_id
  git_repo, branch                   -- session branch on the git host
  base_branch, base_commit           -- e.g. dev @ abc123
  parent_session_id, forked_at_step_id
  driver_user_id                     -- single driver, DB-arbitrated lock
  active_branch_id                   -- active rewind branch
  status

session_branch                        -- rewind branches inside a session
  id, session_id, parent_branch_id, forked_at_step_id

session_step                          -- immutable
  id, session_id, branch_id, seq
  author_type (user | agent), author_id
  agent_run / agent_run_step refs    -- Lor transcript
  coding agent step refs             -- sub-agent transcript (new)
  commit_sha                         -- null when no code changed
  external_effects jsonb             -- PRs opened, issues created, memories saved

channel
  + parent_channel_id, forked_at     -- subchannels
```

Relation to what exists today (verified 2026-10-05):

- `agent_run_step` already stores Lor's exact model transcript per step and is the permanent archive; `continuedFromRunId` + chain replay + `compaction.baselineMessages` already form a parent-pointer chain (`reference/context-continuation.md`). **Gap:** continuation always resumes from the predecessor's end — forking needs a **fork-at-step** pointer.
- **Gap:** the coding sub-agent's (Pi) transcript lives only in the sandbox (`/workspace/.pi-sessions`). Postgres gets bounded display rows (`lorToolCalls`, 16k summaries, bounded diffs) and the closing summary. It must be persisted to Postgres (an `agent_run_step`-like table keyed by parent tool call) in a harness-neutral message format.
- If `agent_run_step` growth becomes a problem, large tool outputs move to R2 with a reference in the row — storage detail, not a design change.

## 5. Flows

### Start a session
1. Mint a scoped GitHub token; mirror the repo on the git host (or sync the existing mirror); create the session branch from `base_branch` @ head.
2. Boot a sandbox from the branch (ArtifactFS for large repos).
3. Insert `code_session` with the creator as driver.

### Each step
1. The driver prompts; the agent works in the sandbox.
2. Edit events stream live over sockets (or into Yjs, §6).
3. At step end Lor commits as the app bot with a `Lor-Step: <id>` trailer, pushes to the session branch, and records `commit_sha` on the step.
4. Every step is a checkpoint — there is never uncommitted work to lose.

### Watch, @mention, inspect
- Each step has a permalink: prompt, agent actions, diff from the previous step, cost.
- @mentioning someone on a step notifies them; they open that exact point read-only (time travel).
- "Why is this line here": `git blame` → commit → `Lor-Step` trailer → step → prompt and conversation. Exposed to agents as an `explain_line` tool.

### Handoff
- **Hand off** (default share action): fork at the latest step, recipient becomes driver, notify. The original is untouched.
- **Take over**: same session, driver role transfers; recorded in history.

### Fork (any step)
- New `code_session` with `parent_session_id` + `forked_at_step_id`; new session branch at that step's commit.
- Conversation = parent's steps up to the fork point + the fork's own (no copying); forks of forks chain. Long chains rely on compaction baselines.
- The forker's permissions and credentials apply, never the original owner's. A fork cannot be shared wider than its parent.

### Rewind
- Rewind = branch in place: new `session_branch` from step N becomes active. **Nothing is deleted.**
- UI marks the divergence: "3 later steps on another branch · view · restore".
- Code continues from step N's commit; abandoned commits stay reachable.
- Show what rewinding cannot undo (PRs opened, issues created, Slack posts, memories saved) from `external_effects`.
- Only the driver rewinds in place; for anyone else the same action creates a fork.
- Deletion is a separate, explicit "discard branch" action or a retention policy — never a side effect of rewind.

### Subchannel
- New channel with `parent_channel_id` + `forked_at`.
- Seed context = the parent's recent messages up to the fork point (or a compacted summary), stored as the first step — channels are an unbounded firehose, so they can't be inherited wholesale.
- A code subchannel also starts its own session branch.

### Clone locally
- Lor issues a repo-scoped, per-user, revocable token; the user runs `git clone <url>`.
- A push back from a laptop becomes a human step: a git-host push event → Lor records a step with that commit → open live docs reload → the agent's next run sees the change.
- Only the driver may push. A push while the agent is mid-step is rejected by normal non-fast-forward rules; pull and retry.

### Sync with base
- "Sync with dev" merges `dev` into the session branch (git merge) as a step; open live docs reload. Conflicts are resolved by the agent or a human.

### Ship
- Squash the session branch to one commit with a `Lor-Session: <url>` trailer, push to GitHub, open a PR.
- GitHub blame → PR → session link → per-step blame → exact prompt.

## 6. Live editing (Yjs)

- **Room key:** `code:{sessionId}:{filePath}`. Live docs belong to the **session branch** — different branch, different docs. Never keyed by the channel (breaks fork isolation) or by `dev` (unrelated sessions would collide).
- **Lazy:** only files someone has open or is editing become Yjs docs, loaded from the latest step's commit.
- **Agent → live doc:** the coding agent's `edit`/`write` tool calls are applied as Yjs transactions with the agent's identity, then written to the sandbox file.
- **Out-of-band changes** (formatters, codemods, git operations, generated lockfiles): a sandbox file watcher diffs and converts to Yjs ops.
- **Human → sandbox:** human edits are written to the sandbox file before the agent's next step; a stale `edit` (old text no longer matches) fails and the agent re-reads.
- **Semantic conflicts** are a product concern, not a CRDT one: presence ("Lor is editing `handleAuth`"), the single-driver default, and telling the agent about human edits in its region.
- **Flush:** at step end, docs → files → commit → `commit_sha`; idle docs are dropped. Forks and rewinds start a fresh live layer from a commit.
- **Modes:** *watch* (single driver, live view — default) and *co-edit* (humans type alongside Lor — opt-in).
- **Library:** Yjs (shared with the document-editing sync-doc primitive in `reference/artifacts.md`). Loro is the alternative if deep history inside the CRDT is ever wanted. No custom engine: Git + Postgres own durable history, so the CRDT only needs to be the live layer.

## 7. Security & permissions

- Session access = channel membership.
- Agents never hold GitHub push tokens; git-host credentials are short-lived and ref-scoped to their own session branch where the host supports it; Lor pushes with an explicit refspec.
- Git-host tokens are short-lived; local-clone tokens are per-user and revocable; GitHub tokens are minted only to import and publish.
- Transcripts are redacted for secrets before persisting; tool outputs are capped.
- Customer code is stored at the git-host vendor: disclose it, and pick the region at creation (Artifacts namespace jurisdiction or Code Storage org region) — both are fixed once set.

## 8. Rejected alternatives (don't re-litigate without new information)

| Alternative | Why not |
|---|---|
| Conversation in Artifacts/git (Cloudflare's internal pattern) | Their sessions are single-player files with no app around them. Lor's chat is shared, searchable, permissioned, deletable team data — native to Postgres. Git's strengths (file-tree dedup, diff, merge, checkout) don't apply to a message list, and chats are never merged. |
| Postgres only (no git) | Would rebuild git: deduplicated file storage, diff, blame, checkout to disk, and pushing to GitHub. |
| Base commit + patch in R2 | Works and is simpler, but no real git remote → no local clone. |
| Checkpoints on the customer's GitHub | Branch noise, rate limits, write access on every step, possible CI side effects. |
| Context in R2 blobs | Duplicates what Postgres already stores. |
| Live docs keyed by channel or base branch | Breaks fork isolation; unrelated sessions collide. |
| Custom CRDT engine (Zed DeltaDB-style) | Durable history already lives in git + Postgres; the CRDT is only the live layer. |
| Blaxel Agent Drive as source of truth | Last-write-wins, no history or merging. At most a shared dependency cache later. |
| Self-hosting Artifacts | Not possible — only ArtifactFS is open source. |

## 9. Build phases

- [ ] **0. Code index** (independent of code channels; can ship first as an upgrade to code Q&A) — see §11.
- [ ] **1. Durable sessions** — persist the coding sub-agent transcript to Postgres; checkpoint interface on the git host; per-step commit + `commit_sha`; live edit streaming over sockets; step permalinks with diffs.
- [ ] **2. Fork, handoff, rewind** — fork-at-step pointer, `session_branch`, driver lock, sandbox rebuild from any checkpoint.
- [ ] **3. Collaboration** — @mentions/comments on steps and lines, `explain_line`, blame-to-prompt, "can't undo" list.
- [ ] **4. Local clone** — clone tokens, push events → human steps.
- [ ] **5. Subchannels** — channel fork pointers, context seeding.
- [ ] **6. Compare forks** — side-by-side diffs and preview URLs, promote one to a PR.
- [ ] **7. Co-editing** — Yjs live layer, sandbox bridge, file watcher.
- [ ] **8. Coding agent CLIs** — adapter interface, Claude Code + Codex adapters, native session snapshots, credential modes — see §12.

## 10. Open questions

- Code-channel interaction design: layout of chat, editor, file tree and preview (still unresolved per `product-direction.md`).
- Is single-driver strict, or can two people take turns prompting one agent?
- Retention for abandoned rewind branches and forks.
- Repos not on GitHub: support git-host-only projects (new projects, V2 generated apps)?
- Per-workspace budget for sandbox, git-host and embedding usage.
- What rewinding past a human's locally pushed step means.

### Git host: Cloudflare Artifacts vs Code Storage (Pierre) — decide at phase 1

Both are managed, API-first git hosts with real clone URLs, so either fits behind the
checkpoint interface. Decide with a 1–2 day spike against a real repo, not on paper.
Comparison as of 2026-10-05 (Code Storage details from search results, not its docs —
verify):

| | Cloudflare Artifacts | Code Storage (Pierre) |
|---|---|---|
| Maturity | Open beta (Oct 2026) | In production (Lovable, Bolt, Amp, Poke…) |
| Vendor | Cloudflare — stable, broad platform | Small focused startup — more vendor risk |
| Local clone | Repo-scoped tokens | JWT-authenticated remote URLs |
| GitHub mirror | Import only; we keep it fresh | Built-in GitHub Sync (GitHub = source of truth, webhook-driven, can forward writes back; also GitLab/Bitbucket) |
| Session branches | Branches / `fork()` | Ephemeral branches (git namespaces) |
| Read code without a sandbox | `readFile`, commits; search "coming" | grep, glob archives, file streaming, commit/merge APIs |
| SDKs | Workers binding + REST; TS/Go/Python announced | TS (`@pierre/storage`), Go, Python |
| Events | Cloudflare Queues (needs a Worker) | Webhooks (fits Node/Hono) |
| Data residency | US/EU per namespace | Region chosen per org at setup; EU availability unconfirmed |
| Big-repo mounts | ArtifactFS | ArtifactFS works with any git remote |
| Self-host | No | Not found |
| Pricing | $0.15/1k ops (10k free), $0.50/GB-mo (1 GB free); Workers Paid | Plans from $20/$200 mo; warm $1/GB-mo **per replica**, cold $0.05/GB-mo after 7 days unread |

**Leaning strongly: Code Storage** — its documented agent patterns (below) are this
design almost verbatim, and GitHub Sync + ephemeral branches + server-side APIs remove
work we'd otherwise build. Artifacts wins on vendor size and confirmed EU residency.
Confirm in the phase-1 spike.

Code Storage checks (researched 2026-10-05 from the SDK repo `pierrecomputer/sdk`
`skills/code-storage/SKILL.md`, the docs pages GitHub Sync, Organizations, Webhooks,
Capture/Restore Agent State and Run Parallel Attempts, plus search results):

1. **Session branches stay off GitHub — resolved.** The ephemeral namespace
   (`REPO_ID+ephemeral.git`, `ephemeral: true` on commits/reads) has "no GitHub sync".
   Promotion to a real branch is explicit (`createBranch` with `base_is_ephemeral`).
   Notes are never synced to GitHub either.
2. **GitHub Sync credentials — resolved: bring our own GitHub App.** We create the app and
   give Code Storage its App ID, private key and webhook secret. Permissions: Metadata
   read; Contents read (one-way) or read/write (bidirectional); Workflows only if pushes
   touch `.github/workflows/`. Code Storage requests no fixed permission set — it uses
   whatever the installation grants. GitHub webhooks can go to Code Storage, or to **our
   own handler that calls `pullUpstream()`** (Lor already receives GitHub App webhooks).
   Decision for implementation: Code Storage would hold an app private key, i.e. act as
   that app on every customer installation. Options: give it Lor's existing app (one
   install for customers, broader blast radius) or a dedicated minimal "Lor Code Sync"
   app (Contents + Metadata only, but a second install). Also: sync is two-way — any push
   to the normal namespace is forwarded to GitHub, and syncs copy only `refs/heads/*`
   and `refs/tags/*`.
3. **Compliance — mostly resolved.** SOC 2 Type II, HIPAA, GDPR-ready; per-tenant
   encryption; single-tenant option on the Scale plan. Region is selected per org at
   creation ("select a region if setup asks for one"; `meta.get` reports provider and
   region) — EU availability still to confirm with support@pierre.co.
4. **Pricing — resolved, sources conflict.** Pricing page (via search): hot storage
   $0.005/GB/hr (~$3.65/GB-mo, replication included), cold $0.0002/GB/hr (~$0.15/GB-mo)
   after 7 days unread, bandwidth $0.06/GB in and $0.15/GB out, no per-operation fee,
   unlimited request rates. An older source quoted $1/GB-mo per replica. Every sandbox
   clone is billed as egress, unlike Artifacts' per-operation model; session repos are
   small, so likely minor either way — model it during the spike.

Code Storage capabilities that fit this design (from the API reference):

- **We mint JWTs with our own private key** (no token-issuing API call), and JWTs carry
  **per-ref policies** (`no-push`, `no-force-push`, `verify-sig`). A local-clone token
  can be restricted to pushing only the session's branch — Artifacts' tokens are
  repo-wide.
- **Commit API without a sandbox** (`commit-pack`, with `expected_head_sha` as an
  optimistic lock) — Yjs flushes and human edits could commit directly from the server.
- **Blame, grep, diff, archive, merge and merge-preview APIs** — `explain_line`,
  fork comparison and "sync with dev" without booting a sandbox.
- **Forks are one-time copies within the same org**; branches remain the per-session unit.

Their documented agent patterns map onto §5 directly:

| Their guide | Our flow |
|---|---|
| Capture Agent State — one ephemeral branch per session, one commit per state, backend stores repo + branch + tip SHA, `expectedHeadSha` rejects concurrent writers | Each step → commit; `commit_sha` on the step |
| Confine a sandbox — short-TTL credential with `refPolicies` limited to the session's own ref; private key never enters a sandbox | "Agent never holds a push token" — sandboxes can even push, but only to their own session branch |
| Restore Agent State — clone, `fetch <tip>`, continue; stale old sandbox gets `precondition_failed`; `no-force-push` on the session branch; record new owner | Handoff / take over / rebuild sandbox from a checkpoint |
| Run Parallel Attempts — several ephemeral branches from one SHA (ref-only, no object copy), compare diffs, promote winner to a normal branch, delete the rest | Fork, rewind branches, compare forks, ship |
| Show Live Diffs | Step permalinks / live diff view |

Implementation gotchas noted from the docs:

- Promoting an ephemeral branch to a normal branch **pushes it to GitHub** (normal-namespace writes are forwarded) — that is our "ship" step, so only promote what should land on GitHub.
- Promotion via `createBranch()` does **not** upload LFS objects to GitHub; push LFS-tracked files through a normal ref.
- First sync of a new repo returns `409` until done (retry); later reads may be briefly stale until `repo.sync.succeeded`.
- Webhooks: `push` (ref, before, after) and `repo.sync.started|succeeded|failed`, HMAC-signed (`X-Pierre-Signature`, SDK `validateWebhook`). Verify `push` fires for ephemeral refs — needed to turn local pushes into steps.

## 11. Code index (answer code questions without a sandbox)

Cursor-style semantic index of each connected repo, refreshed on every push, plus
direct read tools — so most "where / how does X work" questions never boot a sandbox.
Assumes Code Storage GitHub Sync (§10); does not depend on code channels.

**Pipeline (default branch only):**

```
GitHub push → Code Storage sync → `push` webhook (before, after)
  → getCommitDiff(before, after)      changed paths
  → getFileStream(path, ref: after)   changed files only — no clone, no sandbox
  → tree-sitter chunking              functions, classes, components, routes
  → content-hash per chunk            unchanged chunks are never re-embedded
  → embed new chunks                  same model as brain/sources (Qwen3 Embedding 4B)
  → upsert `code_chunk`               repo, path, symbol, kind, line range, commit, text, hash, embedding
```

The first index walks the full file list once; afterwards each push touches only changed
chunks.

**Reuse:** same shape as `brain`, `source` and `attachment_chunk` — pgvector `halfvec` +
HNSW, `tsvector` full-text for hybrid search, and the reranker from
`reference/attachment-search.md`. New work is tree-sitter chunking and the push worker.

**Tools for Lor (no sandbox):**

| Tool | Backed by | For |
|---|---|---|
| `search_code` | hybrid vector + full-text over `code_chunk`, reranked | conceptual lookup ("where are billing retries handled") |
| `grep_code` | Code Storage `grep` | identifiers, exact strings, error messages |
| `read_file` | Code Storage `getFileStream` with line ranges | reading what search found |
| `blame` / `history` | Code Storage `blame`, `listCommits` with `path` | who changed it, when, why |

The sandbox (`investigate_code`, code sessions) stays for anything that must *run* code —
builds, tests, reproductions, edits, very large analyses.

**Decisions:**

- Hybrid search (vector + full-text), never vector-only — identifiers and exact strings need lexical match.
- Index the default branch only. Inside a code session, query the default-branch index and overlay the session's own changes (branch diff + grep on the session branch).
- Store and embed metadata with each chunk: path, symbol name/kind, enclosing class/module, imports. Optional later: LLM file/directory summaries for broad questions.
- Skip secrets and noise: `.env*`, lockfiles, vendored/generated code, `node_modules`, build output, binaries.
- Enforce workspace + repo access on every query; delete all chunks when a repo is disconnected.
- Cost is dominated by the first index of large repos; incremental pushes are small.

## 12. Coding agent CLIs (Claude Code, Codex) and subscriptions

Researched 2026-10-05. Not legal advice; both vendors changed policy in 2026 — recheck
before building.

### Adapters

Lor already runs Pi headless in Blaxel (print mode, JSON events, session resume).
Claude Code and Codex have the same shape, so support is a generalisation:

| Capability | Pi (today) | Claude Code | Codex |
|---|---|---|---|
| Headless | `--print` | `claude -p` | `codex exec` |
| Event stream | JSON events | `--output-format stream-json` | `--json` |
| Resume | `--session-id` | `--resume <id>` | `codex exec resume <id>` |
| Lor tools | — | MCP config | MCP config |
| Skip own prompts (sandbox is the boundary) | `--no-approve` | `--dangerously-skip-permissions` | full-auto / sandbox flags |

Verify flags against each CLI's docs at implementation time.

- **Adapter interface:** `buildCommand`, `parseEvent` → Lor's neutral event format (text, tool start/end, file edit with old/new text, usage), `sessionId`, `resume`, `fork`. `runPi` in `sandbox/blaxel.ts` becomes the first adapter.
- **Image:** add the CLIs to `packages/lor/sandbox-image/Dockerfile`, exact-pinned like Pi.
- **Transcripts:** stored in the neutral format (§4), so step permalinks, mentions and blame-to-prompt work for every CLI.
- **Fork/rewind need native session files:** Claude Code JSONL under `~/.claude/projects`, Codex sessions under `~/.codex/sessions`. Snapshot the native file per step (referenced from the step) and restore it to fork or resume. Never edit those files — formats are undocumented.
- **Switching CLI mid-session is lossy:** the new CLI starts fresh from a neutral-transcript summary plus the current code. Lock one CLI per fork; show it in the UI.
- **Live edits:** Claude Code `Edit`/`Write` events carry old/new text → Yjs ops; Codex patch/file events or the file watcher. Claude Code hooks can also route approvals into Lor.
- **Lor as an MCP server** (memory search, ask a teammate, approvals) gives every CLI Lor's context without per-CLI code.
- Same security rules: no push token in the sandbox, credentials per process, egress allowlist.

### Credentials and subscriptions

The problem is not cloud execution; it is **Lor, a third-party product, using a person's
consumer subscription on their behalf**.

- **Anthropic (Pro/Max): not allowed.** Third-party developers may not offer Claude.ai login or route requests through Free/Pro/Max credentials, and may not collect, store or intermediate Claude.ai credentials or session tokens; products must use API keys (Console, Bedrock, Vertex). Enforced in 2026 against tools that extracted OAuth tokens. Customers provisioning **their own API keys** is explicitly allowed.
- **OpenAI (ChatGPT plans):** Codex supports Sign in with ChatGPT, but for third-party apps "Sign in with ChatGPT" is a limited partner preview (DevDay 2026). Treat a user's ChatGPT login in our sandbox as not allowed unless accepted into the program.
- **How Conductor does it:** runs the official CLI and uses whatever login the machine already has; Conductor Cloud says you bring your own subscriptions or keys. Running the real `claude` binary on any machine is treated as using Claude Code itself; extracting or intermediating tokens is what's banned. Cloud is still grey: a token on a vendor-run disk is arguably "stored", and Pro/Max assumes ordinary individual use.
- **Why Lor is stricter than Conductor:** teammates watching or steering, handoff, forks and Loops would put one person's subscription to team or autonomous use. Any subscription use must stay bound to that one person; a handoff switches to the recipient's own credentials; background runs never use a subscription.

| Mode | How | Status |
|---|---|---|
| Lor-billed | Lor's API keys, metered through the usage ledger | Allowed |
| Bring your own API key | Workspace admin adds Anthropic / OpenAI / Bedrock / Vertex key; billed to the customer | Allowed |
| Sign in with ChatGPT | OpenAI's official partner flow | Only once accepted |
| **Lor local runner** | Small Lor app on the user's machine runs *their* Claude Code / Codex with *their* login; Lor orchestrates and streams; checkpoints still go to the git host | Lowest-risk subscription path — official CLI, user's machine, Lor never touches the token |
| Login inside a cloud sandbox | User signs in via the vendor's flow in their own isolated sandbox; Lor never reads or shares the token | Grey — ban risk, policy may change |
| Collect the user's token | e.g. pasting `CLAUDE_CODE_OAUTH_TOKEN` | Banned |

**Recommendation:** ship Lor-billed + BYO API key; email Anthropic and OpenAI partnerships
for written approval of subscription access in a team product; if customers want
subscriptions, build the local runner (it fits §5 — the runner clones the session branch,
pushes steps back, and a handoff resumes on the recipient's runner with their own
subscription).

## Sources

- [Artifacts: versioned storage that speaks Git](https://blog.cloudflare.com/artifacts-git-for-agents-beta/) (2026-04-16)
- [We want you to build the next Git platform on Cloudflare](https://blog.cloudflare.com/next-git-platform-on-cloudflare/) (2026-10-01)
- [Code Storage docs index](https://code.storage/docs/llms.txt) and SDK/API reference [`pierrecomputer/sdk`](https://github.com/pierrecomputer/sdk)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) · [The Register: Anthropic clarifies ban on third-party tool access](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- [Codex authentication](https://learn.chatgpt.com/docs/auth) · [Codex CLI](https://developers.openai.com/codex/cli)
- [Conductor: Claude Code harness](https://www.conductor.build/docs/reference/harnesses/claude-code) · [Introducing Conductor Cloud](https://www.conductor.build/changelog/0.78.0-introducing-conductor-cloud)
