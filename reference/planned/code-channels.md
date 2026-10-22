# Code channels — shared harness sessions with a code workspace

> Status: design, not built. Updated 2026-10-21: the product shape (Chat and
> Code modes, repositories, pickers, Loops, instruction files) is in §2 "Modes
> and repos"; there is no separate code channel type. Updated 2026-10-22: people,
> not Lor, commit and open PRs, and the coding child agent is deleted (§2). The shared runtime and implementation
> sequence now live in [harness-sessions.md](harness-sessions.md): convert the main
> Lor loop to Pi first, then add durable workspace checkpoints and other official
> harnesses. This document covers code-specific collaboration. The original
> Postgres-only native-transcript rule and late CLI phase are superseded.
> Broader priorities: [product-direction.md](../product-direction.md).

## 1. Goals

- Live agent edits, with opt-in human co-editing.
- Inspect a completed turn's prompt, actions and diff; mention a teammate there.
- Share, fork and rewind conversation plus workspace together without overwriting another person's work.
- Clone code locally and publish finished work to GitHub as a PR.
- Use the same Lor session model for chat, cowork and code work; every agent chat gets an isolated sandbox from its first run, reused across turns with standby between runs.

## 2. Concepts

| Term | Meaning |
|---|---|
| Code session | A session started in Code mode, with one repository and base branch chosen at the start. Any channel can hold code sessions; channel membership controls access. |
| Default repositories | Optional channel setting that preselects the repository and base branch in Code mode. A "code channel" is only a channel with a default repository, not a channel type. |
| Session | Existing `agent_session` with a selected harness and isolated sandbox-backed workspace, optionally bound to a repository. |
| Recovery step | An internal model/tool iteration or equivalent native progress boundary. Current `agent_run_step` uses this meaning. |
| Product checkpoint | State after a completed user turn, potentially many recovery steps, or a committed human workspace change. |
| Checkpoint state | Visible history boundary + native harness state + workspace revision + resource versions + external-effect references. |
| Base branch | The GitHub branch work starts from and ships back to. Never live-edited. |
| Session branch | An isolated line of conversation and workspace history; code revisions live on the Git host. |
| Turn starter | The person whose message starts a Lor turn; that turn uses their credentials, sandbox permission mode and billing. Anyone in the session can type, so there is no single driver. Worker/workspace ownership is separately lease controlled. |

Every completed turn gets a checkpoint even if code did not change. In that case
reuse the prior file revision and save the new native/history boundary. Product
checkpoints do not replace durable recovery during long turns.

### Modes and repos (decided with Jacob, 2026-10-21; revised 2026-10-22)

Chat and code sessions are one session model with two modes and two layouts.
Both support forks and multiplayer the same way.

- **Pick the mode at the start.** The New session prompt box has a
  `Chat | Code` switch. It remembers each person's last choice, and the mode is
  fixed for the life of the session. Chat includes cowork (sandbox, files,
  plans, connectors). Code adds a repository and base branch. The rule the UI
  teaches: Chat to ask, research, write and make files; Code to change a
  repository and open a PR. Chat sessions read code through the code index
  (§11) without Code mode. Until the index exists, `clone_repo` clones a
  connected repository read-only into any session's sandbox
  ([pi-harness-runbook.md](pi-harness-runbook.md) 1.4); nothing in a chat
  session commits. Decide whether chat keeps `clone_repo` when the index ships
  (2026-10-22).
- **One repository per code session**, chosen at the start. Code mode
  preselects the channel's default repository or the person's last one. Any
  channel can start code sessions on any repository the workspace connected.
  The base branch defaults to the channel's default for that repository, or
  else the repository's default branch; the session works on its own branch,
  and Create PR ships it. The old workspace per-repository setting
  (`github_repo_config`) is deleted (2026-10-22). Multi-repository sessions
  come later.
- **The work folder is the repository root** from the first turn
  (`/workspace/pi-<sessionId>` in phase 1; never a shared fixed folder, see
  [pi-harness-runbook.md](pi-harness-runbook.md) §4.9). Official harnesses
  expect the same.
- **Chat to code is a handoff.** "Continue in Code" opens a new code session
  with the chat session linked as context, like "Ask Lor about this". Lor
  suggests it with a card that shows the repository and a short brief; one
  click opens the code session with the brief as its first message. Lor never
  switches by itself, and no tool call turns a chat session into a code
  session (confirmed 2026-10-22). In-place conversion is out for v1, because
  the work folder would change mid-session and break the paths in the saved
  history. Jacob would prefer fluent switching (for example, Loops without a
  repository choice); revisit it later.
- **People ship; Lor does not** (Jacob, 2026-10-22).
  - Lor has no commit, push or pull-request tool. The session's main agent
    does all code work in the session sandbox; there is no coding child agent
    (the old `investigate_code` and `propose_code_change` are deleted). When
    the work is ready, Lor mentions the person who asked so they review it.
  - A person reviews the diff and clicks Commit or Create PR in the session.
    By default it goes out under their own GitHub account, through the GitHub
    App's user authorization. Someone who has not connected GitHub is asked
    to connect it. A setting lets them commit as the Lor bot instead; those
    commits show the bot, not the person.
  - Lor runs the push itself with explicit refspecs; no push credential
    enters the sandbox (§3).
  - To verify before design: GitHub App user access tokens (expiry, refresh,
    commit attribution).
  - Loops never commit or open PRs by themselves (below).
- **`@Lor` in channel chat always starts a chat session.**
- **Everyone types**, as in chat sessions. One Lor turn runs at a time; other
  messages queue or steer.
- **Two layouts, one session system.** Sidebar rows, states, subscriptions,
  archive and approvals work the same. A code session row shows a code icon
  and the repository name. The code layout shows the conversation, a changes
  (diff) panel, the file tree, a preview and the PR status.
- **Pickers.** Code mode shows harness and model pickers. Chat uses the
  workspace default model. People who connected a personal subscription
  (Claude, ChatGPT) also see a harness picker in chat, so their own plan pays
  for ordinary chat. This arrives with the official harnesses in phase 2 and
  depends on the vendor eligibility check in
  [harness-sessions.md](harness-sessions.md) §7.
- **The harness is fixed per session; the credential is per turn.** A turn
  never uses another person's subscription. A teammate without that
  subscription runs their turn on the same harness through Lor's AI Gateway
  key, charged to workspace credits; the Claude Code and Codex adapters both
  have an `ai-gateway` auth mode. The composer shows who pays before sending.
  Phase 2 check: one native session continues when the credential changes
  between turns.
- **Code Loops start a new code session per fire** (Jacob, 2026-10-21). Chat
  Loops stay one recurring session; this matches connector triggers, which
  start a session per event.
  - The person says what they want in words: the repository and the branch
    to start from. The `propose_loop` card shows these as fields to confirm.
    Defaults: the channel's default repository and base branch.
  - The work always stays in the fire's session for review. A Loop never
    commits, pushes or opens a PR by itself (Jacob, 2026-10-22; this removed
    the earlier setup option to push to a named branch or open a PR, which can
    come back later). If it comes back, unattended commits go out as the Lor
    bot, because no person reviewed the work.
  - Each fire's session subscribes the Loop's subscribers (the creator, people
    mentioned at setup, or everyone in the channel) and shows "needs you" when
    the work is ready. They review it, talk to Lor, and commit or open the PR
    from the session under their own identity ("People ship" above).
  - Each fire gets a short brief of recent fires (session links, outcomes,
    review state), so it does not redo unreviewed work. A fire runs even when
    earlier fires still wait for review.
  - Fires are autonomous: classifier-only sandbox mode and workspace billing.
- **Mobile matches web** for code sessions: conversation, diffs, preview,
  approvals and PRs. Only the opt-in live editor (§6) may stay web-only.
- **Repository instruction files.** At the start of a turn, Lor reads the
  repository's `AGENTS.md` and `CLAUDE.md` from the sandbox and adds them as a
  labeled "Repository instructions" section after Lor's own rules. Repository
  skills join the skills catalogue (self-configuration work). This matches
  Claude Code, Codex and OpenCode. The files guide work in that repository;
  they cannot change permissions, approvals or sandbox safety checks, because a
  pull request can edit them. Pi's own loading stays off: it reads the
  worker's disk above the work folder and copies only some of the files
  (pi-harness-runbook.md §4.9). Repository files still never become workspace
  instructions (`LOR.md`, [agent-harness.md](../agent-harness.md)).

## 3. Storage and ownership

The agreed split is Postgres-owned Pi session state and private Git workspace
revisions. See [the shared-session storage decision](harness-sessions.md#4-agreed-storage-postgres-session-state-private-git-workspace-files).

| Layer | Responsibility |
|---|---|
| Postgres | Durable common message/tool/file-activity history for every harness, collaboration records, permissions, approvals, session/branch/checkpoint pointers, usage and external-action receipts. Native-derived UI/search data is a projection, not a replacement for native resume state. |
| Native recovery data | Exact Pi state in Postgres, behind a versioned interface. Official harnesses retain their supported native payloads referenced by the checkpoint. No second full normalized raw archive. |
| Private Git host | Versioned workspace files and cloneable code branches. Checkpoints pin immutable commit SHAs; branch names identify moving lines of work. |
| Yjs / sockets | Live edits, presence and event delivery. Rebuildable live state, not the checkpoint source of truth. |
| Sandbox | Disposable execution environment restored from durable references; previews originate here. |
| GitHub | Upstream code and final PRs. Native transcripts and private Lor state must not be published with code. |

- Keep Git behind `saveCheckpoint`, `restore`, `fork` and `getCloneUrl` operations; choose the vendor during shared-session phase 2.
- Lor controls commits/pushes with explicit refspecs; the agent never receives the app's or a person's push credential.
- Completed checkpoints must survive loss of the sandbox. An unfinished turn can still contain uncommitted work; recovery and draft retention must handle that honestly.
- One native recovery source at a time. Database display/search projections may repeat text without becoming a second resume authority.

## 4. Data model (sketch)

Extend the existing session rather than introducing an independent `code_session`:

```text
agent_session                         -- existing product identity
  active_branch_id, driver_user_id

session_workspace                     -- optional repo binding / execution identity
  session_id, repo_id, base_branch, base_commit
  git_repo, active_workspace_epoch

session_branch
  id, session_id, parent_branch_id, forked_at_checkpoint_id
  harness_kind, harness_version, head_checkpoint_id
  writer_generation

session_checkpoint                    -- immutable once published
  id, session_id, branch_id, parent_checkpoint_id
  visible_history_boundary, run/recovery_boundary
  native_state_ref, native_leaf_id, workspace_revision
  instructions/resource_versions, context/memory_revision_refs
  external_effect_receipt_refs, publication_status
```

Exact schema names and normalization are implementation details. Preserve existing
legacy `agent_run_step` history; new runtime recovery must not depend solely on a
normalized display transcript. Native session IDs are insufficient unless their
referenced data survives process and sandbox loss. Parent pointers must terminate
at the chosen checkpoint, including the compaction baseline used there.

## 5. Flows

### Start and continue

1. Create/use the ordinary Lor session and resolve runtime, driver and billing identity.
2. For repository work, mirror/import the authorized base revision and create an isolated workspace branch.
3. Provision the session sandbox on its first agent run; later runs reconnect to that workspace and restore committed native state. This applies to every agent chat and harness. A new request does not imply a fresh workspace; standby between runs is allowed.
4. Run through the same scoped Lor services and coordinator as any chat/cowork session.

### Complete a turn

Finish or stop all active writers; queue new writes; flush accepted live edits;
store native state and files; verify their durable references; then publish the
checkpoint with an ownership/previous-head check. Resume queued edits afterward.
The [full protocol](harness-sessions.md#publish-a-consistent-checkpoint) also covers
stale workers and crashes between Git writes and database publication.

### Watch, mention and inspect

Each checkpoint has a permalink to its prompt, actions, diff and usage. A Git
commit can carry a `Lor-Checkpoint` trailer for blame-to-prompt navigation. Native
history remains private to authorized session viewers; local code access does not
implicitly grant access to the entire transcript.

### Handoff and fork

- Share/fork creates a new branch or session at a completed checkpoint, leaving the original intact. There is no takeover: everyone in the session can type (§2).
- Same-harness forks use supported native operations plus workspace restoration.
- Cross-harness forks start a new native session with authorized context through that checkpoint and the same files. Preserve inherited visible history, but label this as a context handoff; proprietary native state and hidden reasoning are not portable.
- Forks use the recipient's credentials and current grants, never the original driver's. No pending approval transfers. Fork visibility must not exceed the parent's authorized scope.
- Forks of forks use checkpoint parent pointers; an end-of-session pointer is not enough.

### Rewind

Rewind creates a branch from checkpoint N and makes it active; later branches
remain available. Restore both files and native context. Exclude later transcript,
compaction summaries, steering and working notes, including optional abandoned-
branch summaries. Pin historical session context where available and treat fresh
live-memory/connector reads as new input. Shared memories, PRs, issues and messages
sent elsewhere are not rolled back; expose their external-effect receipts.

Proposed 2026-10-21, to match "everyone types": anyone who can type in the
session can rewind it. Later branches stay available, and the session shows who
rewound. Branch deletion/retention is separate from rewind and must account for
inherited history.

### Local clone and push

The Lor CLI is deferred. Its future flow restores and transfers the authorized conversation and
native runtime state through Lor's API. This enables local/cloud handoff of a
complete checkpoint; Git clone/push alone transfers only files. See the
[CLI flow](harness-sessions.md#lor-cli-local-and-cloud-execution-of-the-same-checkpoint).
Local uploads append missing records when the shared ancestor is still current;
divergent continuations become forks. External sessions without matching historical
file snapshots cannot acquire full past checkpoints from a transcript alone.

Issue a per-user revocable code-clone credential. A push becomes a committed human
workspace change only after Lor accepts it through the workspace coordinator.
Queue/reject active-branch writes while an agent or checkpoint owns the workspace,
or accept the push to a separate candidate branch and integrate later. A normal
fast-forward check does not detect uncommitted agent work and is insufficient.
If the vendor cannot enforce this on the active branch, do not expose direct push
access to that branch. Reload live documents at the accepted revision.

### Subchannel, sync and ship

Subchannels seed authorized parent context through a chosen boundary and get an
isolated workspace. Syncing the base branch is a coordinated workspace change.
Publishing exports the code diff and opens a GitHub PR with a Lor session link;
private native session files and credentials never accompany that export.

## 6. Live editing (Yjs)

- Room identity includes session, branch and workspace epoch, e.g. `code:{sessionId}:{branchId}:{epoch}:{path}`. A rewind must not reconnect to stale documents.
- Load documents lazily from the active workspace revision. Tool edit events and filesystem watchers bridge agent, formatter and other command changes into the live view.
- Human edits reach the sandbox through the same workspace coordinator. Stale tool edits fail and require rereading rather than overwriting a newer version.
- At checkpoint time, establish an accepted-operation boundary, briefly queue new edits, flush documents to files and publish the snapshot. A watcher is not a writer lock.
- Watch mode is the default; co-editing is opt-in. Semantic conflicts still need presence and product handling even when the CRDT merges text.
- Fork/rewind creates a fresh live layer. Yjs does not own durable branch history.

## 7. Security and permissions

Session scope, tool grants and paying identity are separate concerns and must all
be resolved per run. Credentials are never snapshotted or inherited. Recheck
current authorization when restoring historical state. Scope Git credentials and
local clones to their actual purpose; a private transcript store needs its own
access boundary. Define safe native-state retention/redaction without breaking
restore structure. Vendor region, code residency and backup/deletion behavior are
part of the storage decision.

## 8. Alternatives and corrections

| Alternative | Assessment |
|---|---|
| Native conversation and filesystem in Git | Valid but not chosen for Pi. Cloudflare explicitly supports shared sessions and coworker forks; the old single-player dismissal was incorrect. |
| Postgres for native Pi history + Git for files | Chosen for Lor. Database checkpoints bind native context to immutable file revisions; the same contract supports cloud and local execution. |
| Immutable object storage for native snapshots | Possible payload storage for official harness adapters; not a planned migration of Pi history out of Postgres. |
| Postgres only for workspace files | Would rebuild Git's clone/diff/branch behavior. Keep Git for code work. |
| Customer GitHub for every checkpoint | Adds private-state exposure, branch noise and potential CI/rate-limit effects. Keep internal checkpoints separate from explicit publication. |
| Native file rewind alone | Does not reliably restore all shell/subagent changes or conversation state. Lor coordinates both. |
| Channel-scoped live docs | Breaks isolation across sessions, forks and rewinds. |

## 9. Build phases

The authoritative sequence is in [harness-sessions.md](harness-sessions.md#6-implementation-sequence):

- [ ] **1. Pi primary runtime:** same session model for chat/cowork/code; scoped tools, memory, approvals, budgets, native persistence, skills/commands and adapter capabilities from the start.
- [ ] **2. Durable workspace checkpoints and official adapters:** storage decision, writer ownership, snapshot manifests, sandbox restoration, Claude Code/Codex adapters and eligible auth.
- [ ] **3. Fork/handoff/rewind:** native forks and cross-harness context handoffs at completed checkpoints; historical views and external effects.
- [ ] **4. Code collaboration:** permalinks/diffs/mentions, local clone and coordinated pushes, subchannels, comparison/PRs, then opt-in co-editing. The Lor CLI and full local/cloud session handoff remain deferred.

The code index (§11) is independent. Harness support is no longer a phase-8 add-on.

## 10. Open questions and historical vendor research

- Code-session layout details; the shape is in §2.
- Retention/deletion of branches and inherited history, including private native data.
- Non-GitHub projects, runtime/storage budgets and historical views of human pushes.
- Official-harness payload storage, safe code-only clone/export boundary and CLI transfer protocol; native Pi state stays in Postgres.

### Git host: Cloudflare Artifacts vs Code Storage (Pierre) — decide in shared-session phase 2

Both are managed, API-first git hosts with real clone URLs, so either fits behind the
checkpoint interface. Decide with a 1–2 day spike against a real repo, not on paper.
Historical comparison as of 2026-10-05; not reverified in the 2026-10-19
architecture update. Recheck availability, capabilities and pricing before
choosing a vendor. Code Storage details came from its SDK/API reference and
docs pages; pricing came from search results and needs verification:

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
| Pricing | $0.15/1k ops (10k free), $0.50/GB-mo (1 GB free); Workers Paid | Plans from $20/$200 mo; hot ~$3.65/GB-mo (replication included), cold ~$0.15/GB-mo after 7 days unread; $0.06/GB in, $0.15/GB out; no per-operation fee |

**Historical preference (2026-10-05): Code Storage** — its documented agent patterns (below) are this
design almost verbatim, and GitHub Sync + ephemeral branches + server-side APIs remove
work we'd otherwise build. Artifacts wins on vendor size and confirmed EU residency.
Reassess during the shared-session phase-2 storage decision; native session state is now part of the requirements.

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

## 11. Code index (read code through indexed services)

Cursor-style semantic index of each connected repo, refreshed on every push, plus
direct read tools — so most "where / how does X work" questions do not require a
repository clone or shell command. Every agent chat still has its session sandbox;
the index and read services operate independently of it. Assumes Code Storage
GitHub Sync (§10); does not depend on code channels.

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

**Tools for Lor (backed by search/storage services):**

| Tool | Backed by | For |
|---|---|---|
| `search_code` | hybrid vector + full-text over `code_chunk`, reranked | conceptual lookup ("where are billing retries handled") |
| `grep_code` | Code Storage `grep` | identifiers, exact strings, error messages |
| `read_file` | Code Storage `getFileStream` with line ranges | reading what search found |
| `blame` / `history` | Code Storage `blame`, `listCommits` with `path` | who changed it, when, why |

The shared session sandbox is available in every agent chat for work that executes
commands or edits files; these read tools do not require using it.
A coding child such as `investigate_code` is optional delegation, not a separate
required runtime. This repository's no-tests policy still applies.

**Decisions:**

- Hybrid search (vector + full-text), never vector-only — identifiers and exact strings need lexical match.
- Index the default branch only. Inside a code session, query the default-branch index and overlay the session's own changes (branch diff + grep on the session branch).
- Store and embed metadata with each chunk: path, symbol name/kind, enclosing class/module, imports. Optional later: LLM file/directory summaries for broad questions.
- Skip secrets and noise: `.env*`, lockfiles, vendored/generated code, `node_modules`, build output, binaries.
- Enforce workspace + repo access on every query; delete all chunks when a repo is disconnected.
- Cost is dominated by the first index of large repos; incremental pushes are small.

## 12. Official harnesses and subscriptions

Harness choice belongs to the shared session foundation, not a separate coding
CLI parser layer. Pi becomes the main Lor runtime first; Claude Code and Codex
use adapter-specific native persistence, lifecycle, approval and fork APIs.
Version-pinned official SDKs/protocols should be preferred where they provide the
needed control. A common event format is useful for UI, but insufficient to resume
every runtime. See [harness-sessions.md](harness-sessions.md).

Use each person's supported official authentication flow. Current Anthropic
terms allow hosting unmodified Claude Code under stated conditions with each end
user authenticating directly; the earlier blanket prohibition in this document
was too broad. This does not authorize extracting subscription tokens or making
one person's plan a shared team account. [Claude Code terms](https://code.claude.com/docs/en/legal-and-compliance)

Anthropic's Agent SDK docs also state that third parties may not offer claude.ai
login or rate limits without prior approval, and OpenAI requires an interest form
for remotely hosted apps. Vercel's adapter subscription modes read the host
user's own credential files, a single-developer feature. The hosted auth path for
each provider must be verified with the vendor before enabling it.
Recipient credentials apply after handoff; unattended Loops stay on an authorized
managed/workspace mode initially. Direct subscription-funded inference outside
the official harnesses is deferred. Pricing/eligibility details live in
[pricing-and-billing.md](pricing-and-billing.md#6-byo-api-keys-and-subscriptions).

## Sources

- [Cloudflare's versioned session and filesystem pattern](https://blog.cloudflare.com/artifacts-git-for-agents-beta/).
- [Building Git platforms on Cloudflare](https://blog.cloudflare.com/next-git-platform-on-cloudflare/).
- [Code Storage docs](https://code.storage/docs/llms.txt) and [SDK](https://github.com/pierrecomputer/sdk); §10 preserves dated research, not a current vendor recommendation.
- [Shared runtime source list](harness-sessions.md#sources-and-scope), including Pi, Vercel, Claude and Codex native session documentation.
