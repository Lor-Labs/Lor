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
| **Checkpoint** | State after a step = conversation up to the step (Postgres) + a code commit (Artifacts). |
| **Base branch** | The GitHub branch work starts from and ships back to (e.g. `dev`). Never live-edited. |
| **Session branch** | The Artifacts branch the session works on, e.g. `sessions/homepage-a1b2`. |
| **Driver** | The one person (plus their agent) currently steering a session. |

**The primitive:** after every step, commit the code and record that commit on the step. Every feature above is built from it.

## 3. Where things live (locked)

| Layer | Holds | Why |
|---|---|---|
| **Postgres** | Chat, both agents' full transcripts (Lor + coding sub-agent), steps, fork/branch tree, rewind branches, driver lock, mentions/comments, permissions, `commit_sha` per step | Shared, queryable, permissioned, deletable team data. Forks are parent pointers over immutable rows. |
| **Cloudflare Artifacts** (managed) | Session branches; one commit per code-changing step | Real git remote (local clone), cheap branches/forks, push events, ArtifactFS. |
| **Yjs** (`apps/realtime`) | Live docs for files open in a session | Concurrent-edit merging. Live layer only — never the durable store, never forked. |
| **Sockets** (existing) | Agent edit stream, presence, notifications, Yjs transport | Already built. |
| **Blaxel** | Disposable runtime; live preview URLs | Rebuilt from any checkpoint. Never source of truth. |
| **GitHub** | Base branch; final PRs | The team's real repo. Lor writes only on publish. |

Locked decisions:

- **Conversation in Postgres, code in Git, joined by `commit_sha` on the step.** Commits are content-addressed and immutable, so the pointer cannot drift; a crash between push and row write leaves a harmless orphan commit.
- **Artifacts sits behind a checkpoint interface** (`saveCheckpoint`, `restore`, `fork`, `getCloneUrl`). Artifacts is not self-hostable (only ArtifactFS is open source); Forgejo or a thin `git http-backend` endpoint are the swap-in fallbacks (e.g. a customer requiring code in their own cloud).
- **The agent never holds a push token.** Lor commits and pushes from its own commands with an explicit refspec (same rule as `propose_code_change` today).
- **Nothing in the sandbox is the only copy of anything.**
- **Preview URLs come from the sandbox (Blaxel), not Artifacts.** Workers Builds previews only apply to Workers-hosted projects (possibly V2 generated apps).

## 4. Data model (sketch)

```
code_session
  id, workspace_id, channel_id, repo_id
  artifacts_repo, branch             -- session branch on Artifacts
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
1. Mint a scoped GitHub token; import the repo into Artifacts (or sync the existing mirror); create the session branch from `base_branch` @ head.
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
- New `code_session` with `parent_session_id` + `forked_at_step_id`; new Artifacts branch at that step's commit.
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
- A push back from a laptop becomes a human step: an Artifacts push event → Lor records a step with that commit → open live docs reload → the agent's next run sees the change.
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
- Agents never hold Artifacts or GitHub push tokens; Lor pushes with an explicit refspec.
- Artifacts tokens are repo-scoped and short-lived; local-clone tokens are per-user and revocable; GitHub tokens are minted only to import and publish.
- Transcripts are redacted for secrets before persisting; tool outputs are capped.
- Customer code is stored at Cloudflare: disclose it, and pick the Artifacts namespace jurisdiction (US/EU) at creation — it is fixed per namespace.

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

- [ ] **1. Durable sessions** — persist the coding sub-agent transcript to Postgres; checkpoint interface on Artifacts; per-step commit + `commit_sha`; live edit streaming over sockets; step permalinks with diffs.
- [ ] **2. Fork, handoff, rewind** — fork-at-step pointer, `session_branch`, driver lock, sandbox rebuild from any checkpoint.
- [ ] **3. Collaboration** — @mentions/comments on steps and lines, `explain_line`, blame-to-prompt, "can't undo" list.
- [ ] **4. Local clone** — clone tokens, push events → human steps.
- [ ] **5. Subchannels** — channel fork pointers, context seeding.
- [ ] **6. Compare forks** — side-by-side diffs and preview URLs, promote one to a PR.
- [ ] **7. Co-editing** — Yjs live layer, sandbox bridge, file watcher.

## 10. Open questions

- Code-channel interaction design: layout of chat, editor, file tree and preview (still unresolved per `product-direction.md`).
- Is single-driver strict, or can two people take turns prompting one agent?
- Retention for abandoned rewind branches and forks.
- Repos not on GitHub: support Artifacts-only projects (new projects, V2 generated apps)?
- Per-workspace budget for sandbox and Artifacts usage.
- What rewinding past a human's locally pushed step means.

## Sources

- [Artifacts: versioned storage that speaks Git](https://blog.cloudflare.com/artifacts-git-for-agents-beta/) (2026-04-16)
- [We want you to build the next Git platform on Cloudflare](https://blog.cloudflare.com/next-git-platform-on-cloudflare/) (2026-10-01)
