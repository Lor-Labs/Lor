# Code sessions runbook (launch scope)

> Status: planned 2026-10-22, nothing built. Product shape:
> [code-channels.md](code-channels.md) §2 "Modes and repos". Architecture:
> [harness-sessions.md](harness-sessions.md) phases 2–3. Builds on the Pi
> phase 1 ([pi-harness-runbook.md](pi-harness-runbook.md)). Work in reviewable
> chunks; Jacob reviews and commits each one. Update the checkboxes as chunks
> land.

## Scope decided with Jacob, 2026-10-22

What must exist before charging external users. Everything else can follow
after launch.

**In:**

- Code sessions: `Chat | Code` at the start, one repo and base branch, the
  repo is the work folder.
- **Continue in Code:** a new code session with the source session attached
  as context. It works for every harness; a native fork across harnesses is
  not possible anyway (harness-sessions.md, fork guarantees).
- **Changes window** (web), IDE-style: changed files, stage and unstage,
  diffs, a commit message written by the small model from the staged diff,
  Commit, then Push / Create PR.
- **Personal GitHub commits:** a person commits and pushes under their own
  GitHub account; the Lor bot is a setting and the fallback. Pushes run on
  the server through GitHub's API; no token enters the sandbox.
- **Checkpoints** on a private Git host after every completed turn; a lost
  sandbox is rebuilt from the last turn.
- **Rewind** to turn N (files and agent state) and **native fork** at turn N.
- **Claude Code and Codex** as harnesses (bring your own harness), with
  people's own subscriptions where the vendor allows it.
- **Repository instructions:** Claude Code and Codex load `CLAUDE.md` /
  `AGENTS.md` natively; Pi gets Lor's own loader (Pi's loading reads the
  worker's disk, runbook §4.9).

**Later:** live editor, previews, code Loops, channel default repos, multiple repos per session, mobile Changes window and commit (mobile
may lag web), a Lor-offered "Continue in Code" card.

## Stage 1 — code sessions on Pi

- [x] **1. Code mode.** Session mode, repo and base branch; the New session
  `Chat | Code` switch with a repo and branch picker; the repo cloned as the
  work folder root before the first turn; a code prompt section (edit and
  check freely, never commit or push, mention the person when ready); Pi's
  repository-instructions loader. Built 2026-10-23:
  - `agent_session.mode`, `repo_full_name`, `base_branch` (additive
    `db:push`). Realtime checks the repo at start with
    `channelCodeRepo` (`@repo/lor/code-repo`): the channel's tools include
    `clone_repo` and the GitHub installation lists the repo.
  - Repo picker: the GitHub scopes route. Branch picker:
    `GET …/channels/{channelId}/code/branches` (GitHub GraphQL `refs(query:)`).
  - Each turn, `prepareCodeWorkFolder` (`packages/lor/src/code-session.ts`)
    shallow-clones the repo into the work folder when it is missing and
    reads one instruction file in Pi's own order. A re-clone after earlier
    turns tells the model and the session that changes are gone.
  - The file reaches Pi through the patched adapter's `contextFiles` list
    (Pi's `agentsFilesOverride`), so Pi renders it in its own project
    context section. `clone_repo` is hidden in code sessions.
- [x] **2. Continue in Code.** From any session: a new code session in the
  same channel with the source session's conversation attached as its
  starting context. Built 2026-10-23:
  - The session menu opens New session with `?continueFrom=`, Code mode on
    and the channel fixed. Realtime attaches the source's newest 50
    messages as `agent_session_context` and sets
    `agent_session.source_session_id` (additive `db:push`).
  - The first turn labels them as the work being continued
    (`AgentRunContext.continuesSession`), not channel background.
  - A `session_continued` event row in the source session links to the new
    session. Its content names the new session's anchor, so Lor there can
    `read_thread` it. Only the starter follows the new session.
- [x] **3. Changes window** (web). File list against the base, stage and
  unstage, diff, a model-written commit message, Commit. Disabled while Lor
  works. Built 2026-10-23:
  - Server: `@repo/lor/code-changes` runs git in the live sandbox
    (`attachSessionSandbox`: never creates a sandbox or stops Lor's
    commands); `/sessions/{id}/changes`, `/changes/diff`, `/changes/stage`
    (409 while Lor works), `/changes/message` (small model, billed as
    `code.commit_message`).
  - Web: the `session-changes` right-panel view (Details | Changes | Files
    tabs): Tracked and Untracked lists with line counts and checkboxes,
    `@pierre/diffs` diffs (in tabs beside the chat since 3b), and a commit
    box. It refreshes as Lor's tool calls finish.
  - **Commit is a stub** (Jacob): commits wait for GitHub identity in
    chunk 4, which also adds the commit event row. No per-file discard.
- [ ] **3b. Files tab and main-area tabs** (moved into launch scope by
  Jacob, 2026-10-23; read-only, desktop web first; mobile opens a file
  full-screen):
  - [x] **F1** Files tab: `/sessions/{id}/repo/tree` (`git ls-files`,
    tracked and untracked, at most 20,000 paths) and `/repo/file` (text up
    to 1 MB; binary, too large, and paths resolving outside the repo
    reported). Tree with folders, a filter, change marks.
  - [x] **F2** Tabs beside the chat: Chat (fixed) plus file, diff and "All
    changes" tabs; the chat stays mounted. Preview tabs (single click
    reuses one); open tabs per person per session in local storage, the
    active tab in the URL. Composer on the Agent tab only.
    - Built 2026-10-23: file and diff tabs (`use-session-tabs.ts`,
      `session-tabs.tsx`). While tabs are open, the tab bar (Chat first)
      sits above the main area's card, like Linear's
      (`main-area-tabs.tsx`). The active tab is `?open=file:<path>`
      or `diff:<path>` (`?tab=` is the settings dialog's). The tab covers
      the transcript, which stays mounted but inert; type-to-focus and file
      drops pause. A double click keeps a preview tab. The Changes and Files
      lists went back to rail width.
    - "All changes" (`?open=changes`, the Changes list's View all): one
      card per file with a sticky header and its stage checkbox; each diff
      loads when it scrolls near the view.
  - [ ] **F3** Polish: link sharing, keyboard switching.
- [ ] **4. Personal GitHub and shipping.** The GitHub App's user
  authorization, stored and refreshed tokens, a connect prompt; Push and
  Create PR as the person, or as the Lor bot by setting.

## Stage 2 — before charging

- [ ] **5. Checkpoints** on the chosen Git host: a snapshot of the work folder
  after every completed turn, joined to the saved harness head; a lost
  sandbox rebuilt from the last checkpoint instead of continuing empty.
  Decided with Jacob 2026-10-23:
  - **The files on a box are the source of truth.** Every read and write
    of a session's files (Lor's turns, the Changes panel, later the file
    tree and editor) uses a live sandbox, never a read-only checkpoint
    view.
  - **One "ensure the box" function:** attach the live sandbox, or create
    one and restore the last checkpoint onto it. The worker's turn start
    and the panel routes share it; the worker adds its command fence on
    top. A lock lets only one restore run; other callers wait for it.
  - **Restore on demand:** opening the Changes panel (later the file tree),
    or sending a message. Only reading the transcript never restores. The
    panel shows "Restoring the session's files…" until it finishes.
  - **Standby stays:** idle sandboxes keep the 7-day standby, so sessions
    in regular use open at once.
  - Staging is not in a checkpoint: after a restore every change is
    unstaged.
- [ ] **6. Rewind and native fork** (Pi first): files and harness state at
  turn N; fork into a new session; the UI for both.
- [ ] **7. Claude Code** on the session contract: native state per turn,
  approvals and Lor's sandbox policy, sign-in, usage.
- [ ] **8. Codex**, the same way.

## Research (started 2026-10-22)

- [ ] Git host for checkpoints: Pierre Code Storage vs Cloudflare Artifacts
  (decide before chunk 5). Research read 2026-10-22, recommending **Code
  Storage**:
  - **Tokens:** ref-scoped JWTs signed with our own key (one session branch,
    fast-forward only).
  - **Server-side writes:** `diff-commit` with an `expected_target_sha`
    guard, so a checkpoint can be written with no credential in the sandbox.
  - **Branches** are refs only (cheap forks and rewinds).
  - **Base repos:** a shallow push of the base works; no GitHub link, so
    checkpoints never reach customer repos.
  - **SDK:** `@pierre/storage`. In production (Lovable, Bolt, Amp).
  - **Cost:** about $60/month at 1,000 sessions × 30 turns, with one repo per
    workspace repo and an ephemeral branch per session.

  Artifacts fails two requirements today: it imports public repos only, and
  its tokens cover a whole repo (one repo per session, base duplicated). It
  also has a 1 GB repo cap, is in beta, and has no Node SDK.

  Risks to test in a spike:
  - shallow base push;
  - `diff-commit` latency at real diff sizes;
  - thaw delay on repos idle more than 7 days (`409 repository_thawing`);
  - object cleanup after a branch is deleted (user deletions);
  - SOC 2 status and an EU region (both unconfirmed).

  Fallback: an incremental `git bundle` per turn in R2 (no clone URL). The
  dated table in code-channels.md §10 is outdated on Artifacts: import is
  public-only, there is a 1 GB cap, and its SDKs have not shipped.
- [ ] Vercel's Claude Code and Codex adapters: where the CLI runs, native
  state, approvals, sign-in (confirm before chunk 7). Source read
  2026-10-22. The adapters matching our harness pin are
  `@ai-sdk/harness-claude-code@1.0.162` and `@ai-sdk/harness-codex@1.0.160`.
  - **Both run inside the sandbox.** `HarnessAgent` installs a bridge,
    spawns `node bridge.mjs` and talks to it over a WebSocket on a sandbox
    port. The CLI runs its own bash and edit tools natively, outside Lor's
    `SandboxSession.run`.
  - **Credentials:** the model calls leave from the sandbox, so credentials
    enter it unless the sandbox brokers them (`addRequestTransformations`).
    Blaxel's proxy routing with injected headers may do this; not verified.
    Subscription modes read the host user's own files, so Lor must store and
    refresh each person's tokens. The bridge listens on `0.0.0.0` with its
    token in its env (possible exposure to code in the sandbox; not
    confirmed).
  - **Native state** lives in the sandbox:
    - Claude Code: JSONL under `~/.claude/projects`; resume needs the same
      work folder.
    - Codex: rollout under `~/.codex`; its thread id only appears on
      stop/suspend.

    The model's bash can edit both, and there is no trusted worker copy like
    Pi's. An approval pause leaves the bridge blocked in the sandbox; if the
    bridge dies, work in progress is lost.
  - **Approvals:**
    - Claude Code asks through `canUseTool`, so Lor can gate every call
      (best with a small patch like Pi's `builtinToolApproval`). It also
      needs `settingSources: []`, so repo settings and hooks do not load,
      and some extra built-ins filtered out.
    - Codex has no built-in approvals: per-call gating needs a bridge patch.
  - **Codex:** a changed tool list or instructions start a new, empty thread,
    so the tools and instructions must stay fixed per session. Usage comes
    per turn only (none for failed turns).
  - **Neither:** applies Gateway body options (Lor's fallback chain);
    exposes fork or rewind (the Claude Agent SDK and the Codex app-server
    have them, behind patches); or replaces the base system prompt (append
    only).
  - **Order:** a vendor-terms check and a Blaxel spike first (ports and
    previews for the bridge WebSocket, proxy header injection, process
    lifetime across standby); then the shared harness infrastructure; then
    Claude Code (about 1–1.5× Pi's harness work); then Codex (about 2×).
- [x] boat.dev as a cheaper sandbox provider for code sessions (read
  2026-10-22). Cheaper (about $20–100/month for 1,000 one-hour sessions vs an
  estimated $370–1,000 on Blaxel) with real disks (12–50 GB) and Docker, but
  no platform egress controls, resume in seconds without processes, EU only,
  forks from the newest snapshot only, and a 3-person company with a
  5-week-old SDK. Verdict: keep Blaxel; a possible later trial as a second
  provider behind the `SandboxSession` bridge. Alternatives named but not
  checked: E2B, Morph Cloud (memory branching, fits fork/rewind), Daytona.

## Decisions (Jacob, 2026-10-22)

- **Anyone in a code session can commit and push**, like "everyone types".
- **Git host: Pierre Code Storage**, pending the spike checks above.
- **Claude Code and Codex keep their native behavior:** no Lor classifier
  and no sandbox modes. Lor shows their approvals only where the harness
  gives them (Claude Code's `canUseTool`); nothing is built on top for Codex.
- **Subscriptions are allowed** when each person uses only their own
  subscription for their own turns, never shared with other people.
