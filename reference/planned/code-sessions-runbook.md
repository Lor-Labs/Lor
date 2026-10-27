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
    box. Live for everyone with the session open: files refresh as Lor's
    tool calls finish; the lock follows the run (`run:settled`, sent after
    the run row is terminal, because `message:stream` done comes first);
    staging by others arrives as `session:changes:updated`.
  - **Commit is a stub** (Jacob): commits wait for GitHub identity in
    chunk 4, which also adds the commit event row. No per-file discard.
- [x] **3b. Files tab and main-area tabs** (moved into launch scope by
  Jacob, 2026-10-23; read-only, desktop web first; mobile opens a file
  full-screen):
  - [x] **F1** Files tab: `/sessions/{id}/repo/tree` (`git ls-files`,
    tracked and untracked, at most 20,000 paths) and `/repo/file` (text up
    to 1 MB; image metadata; unsupported binary, too large, and paths
    resolving outside the repo reported). Tree with folders, a filter,
    change marks. `/repo/image` serves private image bytes up to 10 MiB
    through the authenticated client, including desktop. PNG, JPEG, GIF,
    WebP, AVIF, BMP, ICO and SVG render as images; SVG has Preview/Source
    tabs (source up to 2 MiB). Blob URLs are released on replacement/close.
    File and diff views preload each requested language; Rust, JS module
    extensions and SVG/XML use explicit language mappings.
    Sandbox commands read full process logs after completion; truncated
    process summaries must not become file paths, diffs or preview content.
    A log retrieval failure surfaces as an error instead of empty output.
  - [x] **F2** Tabs beside the chat: Chat (fixed) plus file, diff and "All
    changes" tabs; the chat stays mounted. Preview tabs (single click
    reuses one); open tabs per person per session in local storage, the
    active tab in the URL. Composer on the Agent tab only.
    - Built 2026-10-23: file and diff tabs (`use-session-tabs.ts`,
      `session-tabs.tsx`). While tabs are open, the tab bar (Chat first)
      takes the title's place in the session's header strip. (Tried above
      the main card, Linear-style; Jacob dropped it because the card
      jumped down when tabs opened.) The active tab is `?open=file:<path>`
      or `diff:<path>` (`?tab=` is the settings dialog's). The tab covers
      the transcript, which stays mounted but inert; type-to-focus and file
      uploads pause. A double click keeps a preview tab. The Changes and Files
      lists went back to rail width.
    - "All changes" (`?open=changes`, the Changes list's View all): one
      card per file with a sticky header and its stage checkbox; each diff
      loads when it scrolls near the view.
  - [x] **F3** Polish: link sharing, keyboard switching. Built 2026-10-23:
    a right-click menu on tabs (Copy link, Close, Close others; Close all
    tabs on Chat). Links use `webOrigin()`, so the Mac app copies a web
    link; the session's own Copy link leaves the tab out. Escape goes back
    to Chat. Ctrl+Tab, Ctrl+Shift+Tab and Cmd+W only in the Mac app
    (browsers keep them). Cmd+W relies on WKWebView giving the page the key
    before the menu's Close Window: not yet checked in the app.
  - [x] **F4** Files tree → composer: drag a file or folder from the tree
    (or a file from filtered results) into its session to insert an atomic
    reference chip. Entering the document with a reference drag returns to
    Chat and reveals the composer; the existing draft survives. A drop
    inside the editor inserts at the drop position, elsewhere appends.
    References serialize as ordinary Markdown
    links with the full repo-relative path. Folder chips have a folder icon
    and trailing slash; their links reveal and expand the folder in the
    Files panel. File links open the file's tab. No upload or content snapshot
    is made. Archived sessions and references from other sessions are not
    accepted.
- [ ] **4. Personal GitHub and shipping.** The GitHub App's user
  authorization, stored and refreshed tokens, a connect prompt; Push and
  Create PR as the person, or as the Lor bot by setting. Decided with Jacob
  2026-10-23: personal GitHub is the first "linked account" (a person's own
  account, never shared with the workspace; used only for turns they start
  and actions they take); commits use the person's primary GitHub email
  (noreply when GitHub doesn't share it); the Lor bot comes later.
  - [x] **4a** Linked GitHub account: `personal_account` table (additive
    `db:push`), `GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET`,
    `/personal-accounts` routes (`apps/api/src/lib/github-account.ts`), the
    `/accounts/github/callback` page and Settings → Linked accounts. Not
    better-auth's linked accounts: those would make GitHub a way to sign in.
    Setup steps: `reference/github-connector.md`.
    GitHub's avatar fills an empty profile picture on connect and when
    existing linked accounts load. A conditional update preserves custom
    pictures; Better Auth's Redis sessions and the client's cookie cache
    refresh so the fallback appears in web and desktop.
  - [x] **4b** Commit as the person: `POST /sessions/{id}/changes/commit`
    runs `commitStaged` (`@repo/lor/code-changes`) in the sandbox with the
    person's name and email, so no token is needed. The repo's commit hooks
    run, and a failure shows their output. The commit bar asks people
    without a linked account to link GitHub; ⌘↵ commits. A
    `session_committed` event row (new enum value, additive `db:push`)
    goes into the session for its people and Lor.
  - [x] **4c** Push through GitHub's API with the person's token, refreshed
    under a row lock (`githubAccountToken`); no token enters the sandbox.
    Jacob 2026-10-24: commit and push always go to the branch the session
    is on, the default branch included; protecting a branch is the repo's
    job, not Lor's. Built 2026-10-24:
    - `readUnpushedCommits` reads each commit not on the remote-tracking ref
      raw (`git cat-file commit`, `git diff-tree`); `pushCommits`
      (`apps/api/src/lib/github-push.ts`) recreates blobs, trees and
      commits through the Git Data API and checks every SHA against the
      sandbox's, then fast-forwards the branch (`force: false`). Nothing
      moves on GitHub unless everything matched. `markPushed` moves
      `origin/<branch>` in the sandbox.
    - Commits are made with `TZ=UTC` so their dates replay byte-for-byte.
      Not yet checked live: that GitHub stores the message and dates
      exactly as sent. A mismatch fails the push cleanly.
    - Refused: signed commits, more than 50 commits, files over 50 MB.
    - A `session_pushed` event row (new enum value, additive `db:push`).
  - [x] **4d** Pull and the pull request offer (Jacob 2026-10-24: refusing
    a push for good was a breaking bug; offer a PR like Zed's toast).
    Built 2026-10-24:
    - Pull (`pullBranch`, `POST …/changes/pull`; waits for Lor like
      staging): a read-only installation token in one `git fetch`'s env,
      like the clone, then `git merge` as the person (fast-forward when
      possible). Conflicts leave the merge in progress: a note in the
      panel, conflicted files stageable (staging marks them fixed), and
      Commit makes the merge commit. Push replays merge commits (changes
      against the first parent) and checks GitHub's branch still points
      where the sandbox last saw it.
    - A push refused because GitHub moved on returns 409; its toast offers
      "Pull and push". A Pull button sits by the branch name.
    - After a push, the toast offers "Create pull request" (GitHub's
      `/pull/new/<branch>` page) or "View pull request" when one is open.
      None on the repo's default branch.

## Stage 2 — before charging

- [x] **5. Checkpoints** on the chosen Git host: a snapshot of the work folder
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

  Plan, 2026-10-24 (Pierre docs and `@pierre/storage` 1.17.1 read):
  - **Layout:** one Code Storage repo per workspace and GitHub repo
    (`<workspaceId>/<owner>/<repo>`; repo IDs may contain `/`), so sessions
    on the same repo share the base's objects; one normal branch per
    session (`session/<sessionId>`). Not the ephemeral namespace: the spike
    showed per-branch token rules don't work there (below). Our repos have
    no GitHub link and only Lor clones them, so hiding refs adds nothing.
    Deleting a session deletes its branch (`DELETE /repos/branches`);
    deleting a workspace deletes its repos (`DELETE /repos/delete`, async).
  - **Cold repos:** Code Storage thaws an archived repo before a read; API
    calls may return 503 for 5–10 seconds meanwhile, so reads retry.
  - **A checkpoint** is a commit whose tree is the work folder (tracked and
    untracked files, ignored ones left out, built with a temporary index) and
    whose parents are the previous checkpoint and the session's HEAD. So the
    session's own commits keep their SHAs (Push still works after a
    restore), and the branch only fast-forwards. A `session_checkpoint` row
    keeps the SHA, HEAD, branch, upstream SHA and run.
  - **Written from the sandbox:** only the sandbox has the files, and the
    base must get into Code Storage once. The worker mints a token for one
    repo: read and write, its session branch only, no force-push, a
    10-minute lifetime, in one `git push`'s env (like the clone). The org's
    private key never enters a sandbox (Pierre's rule too). This is our own
    storage, not the customer's GitHub, where "no token in the sandbox"
    still holds.
  - **Egress:** the sandbox allowlist gains `POST` git upload-pack and
    receive-pack to `<org>.code.storage` (bump `EGRESS_VERSION`).
  - **When:** after each completed code-session turn, and after Commit and
    Pull. A Postgres advisory lock per session serializes checkpoints and
    restores.
  - **Restore:** `git init`, fetch the checkpoint with a read-only token,
    check out the branch at the saved HEAD, set the work tree to the
    checkpoint's tree with nothing staged, point `origin/<branch>` at the
    saved upstream SHA.
  - **Env:** `CODE_STORAGE_ORG`, `CODE_STORAGE_PRIVATE_KEY` (PKCS8 PEM;
    one line with `\n` or base64 also works).
  - **Spike, 2026-10-24** (org `lor`, throwaway repos deleted; base: a
    depth-1 clone of honojs/hono, 583 files, 1.9 MB `.git`):
    - A push from the depth-1 clone is accepted: 1.3 s for the first
      checkpoint (it uploads the base), 0.3 s for later ones. Repo create
      about 0.2 s.
    - Restore: `git fetch --update-shallow` (required; without it git
      refuses the shallow history) of the session branch into a fresh repo
      took 0.6 s. HEAD and the work tree matched exactly; status showed only
      the uncommitted and untracked changes, nothing staged; older
      checkpoints were reachable.
    - A cold repo (pushed through `+import`) fetched in 0.75 s, warm
      0.3 s.
    - Token ref policies: in the default namespace,
      `refs/heads/session/<id>: no-force-push` then `*: no-push` allows
      the fast-forward and refuses a force-push and other refs. In the
      ephemeral namespace, branch patterns never match (only `*` does), and
      a force-push got past `*: no-push`. Report to Pierre.
    - Not checked: object cleanup after a branch delete, SOC 2, EU region.
  - **Parts:** 5a client, table, egress and a checkpoint after each turn;
    5b restore on demand (worker and panel, "Restoring…"); 5c checkpoints
    after Commit and Pull, and deleting the session branch with the session.
  - [x] **5a** built 2026-10-24: `@repo/lor/code-checkpoints`
    (`writeCheckpoint`), the `session_checkpoint` table (additive
    `db:push`), the egress rules, and a checkpoint after each saved turn in
    `respond` (best-effort: a failure is logged, the turn stands). An
    unchanged tree and HEAD writes nothing. No `EGRESS_VERSION` bump, so
    live sandboxes keep their work; they skip checkpoints until replaced.
  - [x] **5b** restore on demand, built 2026-10-24:
    - `restoreWorkFolder` (`@repo/lor/code-checkpoints`) under the
      session's checkpoint lock: builds the repo in `<workDir>.restore-<pid>`
      and moves it into place last, so an interrupted restore (say, a run's
      fence stopping it) leaves no half-built folder.
    - Worker: `prepareCodeWorkFolder` restores before it would clone; a
      `sandbox_restore` tool event shows it. A failed restore falls back to
      the clone and the lost-changes note.
    - Panels: `withCodeSandbox` answers `restoring` and starts
      `restoreSessionFiles` in the background (`attachOrCreateSessionSandbox`
      creates the sandbox; it never fences or replaces). Its end broadcasts
      `session:changes:updated` with `filesChanged`, so every open panel
      refetches. A failure answers `restore_failed` for 30 seconds, then
      tries again. Changes, Files, diffs and file tabs show "Restoring the
      session's files…". Commit, Push, Pull and staging refuse with a
      message meanwhile.
    - Archived sessions restore too when their panel opens; the new
      sandbox idles out after 7 days.
  - [x] **5c** built 2026-10-24:
    - Checkpoints also after Commit, Push and Pull (`checkpointAfter` in
      the sessions handlers, in the background on its own sandbox
      connection). A change of upstream alone (a push) writes one too.
    - Trailers on every checkpoint commit: `Lor-Session`, `Lor-Run` (a turn's
      checkpoint) and `Lor-Checkpoint` (the row's id, minted before the
      push).
    - `session_commit` (additive `db:push`): one row per Commit, with the
      SHA (indexed), session, person, repo, branch and the session's newest
      run.
    - `sweepCheckpointStorage`, a daily worker maintenance job: deletes
      `session/<id>` branches whose session is gone and repos whose
      workspace is gone. Sessions and checkpoint rows go by database cascade
      (channel delete), so nothing runs at that moment. Only repos named
      `<uuid>/<owner>/<repo>` are touched.
    - Edge: a sandbox lost mid-merge (conflicts not yet committed) restores
      the conflicted files but not the merge itself; committing them makes
      a plain commit, and the next push asks to pull again.
  - Attribution, decided with Jacob 2026-10-24 ("which session and turn
    wrote this line", a Lor blame view, an `explain_line` tool): GitHub
    blame → commit SHA → `session_commit`;
    Code Storage blame on `session/<id>` → checkpoint → trailers. Checkpoint
    parents stay [previous checkpoint, HEAD] so blame follows turns. No git
    notes: GitHub doesn't show them and the trailers and table cover it.
    Squash merges need the PR-merge link (graph work, from GitHub's PR
    events).
- [x] **6. Rewind and native fork** (Pi first): files and harness state at
  turn N; fork into a new session; the UI for both. Decided with Jacob
  2026-10-24:
  - Both act on Lor's replies. **Fork from here:** a new session from that
    turn; the original does not change. **Rewind to here:** the session
    itself goes back to that turn, for everyone in it. Anyone who can write
    in the channel can do both. Chat sessions too, for the conversation
    only: their sandbox files are not rewound or carried into a fork.
  - Rewind in a code session puts back the full state of that turn: files,
    branch and commits. What was pushed stays on GitHub; the next push asks
    to pull first.
  - After a rewind, the later turns stay in the transcript, collapsed into
    a "Previous history" panel with the actor and message count, and Lor no longer
    sees them. A collapsed Lor reply can still be forked, so nothing is
    lost. Not hidden: in a shared session everyone sees who rewound and
    what was undone.
  - A fork's heading says "Forked from X" (like "Continued from X"), and its
    Context section links to the parent at the fork point. Its transcript
    starts empty; Lor has the whole conversation natively.
  - **Later, if forks feel empty** (option A): show the parent's messages up
    to the fork point at the top of the fork, read-only and dimmed under the
    "Forked from X" header. The same messages, not copies. The transcript
    must then load and page another session's messages, with actions on
    them turned off or sent to the parent.

  Plan (Pi 1.3.0 source read 2026-10-24):
  - **Where a turn ends.** A Lor reply → its run → the last entry of the
    run's last `harness_log` chunk. Its files: the `session_checkpoint` row
    with that run (6a also writes a row for an unchanged turn, copying the
    previous one, so every code turn has one). A turn paused for an
    approval is not a fork point. After a Pi format conversion, older turns
    can't be found (one chunk then holds the whole log).
  - **Fork:** a new session in the same channel, created at once with the
    same mode, repo and base branch. Its title is "X (fork)", then
    "X (fork 2)" and so on, until Lor's first reply names it (Jacob: parallel
    forks need telling apart). Only the person who forks follows it. Its Pi log
    is Pi's own branched session (`SessionManager.createBranchedSession`:
    the path to that entry under a new header). A code session gets a
    `session/<forkId>` branch at the turn's checkpoint (a ref, no copy) and
    a checkpoint row copying the turn's, so its first turn restores it. A
    `session_forked` event row goes into the parent. Forking while Lor works
    in the parent is fine: it reads saved state only.
  - **Rewind:** refused while Lor works or waits on an approval. Pi's log
    gets one `label` entry under that turn's entry: what Pi's own tree
    navigation writes when it makes no summary (strict rewind), and Pi
    takes the last entry as its position. The turn's checkpoint replaces
    the work folder (under the checkpoint lock, built aside and moved in),
    then a checkpoint of the result with the branch tip and that turn's
    HEAD as parents, so the branch still only fast-forwards. The next
    turn's prompt starts after the rewind.
  - **Parts:** 6a fork on the server; 6b fork in the web; 6c rewind on the
    server; 6d rewind in the web (collapsed turns).
  - [x] **6a** fork on the server, built 2026-10-24:
    - `POST /sessions/{id}/fork` with the reply's message id
      (`forkSession`, `@repo/lor/session-fork`). New: the
      `agent_session.forked_from_message_id` column and the `session_forked`
      event type (additive `db:push`). The harness log reader moved to
      `@repo/lor/harness-store`, so the API can read it.
    - Every code turn now has a checkpoint row; an unchanged turn copies
      the previous one.
    - The fork's harness state has no last run. So its first turn's prompt
      is everything said in the fork, and a note tells Lor that the session
      is a fork and where its work folder is now (the forked conversation
      still names the old path).
    - Not yet checked live: Code Storage's branch create with a commit SHA
      as its base (the docs allow it).
  - [x] **6b** fork in the web, built 2026-10-24: "Fork from here" in the
    ⋯ menu of Lor's finished replies in a session (`useForkSession`). Jacob
    2026-10-24: Lor's replies in a session get an action row under them,
    like ChatGPT's and Claude's (`LorReplyActions`: Copy, React, Reply,
    Forward to chat, Fork last, then the time; ⋯ only for Pin). Fork is a
    visible icon, not in a menu (Jacob: forking is a launch emphasis). It
    asks first in a short popover ("Fork from this reply?" / "Starts a new
    session from here. This one won't change.", Cancel / Fork), and
    the Fork button spins until the new session opens. The row always shows on
    the newest reply and on hover on older ones. People's messages and
    channel chat keep the floating bar.
  - Session event rows (Jacob 2026-10-24): on the message-content axis,
    the person's avatar (centered on the line) before their name, and the
    event's icon inline before the verb ("tester ⑂ forked this session
    into …"; fork, commit, push, continue, loop, automation). Fork and Continue rows name the other session
    by its current title. Channel chat keeps its iconless event rows.
  - [x] **6c** rewind on the server, built 2026-10-24:
    - `POST /sessions/{id}/rewind` with the reply's message id
      (`rewindSession`; fork and rewind now share
      `@repo/lor/session-branches`). Refused while Lor works or waits on an
      approval, on an archived session, for a reply an earlier rewind set
      aside (fork it instead), and for Lor's newest turn.
    - Pi's log gets one `label` entry under the turn's end
      (`rewindPiLog`), appended only if the saved head is unchanged. A log
      saved by an older Pi is refused until its next turn converts it.
    - Code sessions: `rewindWorkFolder` holds the session's checkpoint lock
      throughout, builds the turn's checkpoint aside and swaps it in. It
      keeps the live `origin/<branch>` (GitHub is not rewound), then writes
      a checkpoint of the result. It runs in the background like a restore:
      panels show "Restoring…" and refuse commits meanwhile. Every code
      turn now waits for that lock before it reads the work folder
      (`waitForCheckpoints`).
    - A `session_rewound` event row (additive `db:push`). Its text is the
      next turn's first line for Lor: what happened, never what the later
      turns said. In chat sessions it says the sandbox files stay. The
      next turn's prompt starts at that row, so messages from the rewound
      turns never reach Lor again.
  - [x] **6d** rewind in the web, built 2026-10-24. Jacob: not a button in
    the reply row but a marker between turns, like Cursor's restore point.
    - Hovering one of Lor's finished replies shows a line with a "Rewind to
      here" pill across the gap under it (`RewindDivider`). It shows only on
      the current line, never on Lor's newest turn, not while Lor works, and
      not in archived sessions.
    - A short popover asks first ("Rewind to here?" / "Lor goes back to this
      reply for everyone. Later messages fold away.", which also names the
      files in a code session). Its button spins until the server answers.
    - The `session_rewound` row folds what came after the reply, right
      under it (`rewound-turns.tsx`). Updated 2026-10-25: a bordered, tinted
      "Previous history" panel with a rewind icon, message count, actor and
      View/Hide control. Expanded messages keep normal contrast inside the
      shared surface, and their Lor replies keep Fork. Each message stays a
      direct scroller item for navigation. Overlapping rewinds fold together.
      The row arrives like any message, so everyone's transcript folds at once.
  - Times (Jacob 2026-10-24): Lor's reply row ends with the reply's time;
    a person's follow-up line shows its time in the gutter on hover; a date
    divider (channel chat's) marks each new day in the transcript, but not
    above the first message.
    The new session joins the sidebar and opens. The heading says "Forked
    from X", and it and the Context section open the source at that reply
    (`?msgId=`). The source's event row: "Jacob forked this session into a
    new session". Mobile still shows the event's plain text, like the other
    session events.
- [ ] **7. Claude Code** on the session contract: native state per turn,
  approvals and Lor's sandbox policy, sign-in, usage. Decided with Jacob
  2026-10-24 (terms read the same day, under Research):
  - **Subscription only for now:** each person pastes their own Claude Code
    token once (from `claude setup-token`, as Amp does), in Linked
    accounts. No API-key option yet. Jacob's call against the terms' "may
    not collect, store, or intermediate" line, pending his question to
    Anthropic's sales.
  - **Only that person's own messages use it:** never Act or Loop runs,
    never someone else's turn. In a Claude Code session, a teammate's
    message during a running turn queues as its own turn instead of
    steering it. The token stays out of the sandbox: Blaxel's proxy adds it
    to Anthropic requests only while its owner's turn runs (to be proven in
    the spike), and it is encrypted at rest.
  - **No Lor credits for Claude Code turns** (the terms forbid paying for
    users' Claude usage; supersedes the 2026-10-21 plan). Someone without a
    token sees "Connect your Claude subscription" and "Continue with Lor":
    a new Lor session (Lor credits) with this one as its context.
  - **Claude Code's own permission modes:** Default (asks), Accept edits,
    Plan, Auto (classifier) and Bypass, picked in the composer per message
    like Shift+Tab; prompts become Lor's approval cards. Needs a patch: the
    adapter only maps three coarse modes.
  - Adapter 1.0.162 (see Research). Parts: 7a Blaxel spike (bridge over a
    private preview WebSocket, standby, proxy-injected token, Claude Code
    through our egress); 7b sandbox groundwork (image, port, bridge
    lifetime, egress, bridge-token patch); 7c the harness choice and the
    Claude account; 7d the Claude Code turn (native state per turn, Lor's
    tools, modes and approvals, events, usage); 7e fork and rewind for
    Claude Code (later).
  - **7a spike, part 1** (2026-10-25, throwaway sandbox, our image, deleted):
    - A `ws` server on `0.0.0.0` was reachable through a private preview
      (`previews.createIfNotExists({ spec: { port, public: false } })`,
      token in `?bl_preview_token=`): about 38 ms per round trip from a Mac.
      The preview URL is `spec.url`.
    - The same process (same pid) answered after 1 and after 3 minutes with
      no connection. The sandbox status stayed `DEPLOYED`, so it is not
      proven that it went to standby. Reconnecting took about 0.5 s.
    - `SandboxInstance.updateNetwork` on the running sandbox added a POST
      rule and a routing rule without stopping the process. The proxy
      filled `{{SECRET:name}}` both in a header it injects and in a header
      the sandbox sent, so code in the sandbox can use the secret while the
      rule exists: add it for the owner's turn only.
  - [x] **7a spike, parts 2 and 3** (2026-10-25, Jacob's `setup-token`
    token, throwaway sandboxes, deleted):
    - Claude Code 2.1.290 (`npm i`, 4 s) answered on Jacob's subscription
      with `CLAUDE_CODE_OAUTH_TOKEN='{{SECRET:claude}}'` and a routing rule
      for `api.anthropic.com` holding the token: "pong" in 1.7 s (Sonnet
      5.5). Without the proxy the same placeholder got "401 Invalid bearer
      token", so the token never was in the sandbox. Node needs
      `NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"` for the proxy's CA.
    - Egress: reads anywhere plus POST to `api.anthropic.com/*` was enough;
      `--debug` showed no blocked calls, with or without
      `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
    - Bypass mode refuses root unless `IS_SANDBOX=1` (then it works); as a
      normal user it works too.
    - The model's Bash saw `BRIDGE_CHANNEL_TOKEN` (patch the bridge to drop
      it) but not `CLAUDE_CODE_OAUTH_TOKEN`: Claude Code keeps its own
      sign-in variable out of its shell.
    - A `setup-token` token printed wraps over lines in the terminal; a
      pasted copy must be joined (108 characters).
  - [x] **7b** sandbox groundwork, built 2026-10-25:
    - The image (`sandbox/workbench:latest`, pushed with `bl push`) has
      pnpm 10.34.8 and the bridge's packages (Claude Code 2.1.290, Agent
      SDK 0.3.290) where the adapter's bootstrap puts them, so a new
      sandbox's bootstrap finds them in place.
    - `@ai-sdk/harness-claude-code` 1.0.162 in `@repo/lor`, patched
      (`patches/@ai-sdk__harness-claude-code@1.0.162.patch`): the bridge
      takes `BRIDGE_CHANNEL_TOKEN` out of its env before Claude Code
      inherits it. A root shell could still read the bridge's original env
      in `/proc`; running Claude Code as its own user would close that.
    - Session sandbox (`session-sandbox.ts`): the bridge spawns as
      `bridge-*` with no keepAlive or time limit, `IS_SANDBOX=1`, the
      proxy CA, and no auto-updater or nonessential traffic. Its output
      streams end after `bridge-ready`, so nothing polls the sandbox while
      the bridge waits. Leftover bridges are stopped unless a run continues
      a parked turn (`openSessionSandbox(owner, { keepBridges })`).
      `grantClaudeAccess` / `revokeClaudeAccess` add and remove the POST
      rule and the token routing rule; `claudeCodeBridgeEndpoint` gives the
      private preview URL with a per-turn token header.
    - Checked live with the real adapter in a throwaway session sandbox:
      sandbox 7.6 s, bootstrap and bridge 9.1 s, a turn with two tool calls
      6.6 s, answered on the subscription; the model's shell found no
      `BRIDGE_CHANNEL_TOKEN`; nothing left running after the session
      ended. Not yet checked: a bridge parked on an approval across real
      standby (needs 7d's approvals).
  - [x] **7c-1** Claude subscription in Linked accounts, built 2026-10-25:
    - `personal_account_provider` gains `claude` (additive `db:push`).
      `POST /personal-accounts/claude` takes the pasted token (spaces and
      line breaks removed, `sk-ant-oat01-` only), checks it with
      Anthropic's free model list (a bad token gets 401), and stores it
      encrypted with an estimated one-year expiry. `DELETE` removes it;
      Anthropic has no revoke endpoint for setup tokens.
    - Setup tokens can run models but not read the profile (403), so the
      row shows "Token ending in ABCD · connected Oct 25", not an email.
    - Settings → Linked accounts: a "Claude subscription" row with a
      neutral icon and a connect
      dialog modeled on Amp's three steps.
  - [x] **7c-2** the harness choice, built 2026-10-25:
    - `agent_session.harness` (`harness_kind`, default `pi`; the enum gains
      `claude_code` and moved to `agent-sessions.ts`, since
      `harness-states.ts` imports that file). Additive `db:push`.
    - New session, Code mode: "with Lor ▾ / Claude Code" beside the repo
      picker (remembered like the mode). Claude Code without a connected
      subscription shows "Claude Code runs on your own Claude
      subscription" with Connect (the same dialog) and blocks the start;
      realtime refuses it too. Code sessions only for now.
    - In a Claude Code session, a message from someone without a
      subscription goes to people only (`toPeople`), so it never runs on
      anyone's plan. Above their reply line: "Connect your Claude
      subscription" and "Continue with Lor" (New session with
      `continueFrom` and `harness=pi`). The heading shows "Claude Code".
    - Fork and rewind refused Claude Code sessions until 7e.
  - [x] **7d-1 spike** (2026-10-25, three turns through the adapter in a
    throwaway session sandbox, then deleted):
    - A conversation is one append-only file,
      `~/.claude/projects/<cwd with / as ->/<claude session id>.jsonl`
      (about 90 KB after a short first turn, a few KB per short turn
      after). `session.stop()` returns `{ claudeSessionId }` (the finish
      part's metadata did not carry it); resuming with it keeps the same id
      and appends to the same file. Without it, every turn starts a new
      conversation.
    - After deleting `~/.claude/projects` and writing the saved file back,
      the next turn remembered the earlier turns. So Claude Code's state is
      stored like Pi's log: `harness_state` and `harness_log` chunks with
      kind `claude_code`, written back before each turn. Subagent side
      files (`<id>/subagents/`) are not saved yet.
    - The adapter's work folder is `<pwd>/claude-code-<sessionId>`; Lor
      sets the harness `workDir` to the session's existing work folder, so
      clone, checkpoints, restore and the Changes panel need no change.
  - [x] **7d-2** the Claude Code turn, built 2026-10-25 (not yet run live):
    - `session-core/claude-runtime.ts` (`runClaudeCodeTurn`): writes the
      saved conversation file back when its sha differs, runs the turn
      through `HarnessAgent` + `createClaudeCode` (bridge over the private
      preview, token placeholder, `allow-all`, the session's work folder),
      resumes by `claudeSessionId`, and saves the file after the turn as an
      append (or a replace when Claude Code rewrote it). Same result shape
      as `runPiTurn`, so `respond()` keeps one save, checkpoint and stop
      path.
    - `respond()` takes `claudeCode: { token }`: grants the token to the
      proxy for the turn, revokes it after, and charges no Lor credits (no
      usage events, no spend limit; the wall-clock limit stays). Prompt for
      now: the code-session section only; no Lor tools yet (7d-3).
    - Worker: loads the sender's token (`@repo/lor/claude-account`). A Loop
      fire, an Act event or a sender without a subscription fails the turn
      with a message saying why. No credit gate for Claude Code turns.
    - Open: steered and teammate messages are not taken mid-turn (they wait
      for the next turn's delta; queuing is 7d-4). A retried attempt after
      its save delivers an empty answer (`savedTurnText` reads Pi's format
      only).
  - [x] **7d-3** Lor's tools, prompt and trail, built 2026-10-26 (not yet
    run live in Lor):
    - **Spike** (one turn, throwaway sandbox, deleted): tool inputs reach
      the stream with paths relative to the work folder. `read`, `write`,
      `edit` and `bash` keep Pi's names and input fields, but their results
      are Claude Code's structured tool results: bash `{ stdout, stderr }`,
      write `{ type: "create" | "update", content, structuredPatch }`, edit
      `{ structuredPatch }` (hunks with context lines), read `{ file }`,
      WebFetch `{ result }`. A failed command is a `tool-error` with text
      ("Error: Exit code 2 …"). Lor's tools keep their own names in the
      stream (`providerExecuted: false`); Claude Code defers them and loads
      them with `ToolSearch` before the first call. Per-step usage counts
      the whole context (cache reads included); the finish part has
      `costUsd`; a raw `rate_limit_event` carries the plan's five-hour and
      weekly use. The model id is empty and the context window is not sent.
    - Lor's tools in Claude Code turns, except its web tools and plans
      (Claude Code has WebSearch, WebFetch and its own task list) and the
      approval-gated tools (a gated call pauses the turn: 7d-4). The
      connector lines can still name a gated tool the turn does not have.
    - The prompt appended to Claude Code's own: the shared session, Lor's
      knowledge tools and citations, the connector lines, saving to memory,
      mentions, workspace instructions and the code rules (CLAUDE.md is
      loaded by Claude Code; an AGENTS.md is read on demand). No Lor
      persona.
    - Switched off: worktrees, schedules and remote triggers, push
      notifications, questions and plan mode (7d-4), and the tools that
      publish outside Lor (Artifact, DesignSync, SendUserFile,
      ShareOnboardingGuide).
    - Trail: labels for Claude Code's own tools; bash output, diffs from
      `structuredPatch`, WebFetch's answer.
  - [x] **7d-3b** the context meter for Claude Code, built 2026-10-26 (not
    yet run live in Lor). Jacob: the same token and context breakdown as Pi;
    never the Claude plan's limits (people see those in Claude Code).
    - How others do it: Zed's adapter (`agentclientprotocol/claude-agent-acp`)
      counts the last reply's input, cache and output tokens against
      `result.modelUsage[model].contextWindow`, and refines the window with
      `query.getContextUsage({ detail: "summary" }).rawMaxTokens`. T3 Code
      counts the same tokens against a bundled model catalog. Neither shows
      a breakdown.
    - Lor asks Claude Code itself: the bridge patch calls
      `getContextUsage({ detail: "full" })` when the turn's result arrives
      (10 s cap) and puts the used rows, the total, the window and the
      compact threshold on the finish part. Spike (two turns, throwaway
      sandbox): "full" took about 350 ms and its total matched the last
      request's input on both turns (17,418 and 17,642); "summary" took
      about 15 ms but had no Messages row and gave the same 17,719 both
      times (only the fixed parts). Window 1,000,000 for Sonnet 5.5,
      compact at 967,000.
    - Saved as the run's `contextUsage` with `categories` (Claude Code's
      rows: System prompt, System tools, MCP tools, Skills, Messages, …).
      The meter shows those rows in place of Pi's three estimates, and no
      Cost row (`creditsSpent: null`: no Lor credits).
  - **7d-4 decisions** (Jacob, 2026-10-26):
    - Only the turn's sender answers Claude Code's own prompts (permission
      requests, plan approval, questions); teammates see the card waiting
      on them. Lor's gated tools keep Lor's approval policy.
    - A new message starts in the person's last-used Claude Code mode,
      first Auto.
    - Parts: 7d-4a pause and continue; 7d-4b Claude Code's own modes and
      their prompts as cards (patch for Plan and Auto, the picker); 7d-4c
      questions. Queuing needs no work: a session is a thread scope, and
      thread scopes always queue (`routeToActiveRun`), each queued message
      later running as its sender's own turn.
  - [x] **7d-4a** pause and continue, built 2026-10-26 (not yet run live in
    Lor):
    - **Spike** (throwaway sandboxes, deleted): a turn paused on a Lor
      tool's approval; `suspendTurn()` keeps the bridge waiting and returns
      its port and channel token. A new run reattached in 1.2 s
      (`continueFrom` + `continueStream`), ran the approved tool and
      finished. With the bridge killed, the continue never settled (the
      script exited with it pending). Resuming the conversation from its
      file after a kill worked: Claude Code read the waiting call as
      interrupted. During a new conversation's first paused turn, the
      paused state has no Claude session id, but the file is already
      `~/.claude/projects/-workspace-pi-<id>/<claude session id>.jsonl`.
    - `runClaudeCodeTurn` continues a paused turn with its decisions, or
      drops it; a turn that waits saves the conversation file with the
      continuation (as Pi does), and a dropped turn with nothing to run
      only clears it. `pausedTurnExpired` checks each harness's own
      binding.
    - `respond()` keeps the bridge when a paused Claude Code turn exists
      (`openSessionSandbox(owner, { keepBridges })` now reports
      `bridgeRunning`). No running bridge drops the turn with a "lost"
      note; a run that only continued it sends the note as its prompt.
      Lor's gated tools are back in Claude Code turns.
    - The continuation runs on the paused turn's sender's subscription,
      saved as `claudeCodeUserId` in the run's context (a resume's trigger
      is Lor's own message, and the approver can be someone else).
    - A parked bridge keeps its sandbox out of standby (checked 2026-10-26
      in throwaway sandboxes): a turn parked on an approval stayed live 30
      minutes and continued after the approval, but Blaxel reported the
      sandbox `RUNNING` the whole time with no use after the pause.
      Controls reached `STANDBY` within a minute: an idle sandbox, plain
      processes without keepAlive (a `sleep`, a port listener, an outbound
      connection), a network update, a preview. Deleting the bridge's
      preview did not help. The cause inside the bridge is not known.
    - So a parked turn stays live 30 minutes (Jacob, 2026-10-26): parking
      schedules `release-parked-bridge`, which stops the session's bridges
      if the turn still waits (approvals pending, no run in the session,
      the saved state still that run's), under the paused run's row lock
      that the approval endpoint takes. A later decision finds no bridge
      and drops the turn with the "lost" note; Claude Code asks again.
    - Stop on a paused Claude Code turn starts no run (`stopPausedTurn`
      closes its approvals and marks the run); the next message's run
      drops the turn and its prompt starts with the stop note, as for Pi.
      (Corrected 2026-10-26: this said the note was lost.)
    - A retried attempt whose turn already saved delivers the saved answer
      (`savedTurnText`). It read only Pi's lines, so for Claude Code it
      found no text and posted an empty reply; it reads Claude Code's file
      too since 2026-10-26.
  - [x] **7d-4b-1** Claude Code's own modes, server side, built 2026-10-26
    (not yet run live in Lor; no picker yet, so every turn runs in Auto):
    - **Spike** (one turn per mode, throwaway sandbox, deleted): Auto works
      on a subscription. Auto, Default and Accept edits all ran `ls`/`cat`
      without a prompt (Claude Code allows read-only commands itself);
      Accept edits wrote a file without one. Plan wrote its plan to
      `~/.claude/plans/*.md`, then `ExitPlanMode` came as an approval with
      the plan text; after approval Claude Code worked in Default, so its
      first edit asked again.
    - Adapter patch: `createClaudeCode({ nativePermissionMode })` puts the
      mode on the start message; the bridge then runs Claude Code in that
      mode and sends every prompt it raises to the host (Lor's tools stay
      host-approved). Bypass keeps the adapter's allow-all path.
    - The mode travels with the message: `message.claude_code_mode`
      (`claude_code_mode` enum, additive `db:push`), set from the send
      payload's `claudeCodeMode`, default Auto. A run that continues a
      paused turn reads the mode saved in that run's context.
    - Claude Code's prompts are approvals of kind `claude_code` (enum value,
      additive `db:push`): only the run's `claudeCodeUserId` may resolve
      them, the owner included; the list sends `onlyUserId` and names the
      sender, so others see "Waiting on <name>". `ExitPlanMode` is back
      on; `EnterPlanMode` stays off (Plan is the sender's pick).
  - [x] **7d-4b-2** the composer's mode picker and the plan card, built
    2026-10-26 (not yet run live in Lor). Jacob: the plan card offers the
    CLI's choices, "Approve and accept edits", "Approve, ask for edits" and
    "Keep planning".
    - Picker (`claude-code-mode-picker.tsx`): Auto, Ask before edits,
      Accept edits, Plan, Bypass permissions, with tooltips; in the
      session's tool bar and in New session once Claude Code is picked;
      Shift+Tab in the editor cycles it. One remembered mode per browser
      (localStorage), first Auto; each send carries it.
    - Plan card: the plan's Markdown (`plan` on the approvals list, from
      ExitPlanMode's input) and the three choices. "Keep planning" rejects.
      Approving calls `POST /approvals/{id}/approve-plan` with `{ mode }`,
      saved as `approval.claude_code_mode` (additive `db:push`); the paused
      turn's decision carries it as the approval's `reason`, and the bridge
      patch turns an approved ExitPlanMode's reason into Claude Code's
      `setMode` for the session. Spike: approved with acceptEdits, the next
      write ran without a prompt. Approving also sets the sender's picker
      to that mode, so the next message does not plan again.
    - Mobile shows Claude Code prompts with the sender-only rule, but a
      plan there is a plain Approve (Claude Code goes on in Default).
  - [x] **7d-4c** Claude Code's questions, built 2026-10-26 (not yet run
    live in Lor):
    - **Spike** (throwaway sandbox, deleted): AskUserQuestion arrives as a
      host tool call `askUserQuestions` (the harness questions input: ids
      `question-N` and `option-N`, `allowMultiple`, free-form allowed); the
      turn pauses with it in `pendingToolResults`, and a fresh run that
      reattached answered it with `toolResultContinuations` (`{ action:
      "answered", answers: { "question-1": { optionIds: ["option-2"] } } }`):
      "You prefer blue."
    - A question is a `claude_code` approval row (the tool call id stands
      in for the approval id), so it pauses, notifies and resumes like a
      prompt, sender only. `askUserQuestions` is switched back on.
    - `POST /approvals/{id}/answer` saves `approval.answers` (additive
      `db:push`); the paused turn's continue sends them as the tool result.
      Skip sends `declined`; someone writing instead sends `cancelled`.
    - Web card (Jacob's redesign): a stepper, one question at a time with a
      segmented progress bar and "Question 2 of 4 · <header>"; radio or
      checkbox rows with number-key hints, a written-answer row, Previous /
      Skip / Next (Send on the last). Skip leaves a question out; with none
      answered the questions are declined. Steps slide (Motion, 220 ms
      ease-out, the card's height eased), the bar fills with a clip-path
      transition and the label rolls. Others see the questions and
      "Waiting on <name>"; once answered the row reads "Answered by … ·
      Color: Blue". Mobile asks to answer on web or desktop for now.
  - [x] **7e** fork and rewind for Claude Code, built 2026-10-26 (not yet
    run live in Lor):
    - **Spike** (throwaway sandboxes, deleted): the SDK's `resumeSessionAt`
      at turn A's last entry (its final assistant message) made the next
      turn forget turn B; Claude Code kept the same file and appended the
      new turn as a branch there (its first entry's parent was A's last).
      A file copied up to the end of turn A into another work folder's
      project folder resumed with only turn A. One run's turns used Claude
      Code's own auto-memory (a file outside the work folder), which a
      rewind does not undo.
    - Adapter patch: `createClaudeCode({ resumeSessionAt })` puts it on the
      first prompt's start message, and the bridge passes it to the SDK.
    - `session-core/claude-branch.ts`: the turn end is the run's last save
      (its last entry and last byte, `turnEndChunk`). Rewind leaves the
      file as it is and moves `headEntryId` to that entry (refused off the
      current branch, or when it is already the head); the next turn sees
      a head that is not the file's last entry and resumes there. Fork:
      the file up to that byte, renamed into the fork's project folder;
      the fork keeps the Claude Code harness.
    - Claude Code's auto memory is off (Jacob, 2026-10-26):
      `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` on the bridge. Its notes lived only
      in the sandbox, outlived rewinds and were shared by everyone's turns;
      Lor keeps the team's memory. Checked: asked to remember something,
      Claude Code said it had no memory tool and wrote no memory files.
  - [x] **7f** first-turn speed, built 2026-10-26 (image push owed):
    - Measured with the real adapter in throwaway sandboxes, timing each
      sandbox call. A new session's first turn reached its first text at
      18.3 s: sandbox 4.7 s, the adapter's bootstrap 7.0 s (`pnpm install`
      took 6.1 s although the image had the packages; it ran because the
      bootstrap's marker file was not in the image), bridge link 1.2 s,
      bridge start 2.0 s, Claude Code to first text 2.1 s. Every turn also
      waited 1.2 s at its end: the bridge process wait slept one full
      second.
    - The image now holds the bootstrap as done: `claude-code-bootstrap.ts`
      writes the bridge as Lor's patch leaves it plus the marker (through
      the harness's own `createHarnessSandboxTemplate`), and the
      Dockerfile installs the packages next to them. Run it after any
      change to the adapter or its patch, then `bl push`. An image with an
      older marker still works: the adapter runs the bootstrap itself.
    - Per turn: the Blaxel session reports `defaultWorkingDirectory`
      (one `pwd` fewer, Pi too); a spawned process's wait polls with
      backoff (stop took 0.3 s, not 1.2 s); the bridge link is made while
      the work folder is prepared, and the token grant runs beside it.
    - Checked with the bootstrap written into a new sandbox as the image
      will have it: the adapter skipped the bootstrap, and the first text
      came 5.7 s after the sandbox was ready (13.6 s before); a later turn
      took 4.4 s in all (6.5 s before). Sandbox creation varied from 1.3 s
      to 5.8 s; it is the same for Pi.
- [ ] **8. Codex**, the same way. Decided with Jacob 2026-10-26 (adapter
  `@ai-sdk/harness-codex@1.0.160`, read the same day; it matches our harness
  1.0.158 and bundles Codex CLI 0.160.1):
  - **Billing: Lor credits for now.** Codex turns go through the AI Gateway
    on Lor's key, which the sandbox proxy injects (the key never enters the
    sandbox), so everyone in the session can send Codex turns, like Pi.
    ChatGPT plans come later: OpenAI offers plan usage ("Sign in with
    ChatGPT") to open-source and local apps, and to paid or hosted apps
    only as selected partners through its interest form, which Jacob fills
    in. The adapter's own subscription mode reuses the Codex CLI's sign-in,
    which OpenAI says is not approved for third-party clients. Once Lor is
    approved: a "Sign in with ChatGPT" row in Linked accounts, its access
    token sent as a Bearer token to `api.openai.com` through the proxy.
  - **Spend is counted at the turn's end:** Codex reports usage per turn
    only, so a long turn can pass the spend limit before Lor sees it. No
    patch.
  - **Models:** a picker in the composer, GPT-6.1 Sol by default, GPT-6
    Astra and GPT-6 Luna, all on the Gateway. The adapter pins GPT-5.5
    because GPT-5.6 models do not get tool calls through a custom provider
    (openai/codex#31894, open); the first spike checks GPT-6.x. If they
    fail, GPT-5.5 until the fix.
  - **Tool changes keep the thread:** the adapter starts a new, empty
    Codex thread when Lor's instructions or tools change between turns.
    Patch it to keep the thread. Instructions still update (they go in
    Codex's config on every resume); the thread keeps the tools it started
    with, so a newly connected tool reaches Codex in the next session.
  - **Approvals:** Codex's own tools (shell, patch, web search, images)
    run without approvals: the adapter forces `approval_policy="never"` and
    no Codex sandbox, so Lor's sandbox and egress limits are the boundary
    (Jacob's 2026-10-22 decision). Lor's gated tools keep Lor's approval
    policy.
  - [x] **8a spike** (2026-10-26, throwaway session sandbox, deleted):
    - Lor's Gateway key as `{{SECRET:gateway}}`: the proxy filled it on
      Codex's requests to `ai-gateway.vercel.sh` (a POST rule plus a
      routing rule, like the Claude token); Codex trusted the proxy's CA.
    - GPT-6.1 Sol ran a shell command and called a Lor tool; GPT-6 Astra
      answered too. The GPT-5.6 tool bug did not show.
    - A new bridge resumed the thread by its id (`resumeFrom` with
      `{ threadId }`) on another model and kept the conversation; Codex
      warns when a thread changes model.
    - A gated Lor tool paused the turn (`suspendTurn`), and a new session
      continued it after the approval.
    - New sandbox: bootstrap and bridge in about 8 s; a turn took 2–5 s.
      Usage comes at the turn's end with cache reads and writes; a paused
      turn's early finish carries none.
    - Native state: one file per thread,
      `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<threadId>.jsonl`.
      `~/.codex` also held 96 MB of a plugin cache Codex downloads.
  - [x] **8b** sandbox groundwork, built 2026-10-26 (image push owed):
    - `session-sandbox.ts`: any harness's bridge
      (`.harness-bootstrap/<harness>/bridge.mjs`) runs as `bridge-*` with no
      keepAlive, its log streams end at `bridge-ready`, and a paused turn
      keeps it; Claude Code's env stays Claude Code's.
      `grantHarnessAccess(owner, { claudeToken } | { gatewayKey })` and
      `revokeHarnessAccess`; `harnessBridgeEndpoint` and
      `HARNESS_BRIDGE_PORT` (the preview keeps its chunk 7 name).
    - Image: `harness-bootstrap.ts` (was `claude-code-bootstrap.ts`) writes
      `claude-code/` and `codex/`; the Dockerfile installs both bridges'
      packages and copies `codex-config.toml` to `~/.codex/config.toml`: no
      update checks, analytics, feedback, plugins, ChatGPT apps or memories.
      `features.remote_plugin = false` did not stop the 93 MB plugin clone
      (Codex clones OpenAI's curated plugin repo whenever plugins are on and
      the remote catalog is unavailable); `features.plugins = false` did.
    - Adapter patch (`patches/@ai-sdk__harness-codex@1.0.160.patch`):
      changed tools or instructions keep the thread.
    - Checked in throwaway sandboxes with the image's state written in: the
      adapter skipped its bootstrap (the generated marker matches), the
      bridge ran as `bridge-*`, a second turn with another tool list and
      changed instructions kept the thread and its context, and `~/.codex`
      stayed about 4 MB (95 MB before).
  - [x] **8c** picking Codex, built 2026-10-26 (additive `db:push`: `codex`
    in `harness_kind`, the `codex_model` enum and `message.codex_model`):
    - The New session picker offers Codex ("OpenAI's coding agent, on Lor
      credits"), for code sessions only, like Claude Code; no linked
      account. The session header shows the harness's name.
    - The composer's model picker (`codex-model-picker.tsx`): GPT-6.1 Sol
      (default), GPT-6 Astra, GPT-6 Luna, remembered per person. Each
      message carries its pick (`codexModel` in the send payload, kept on
      the message like the Claude Code mode).
    - Until 8d a Codex session's message failed with "Codex sessions can't
      run turns yet" instead of running on Pi, whose saved state a Codex
      session could not read (removed in 8d-1).
  - [x] **8d-1** the Codex turn, built 2026-10-26 (`db:seed` owed for the
    model rates; not yet run live in Lor):
    - **Spike** (throwaway sandboxes, deleted): turns append to one rollout
      file, a paused turn's lines included. A new sandbox given only the
      saved rollout (none of Codex's state databases) resumed the thread by
      its id, and a dropped paused turn's waiting call read as not run.
    - `session-core/codex-runtime.ts` (`runCodexTurn`, `CODEX_BINDING`),
      shaped like Claude Code's: the saved rollout is written back unless
      its hash matches; a paused turn continues through its bridge, or is
      dropped; the save is the rollout's new bytes, its path relative to
      `~/.codex` and its head the thread id.
    - `respond()`: `ctx.codex = { model }`. Claude Code and Codex share the
      prompt head (Claude Code's text unchanged); Codex keeps Lor's web
      tools (its own web search is off) and drops Lor's plan tools (it has
      its own). The proxy adds Lor's Gateway key for the turn. Parked
      bridges and lost turns work as for Claude Code. Usage is charged at
      the turn's end at `openai/<model>`; the model is saved with the
      request, so a continued turn keeps it.
    - The worker picks the model: the paused run's for a continuation,
      else the message's, else GPT-6.1 Sol. Rates for the three models in
      `seeds/model-rates.ts` (standard tier; requests past 272k input
      tokens cost about twice as much).
    - `savedTurnText` reads Codex's rollout messages, and the 30-minute
      release covers Codex bridges.
    - Checked `runCodexTurn` itself in throwaway sandboxes, with saves
      carried between calls: a turn, a turn paused on a gated Lor tool, its
      continuation after the approval, then a resume in a new sandbox from
      the saved rollout, which still knew both earlier turns.
  - [x] **8d-2** the trail and the context meter, built 2026-10-26:
    - Codex's patches reach Lor as one `fileChange` part per file
      (`{ event, path }`, the harness's own part), not as `apply_patch`
      calls; the trail reads "Created / Edited / Deleted <path>"
      (`harnessToolLabel`, which also names `compaction` and
      `view_image`). The diffs stay in the Changes panel. bash shows the
      command inside Codex's login-shell wrapper, and its detail is the
      output's tail, an error when the exit code is not 0
      (`codexToolDetail`).
    - The context meter reads the rollout's last `token_count` event: the
      last request's `total_tokens` against Codex's `model_context_window`
      (258,400 for GPT-6.1 Sol, Codex's own limit), compacting at about
      90%. Credits show, as for Pi; the meter's segments are Lor's
      estimate (Codex's base prompt counts as messages).
    - Checked against real Codex output in a throwaway sandbox: labels,
      bash details and the meter.
  - [x] **8e** fork and rewind for Codex, built 2026-10-26 (not yet run
    live in Lor):
    - **Source read** (Codex 0.160.1): the app-server no longer has
      `thread/rollback`, but a resumed thread still applies the rollback
      events in its rollout (`thread_rolled_back`, "drop the newest N user
      turns"). Its `thread/fork` copies the rollout up to a turn into a new
      thread. Codex's rollout is "paginated": every line has an `ordinal`,
      the file's last line must have one (Codex resumes the count from
      it), and a person's message is an `item_completed` UserMessage event.
    - `session-core/codex-branch.ts`: rewind appends a rollback event with
      the next ordinal that drops every user turn after the reply's turn
      (its run's last saved byte), like Pi's label entry; the later turns
      stay in the file and can still be forked. It is refused for a turn an
      earlier rewind dropped, for the newest turn, and when Codex compacted
      after the turn (its summary would keep the later turns; fork
      instead). Fork: the rollout up to that byte, with the same thread id
      and path, in the fork's own sandbox; the adapter resumes it in the
      fork's work folder.
    - Checked through `runCodexTurn` in throwaway sandboxes: three turns,
      a rewind to the first, then a turn that knew only the first turn's
      word; a fork from a turn the rewind dropped knew both earlier words;
      a fork from the turn after the rewind knew only the first. Both forks
      ran in their own work folder.
- [ ] Then OpenCode and other ACP agents, through Vercel's adapters
  ([harness-sessions.md](harness-sessions.md) §3 "Adding a harness").

## Research (started 2026-10-22)

- [x] Git host for checkpoints: Pierre Code Storage vs Cloudflare Artifacts
  (Code Storage chosen; spike 2026-10-24 under chunk 5)
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
- [x] Claude Code before chunk 7 (read 2026-10-24: adapter source,
  vendor terms, Blaxel docs):
  - **Terms.** Anthropic (code.claude.com legal-and-compliance, modified
    2026-10-05): a product running Claude Code in hosted sandboxes may not
    pay for, resell or intermediate its users' Claude usage. Each person
    uses their own Anthropic API key, their own subscription through
    Anthropic's own sign-in in the unmodified CLI (Lor may not store or
    relay that token), or their own Bedrock, Vertex or Foundry account.
    This rules out workspace credits through the Gateway for Claude Code
    (the 2026-10-21 plan for teammates without a subscription). OpenAI:
    Lor's key or the Gateway is fine for Codex, as is a person's own API
    key; ChatGPT-plan sign-in for hosted apps needs OpenAI's partner
    approval.
  - **Adapter.** Use `@ai-sdk/harness-claude-code` 1.0.162 (it matches our
    harness 1.0.158). 1.0.163–1.0.168 ship without the bridge's
    `pnpm-lock.yaml`, so their bootstrap fails. The bridge (Agent SDK
    0.3.290, Claude Code 2.1.290) runs in the sandbox and talks to the
    worker over a WebSocket on a sandbox port. Lor's tools reach it as an
    in-bridge MCP server. Approvals come from permission modes
    (`allow-all` = no gating; `allow-edits` gates Bash; `allow-reads` gates
    edits and Bash), answered through the harness's continue flow. It loads
    all setting sources (the repo's CLAUDE.md, settings and hooks); the
    system prompt is Claude Code's with Lor's text appended. Usage comes
    per step and per turn (with the CLI's cost estimate). No fork or rewind
    API: the session JSONL (under `$HOME/.claude/projects`, outside the
    volume) must be saved per turn, and fork would copy it.
  - **Blaxel.** The worker can reach the bridge through a private preview
    URL with a token header (WebSocket works; 15-minute idle timeout).
    Standby keeps running processes, so a bridge parked on an approval can
    survive. Lor's `spawn` (keepAlive, 30-minute timeout, leftover-process
    cleanup) would kill it. The image lacks pnpm: bake the CLI and the
    bridge's packages into it. The proxy can inject a secret per
    destination (`{{SECRET:name}}`, public preview), so a key need not be
    readable in the sandbox. The bridge's own token is probably readable
    by the model's Bash (patch).
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
