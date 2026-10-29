# GitHub Connector — Status & Definition of Done

Status as of 2026-10-22. Lor reads code with `clone_repo` in its own session
sandbox; the coding child agent (`investigate_code`) and the draft-PR write
loop (`propose_code_change`) are deleted
([pi-harness-runbook.md](planned/pi-harness-runbook.md) 1.4). Nothing in
phase 1 commits, pushes or opens a PR. In code sessions (later) a person
commits or opens the PR, under their own GitHub account or as the Lor bot
([code-channels.md](planned/code-channels.md) §2). The App configuration below
is unchanged.

## GitHub App webhook configuration

The App is `lor-chat`. Its event subscriptions live in the App's settings on
GitHub, not in code. As of 2026-10-07 it subscribes to: Pull request, Pull
request review, Issues, Release, Discussion, Discussion comment, Deployment
status, Workflow run, Meta.

- Code handles `pull_request.opened`/`closed`, `issues.opened`/`closed`,
  `release.published` (`apps/api/src/routes/v1/integrations/github/events.ts`).
- `installation` and `installation_repositories` arrive without a
  subscription: GitHub sends them to every App by default.
- Pull request review, Discussion, Discussion comment, Deployment status and
  Workflow run are delivered and ignored.
- **Ingestion (2026-10-17, `planned/context-engine-phase-2.md` Step 3):** PR,
  issue, review, issue comment and review comment events enqueue a refetch of
  the item into `source`; deletes, transfers and removed repos tombstone it.
  Needs two more subscriptions: **Issue comment** and **Pull request review
  comment** (both added to the prod App 2026-10-17; dev App to check). Push
  stays off until a push event handler exists.

Install settings (prod App, 2026-10-07): the App is public. Request user
authorization during installation is off, so GitHub uses the Setup URL
`https://app.lor.chat/integrations/github/setup`. Redirect on update is on.
Webhook URL is `https://api.lor.chat/v1/integrations/github/webhook`.
Disconnecting in Lor deletes the connection row but leaves the App installed
on GitHub.

Workspace connection requires the caller's linked GitHub account. Without
one (or with an expired one), `connect-url` returns the account authorize
URL with `step: "account"`; its signed state names the workspace, so the
account callback continues to the install. The API
checks the installation using that user's token, then requires the personal
account owner or an active organization owner before sharing its repositories
with the workspace. The installation ID alone is never proof of ownership.
IDs must be canonical positive safe integers; old numeric aliases fail closed
when listing repositories or minting tokens. Unsuspending an installation
requires reconnection in Lor and does not reactivate a revoked binding.

Security rollout: stop API/realtime/workers, run
`packages/db/scripts/revoke-unverified-github-connections.sql` once against the
deployment database, deploy all services, then reconnect installations through
the verified flow. Revocation hides their indexed sources. Existing bindings
cannot be assumed valid, including canonical IDs. Review any disputed binding
before removing it; never merge numeric aliases into another tenant's row.

### Dev App

An App has one Setup URL, so dev needs its own App. Checklist:

1. Create a second App under the same owner as `lor-chat`, for example
   `lor-chat-dev`. It can stay private if you only install it on accounts
   that owner controls.
2. Copy the prod App's repository permissions and event subscriptions.
3. Setup URL: the dev web origin plus `/integrations/github/setup`, for
   example `http://localhost:3000/integrations/github/setup`. The browser
   follows this redirect, so localhost works.
4. Request user authorization during installation: off. Redirect on update:
   on.
5. Webhook: GitHub cannot reach localhost. Uncheck Active for normal dev
   work, or point it at a forwarding URL (for example a smee.io channel) when
   testing events.
6. Generate a private key and a webhook secret. Set `GITHUB_APP_ID`,
   `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_SLUG`, and `GITHUB_WEBHOOK_SECRET` in
   the dev env.
7. Disconnect GitHub in every dev workspace and reconnect through the dev
   App. Existing dev rows hold prod-App installation ids, and the dev App's
   key cannot mint tokens for them.

### Personal GitHub accounts (user authorization)

People link their own GitHub account (Settings → Linked accounts) to commit
and push as themselves in code sessions
([code-sessions-runbook.md](planned/code-sessions-runbook.md) chunk 4). This
uses the same App's user authorization, not the install flow. Per App (prod
and dev):

1. Redirect URI (the "Identifying and authorizing users" section; GitHub
   used to call it Callback URL): the web origin plus
   `/accounts/github/callback`, for example
   `https://app.lor.chat/accounts/github/callback`. Leave wildcard
   matching, "Request user authorization (OAuth) during installation" and
   Device Flow off.
2. User-to-server token expiration (Optional features): opted in, so tokens
   last 8 hours and Lor refreshes them.
3. Generate a client secret. Set `GITHUB_APP_CLIENT_ID` (the App's Client
   ID, not its App ID) and `GITHUB_APP_CLIENT_SECRET` in the API env;
   `INTEGRATION_ENCRYPTION_KEY` must be set too.
4. Account permissions → Email addresses: read-only, so commits can use
   the person's primary email. Repository permissions → Contents and Pull
   requests: read and write, for push and pull requests. Installation
   owners must approve changed permissions on GitHub.

A user token acts as the person, limited to repositories the App is
installed on. Disconnecting deletes the tokens and revokes them at GitHub.

## How it works today (as-built)

The flow: Lor calls `clone_repo(repo, branch)` → the repo is shallow-cloned
into the work folder of the session's own sandbox → Lor searches and reads it
with its sandbox tools (`grep`, `glob`, `read`, `bash`) → Lor answers, linking
cited lines with commit-pinned GitHub URLs. There is no second agent; the
reading is part of Lor's own turn, metered like the rest of it.

- **Tool:** `packages/lor/src/code.ts` (`cloneRepoTool`), bound when GitHub is
  connected, the tool is selected, and the Sandbox group's `read` or `bash` is
  on. The repo is resolved against the connected repos (`resolveRepo`) and a
  read token is minted for that one repo (`contents: read`,
  `getInstallationToken`).
- **Clone:** `git clone --depth 1 --single-branch` into
  `<work folder>/repos/<owner>/<repo>`. The token is passed as per-command env
  and expanded by the shell, never in the command string or the saved remote.
  A process in the sandbox could read it during the clone; it only reads a
  repo the sandbox already holds and expires within an hour (accepted).
- **Update:** calling it again fetches the branch and switches only when the
  clone has no changed files and no commits made in the sandbox; otherwise it
  stays as it is and says so. It never resets or cleans.
- **Egress:** the sandbox's limits allow git fetch but not push
  (`git-receive-pack`), so nothing can leave by git.
- **Returns:** path, branch, commit and a commit-pinned `linkBase`
  (`https://github.com/<repo>/blob/<commit>/`).
- **Composer:** GitHub file browsing (attach a repo file) requires
  `clone_repo`, which Lor reads the file with.
- **SDK:** `@blaxel/core`; env `BL_API_KEY` + `BL_WORKSPACE`, optional
  `BL_REGION`. See [artifacts.md](artifacts.md) for the session sandbox.

## Definition of Done

### ✅ Done

- [x] Code reading: `clone_repo` into the session sandbox, read by Lor's own tools, citations as commit-pinned links (2026-10-22; replaced `investigate_code`).
- [x] Auth: GitHub App installation tokens + robust PEM handling.
- [x] **Repo resolution.** The installation *is* the repo picker — we enumerate its accessible repos (`listInstallationRepos`, `apps.listReposAccessibleToInstallation`) rather than rebuild a picker. They're listed in the `clone_repo` description (so Lor targets a real repo) and resolved again server-side before the clone (`resolveRepo` in `code.ts`): single repo → auto-use; exact/unambiguous-name match → use; miss → return the valid list so Lor retries — never clones a phantom. Settings shows the repos read-only with a "Manage on GitHub" link (`getInstallationOverview` → installation `html_url`).
- [x] **On-demand PR/issue search (live).** `search_github` (live `GET /search/issues`, scoped to the connected repos via `repo:` qualifiers, `type` PR/issue filter, capped fan-out with an overflow note) + `fetch_github` (full body + comments, plus review comments for PRs; auto-detects PR vs issue). Lives in `packages/lor/src/github.ts` (provider calls `searchIssues`/`fetchIssueOrPr` in `providers/github.ts`); registered only when GitHub is connected. Results are referenced inline by **Markdown link** (live, not `[[src:]]` — nothing is ingested), and appear as grounded drillable items in the tool trail. System prompt routes GitHub PR/issue questions here.
- [x] ~~Draft-PR write loop (`propose_code_change`, shipped 2026-08-18)~~ **Deleted 2026-10-22** with the coding child agent, along with the per-repo base-branch setting (`github_repo_config`). Shipping code moves to code sessions, where a person commits or opens the PR ([code-channels.md](planned/code-channels.md) §2). Its orchestrated-push rules carry over as design: explicit refspecs, `lor/*` or the person's branch, never force, no push credential in the sandbox.

### 🔴 Must-have before shipping (even read-only)

- [x] ~~**Cost/rate guard** on the sandbox tools~~ — code reading is now part of Lor's own turn, so the run's spend limit covers it (runbook §4.5).

### 🟣 Cross-cutting (not a GitHub blocker — project-level)

- [x] **Gating — Layer 2 per-channel tool profiles.** Agent profiles choose which capabilities, code investigation included, each channel gets. The default profile still grants everything, so scoping code to engineering channels is a per-workspace profile setting, not a code change.

### 🟡 For the "proper = read + write" bar

- [ ] Write side moves to code sessions (later; [code-channels.md](planned/code-channels.md) §2). Add `checks: read` to the App then, so Lor can read CI results and iterate.

### ⚪ Nice-to-have / robustness

- [ ] Code index for chat (`code-channels.md` §11), which may replace `clone_repo` in chat.
- [x] ~~Session reuse so follow-ups don't re-clone~~ — the clone lives in the session sandbox and updates by fetch.
- [ ] Re-verify `fetch_source` now that App auth works (was silently broken by the PEM issue).
- [ ] Edge cases: large-repo clone timeout, repos that do not fit the 2 GB session disk, repo-not-found. Live check owed: a private repo clones through the egress proxy.
- [ ] **Ground GitHub links.** PR/issue refs are emitted as plain Markdown links, so the citation grounder can't catch a fabricated url (the real results are in the trail, but inline links aren't verified). Optional: a `[[gh:owner/repo#n]]` token verified against tool output, or post-hoc link validation.
- [ ] **Confirm `search.issuesAndPullRequests` live** (deprecation: GitHub is nudging toward the `advanced_search` opt-in). Best-effort/defensive today; verify scoping + result shape against a real installation.

## Decisions locked (do NOT re-litigate)

- ~~**No embedding by default** of GitHub PRs/issues — brain-centric. The old `SOURCE_INGEST_ENABLED` flag is gone: an event becomes a source only when its trigger has Remember on (`apps/api/src/lib/connector-triggers.ts`).~~ **Reversed 2026-10-17** (`planned/context-engine.md` §8 decision 3): PRs and issues with their comments and reviews are ingested by default as real text, chunked and embedded; Remember is removed.
- **Clones live in the session sandbox** (2026-10-22): shallow, no deps unless Lor installs them; freshness comes from a fetch when `clone_repo` is called again, and Lor's own changes are never reset.
- **Lor never commits, pushes or opens a PR by itself** (2026-10-22); a person does, from a code session. Never auto-merge, never force-push.
- **No push credential ever enters the sandbox**, Lor's or a person's.
- ~~**Webhooks not needed** for GitHub's core loop (brain-centric → no index to sync). They'd only return for proactive notifs/synthesis.~~ **Reversed 2026-10-17:** webhooks are the refetch signal for ingestion. No catch-up sweep: the stored copy is a search index, not a mirror, so a dropped delivery (GitHub never redelivers) leaves the item stale until its next change, and current state comes from the live tools.
- **Linear is deferred** until GitHub is done; when resumed: proper OAuth + write scope + webhooks from day 1 (tokens expire ~24h w/ refresh — design researched).

## Recommended next step

Live-verify `clone_repo` against a real installation (a private repo through
the egress proxy), and switch "Clone repository" on for existing GitHub
connections (their saved tool lists predate it). Then the write side is code
sessions (`code-channels.md`). Live-verify `search/issues` scoping when
convenient.
