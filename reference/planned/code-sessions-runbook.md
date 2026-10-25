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
  - [x] **F4** Files tree → composer: drag a file from the tree or filtered
    results into its session to insert an atomic file-reference chip. Entering
    the document with a file drag returns to Chat and reveals the composer;
    the existing draft survives. A drop inside the editor inserts at the drop
    position, elsewhere appends. References serialize as ordinary Markdown
    links with the full repo-relative path and session file-tab URL; sent chips
    open that file in the app. No upload or content snapshot is made. Folders,
    archived sessions and references from other sessions are not accepted.
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
  - After a rewind, the later turns stay in the transcript, collapsed under
    a row ("Jacob rewound to here · 6 messages · Show"), and Lor no longer
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
      under it: "(avatar) Jacob ↺ rewound to here · 6 messages · Show"
      (`rewound-turns.tsx`). Show unfolds them dimmed; their Lor replies
      keep Fork. Overlapping rewinds fold together. The row arrives like
      any message, so everyone's transcript folds at once.
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
    - Part 2 (needs a Claude token): Claude Code 2.1.290 through the proxy
      with the token as a placeholder.
- [ ] **8. Codex**, the same way.
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
