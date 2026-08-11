# GitHub Connector — Status & Definition of Done

Status as of 2026-07-31. The **code-investigation core works end-to-end** (verified live: sandboxed Pi → Kimi K3 through Vercel AI Gateway → read-only tool loop → findings → metered → torn down). It is **NOT "done"** by our bar yet. This is the resume-here doc. (2026-08-10: the sandbox provider moved Railway → **Blaxel** — same flow, engine details updated below; the ported path needs a live GitHub e2e re-verify.)

## How it works today (as-built)

The flow: Merlin calls the `investigate_code(repo, question)` tool → clone the repo into an ephemeral Blaxel sandbox at query time → run Pi with the configured Merlin main model as a read-only sub-agent → stream its tool calls back live → return findings → Merlin composes the answer.

- **Tool:** `packages/merlin/src/code.ts` (`buildCodeTools`) — registered in `respond()` (`index.ts`) only when Blaxel is configured (`BL_API_KEY`+`BL_WORKSPACE`). Resolves the workspace's active GitHub connection → mints a short-lived installation token (`getInstallationToken`, `providers/github.ts`).
- **Engine:** `packages/merlin/src/sandbox/investigate.ts` → `withEphemeralSandbox` (`sandbox/blaxel.ts`). It runs the same workbench image (Pi pinned, see `reference/artifacts.md`) and shallow-clones the repository fresh per query (`git clone --depth 1 --single-branch`, no deps or repo caching; the clone token reaches the sandbox as process env, never in the persisted command string). Pi runs Kimi K3 through Vercel AI Gateway with only `read`, `grep`, `find`, and `ls`; sessions, extensions, skills, prompt templates, and repo context files are disabled. The live smoke test probes the image's Pi CLI so incompatible image changes fail visibly.
- **Realtime trail:** Pi JSON events feed the live `onStdout` stream → each `tool_execution_start` is emitted as a `merlin:tool` with `parentToolCallId` = the investigate_code call id (live stream is UX-only; findings + usage are parsed from the complete stdout after completion). Web nests it: `merlin-message-body.tsx` (`childrenByParent`) + `merlin-tool-trail.tsx`. Findings rendered as markdown (small/dimmed).
- **Usage metering:** `packages/merlin/src/usage.ts` (`UsageEvent`/`OnUsage`) forwards each Pi run's token counts to the central usage ledger. Every successful `investigate_code` invocation is priced from the served model's database rate and debited from the workspace's customer credits with a retry-safe per-response invocation key.
- **Sandbox lifecycle:** `"Sandbox: created"` / `"Sandbox: destroyed"` logs confirm teardown (no surprise billing).
- **SDK:** `@blaxel/core`; env `BL_API_KEY` + `BL_WORKSPACE` (read by the SDK from process.env), optional `BL_REGION`.

## Definition of Done

### ✅ Done
- [x] Code investigation: clone → agentic exploration → findings (with `path#L..` citations).
- [x] Realtime **nested** sub-tool streaming (live trail) + persisted on the message.
- [x] Findings rendered as markdown (dimmed, 11px) in the drill-down, scrollable, untruncated.
- [x] Per-invocation usage metering (seam for billing).
- [x] Sandbox create/destroy logging; full sandbox-exec error logging.
- [x] Auth: GitHub App installation tokens + robust PEM handling.
- [x] **Repo resolution.** The installation *is* the repo picker — we enumerate its accessible repos (`listInstallationRepos`, `apps.listReposAccessibleToInstallation`) rather than rebuild a picker. They're listed in the `investigate_code` description (so Merlin targets a real repo) and resolved again server-side before clone (`resolveRepo` in `code.ts`): single repo → auto-use; exact/unambiguous-name match → use; miss → return the valid list so Merlin retries — never clones a phantom. Settings shows the repos read-only with a "Manage on GitHub" link (`getInstallationOverview` → installation `html_url`).
- [x] **On-demand PR/issue search (live).** `search_github` (live `GET /search/issues`, scoped to the connected repos via `repo:` qualifiers, `type` PR/issue filter, capped fan-out with an overflow note) + `fetch_github` (full body + comments, plus review comments for PRs; auto-detects PR vs issue). Lives in `packages/merlin/src/github.ts` (provider calls `searchIssues`/`fetchIssueOrPr` in `providers/github.ts`); registered only when GitHub is connected. Results are referenced inline by **Markdown link** (live, not `[[src:]]` — nothing is ingested), and appear as grounded drillable items in the tool trail. System prompt routes GitHub PR/issue questions here.

### 🔴 Must-have before shipping (even read-only)
- [ ] **Cost/rate guard.** Per-workspace budget + rate limit on the sandbox tool (runaway-cost protection). GitHub-specific safety.

### 🟣 Cross-cutting (not a GitHub blocker — project-level)
- [ ] **Gating — Layer 2 per-channel tool profiles.** `investigate_code` is currently callable in *every* channel by anyone; scope it to eng channels. This is a per-channel-per-connector concern shared across all connectors, so it lands as its own project-level layer, not inside the GitHub work.

### 🟡 For the "proper = read + write" bar
- [ ] **Draft-PR write loop (§7.5).** Agent proposes a fix → opens a **draft** PR (never auto-merge) → links it in-thread. Needs App write perms + (for verifying fixes) dep install in the sandbox. The Datadog→code→PR payoff builds on this.

### ⚪ Nice-to-have / robustness
- [ ] Connect-time repo-map → brain (cheap orientation; avoid spinning a sandbox for every question).
- [ ] Session reuse (`Sandbox.connect`) so follow-ups don't re-clone.
- [ ] Re-verify `fetch_source` now that App auth works (was silently broken by the PEM issue).
- [ ] Edge cases: large-repo clone timeout, concurrent-sandbox cap (100/env), mid-stream agent failure, repo-not-found.
- [ ] **Ground GitHub links.** PR/issue refs are emitted as plain Markdown links, so the citation grounder can't catch a fabricated url (the real results are in the trail, but inline links aren't verified). Optional: a `[[gh:owner/repo#n]]` token verified against tool output, or post-hoc link validation.
- [ ] **Confirm `search.issuesAndPullRequests` live** (deprecation: GitHub is nudging toward the `advanced_search` opt-in). Best-effort/defensive today; verify scoping + result shape against a real installation.

## Decisions locked (do NOT re-litigate)
- **No embedding** of GitHub PRs/issues — brain-centric. `SOURCE_INGEST_ENABLED = false` in `github/events.ts` (code kept; user may revisit).
- **No repo caching** (freshness) → clone-per-query, shallow, no deps. Pi comes from our workbench image (exact-pinned).
- **Draft PRs only**, never auto-merge.
- **Webhooks not needed** for GitHub's core loop (brain-centric → no index to sync). They'd only return for proactive notifs/synthesis.
- **Linear is deferred** until GitHub is done; when resumed: proper OAuth + write scope + webhooks from day 1 (tokens expire ~24h w/ refresh — design researched).

## Recommended next step
Repo resolution and live PR/issue search are done — the read side is now trustworthy. One GitHub-specific 🔴 remains:
1. **Cost/rate guard** — per-workspace budget + rate limit on the sandbox tool (the only tool that spends real money / can run away).

Then the 🟡 draft-PR write loop (the read+write bar). Gating is cross-cutting (🟣) and lands as its own project-level layer. Live-verify `search/issues` scoping against a real installation when convenient.
