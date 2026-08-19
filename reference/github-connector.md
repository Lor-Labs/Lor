# GitHub Connector — Status & Definition of Done

Status as of 2026-07-31. The **code-investigation core works end-to-end** (verified live: sandboxed Pi → Kimi K3 through Vercel AI Gateway → read-only tool loop → findings → metered → torn down). It is **NOT "done"** by our bar yet. This is the resume-here doc. (2026-08-10: the sandbox provider moved Railway → **Blaxel** — same flow, engine details updated below; the ported path needs a live GitHub e2e re-verify.) (2026-08-18: the **draft-PR write loop shipped** — `propose_code_change`, gated by the `code_actions` capability; details in Definition of Done. Needs its own live e2e verify.)

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
- [x] **Draft-PR write loop (§7.5) — "code actions" (shipped 2026-08-18; needs live e2e verify).** `propose_code_change` (`packages/merlin/src/code-actions.ts`), gated on the new `code_actions` capability (registry pair with `code_intelligence`, like `linear`/`linear_write`). Engine: `sandbox/code-session.ts` — a **persistent per-conversation-scope sandbox** (`code-{threadRootId ?? channelId}`, `withPersistentSandbox` in `blaxel.ts`) holding one checkout per repo and a resumable Pi session (deterministic uuid from scope+repo), so follow-ups start warm. Flow: read-scoped token mint (narrowed via `createInstallationAccessToken` `repositories`+`permissions`) → clone/fetch+hard-reset (freshness by fetch, the sandbox is a cache not a source of truth) → checkout `lor/<slug>-<rand>` → Pi with `WORKBENCH_PI_TOOLS` (**no token in its env**) → stage+commit as `<app-slug>[bot]` → **orchestrated push**: our command, exact `sha:refs/heads/lor/*` refspec (regex-enforced), explicit URL (never `origin` — the agent could have re-pointed it), `core.hooksPath=/dev/null --no-verify`, write-scoped token as per-command env → `openPullRequest` (`providers/github.ts`, **draft only**, 422-already-exists reuses the open PR so branch-continue updates it). Empty diff ⇒ no PR; diffstat returned for the thread message. `prepareChange`/`publishChange` are split with an `authorizePublish()` choke point in the tool — the future user-configured approval flow plugs in there (persist the serializable `ProposedChange`, publish on approve). Iteration: the tool result returns the branch; passing it back continues the same PR. Idempotent via `SIDE_EFFECT_TOOLS` replay. Placement prompt explicitly keeps code requests out of tasks.

### 🔴 Must-have before shipping (even read-only)
- [ ] **Cost/rate guard.** Per-workspace budget + rate limit on the sandbox tools (runaway-cost protection) — now covers `propose_code_change` too, whose sessions run longer than investigations. GitHub-specific safety.

### 🟣 Cross-cutting (not a GitHub blocker — project-level)
- [ ] **Gating — Layer 2 per-channel tool profiles.** `investigate_code` is currently callable in *every* channel by anyone; scope it to eng channels. This is a per-channel-per-connector concern shared across all connectors, so it lands as its own project-level layer, not inside the GitHub work.

### 🟡 For the "proper = read + write" bar
- [x] ~~Draft-PR write loop (§7.5)~~ — shipped, see above. Remaining from the original item: **dep install / verification in the sandbox is deliberately NOT built** — the customer's own CI on the draft PR is the verifier (add `checks: read` to the App later so Merlin can read results and iterate).

### ⚪ Nice-to-have / robustness
- [ ] Connect-time repo-map → brain (cheap orientation; avoid spinning a sandbox for every question).
- [ ] Session reuse (`Sandbox.connect`) so follow-ups don't re-clone.
- [ ] Re-verify `fetch_source` now that App auth works (was silently broken by the PEM issue).
- [ ] Edge cases: large-repo clone timeout, concurrent-sandbox cap (100/env), mid-stream agent failure, repo-not-found.
- [ ] **Ground GitHub links.** PR/issue refs are emitted as plain Markdown links, so the citation grounder can't catch a fabricated url (the real results are in the trail, but inline links aren't verified). Optional: a `[[gh:owner/repo#n]]` token verified against tool output, or post-hoc link validation.
- [ ] **Confirm `search.issuesAndPullRequests` live** (deprecation: GitHub is nudging toward the `advanced_search` opt-in). Best-effort/defensive today; verify scoping + result shape against a real installation.

## Decisions locked (do NOT re-litigate)
- **No embedding** of GitHub PRs/issues — brain-centric. `SOURCE_INGEST_ENABLED = false` in `github/events.ts` (code kept; user may revisit).
- **No repo caching for reads** (freshness) → investigate clones per query, shallow, no deps. Pi comes from our workbench image (exact-pinned). *Amended 2026-08-18 for writes:* code-action sandboxes persist per conversation scope as a **warm cache** — freshness still comes from a fetch+hard-reset at session start, never from trusting the cached checkout.
- **Draft PRs only**, never auto-merge. Merlin pushes only `lor/*` branches (the product namespace GitHub contributors see), never force-pushes.
- **The coding agent never holds a write token.** Write-scoped tokens (narrowed to one repo, `contents: write`) exist only as per-command env on the orchestrated push, after the session ends.
- **Webhooks not needed** for GitHub's core loop (brain-centric → no index to sync). They'd only return for proactive notifs/synthesis.
- **Linear is deferred** until GitHub is done; when resumed: proper OAuth + write scope + webhooks from day 1 (tokens expire ~24h w/ refresh — design researched).

## Recommended next step
The write loop is built but **needs a live e2e verify** (clone → edit → push → draft PR → branch-continue) against a real installation — note existing installations must accept the App's permission upgrade to Contents/PRs read-write before pushes stop 403ing. Then the one GitHub-specific 🔴:
1. **Cost/rate guard** — per-workspace budget + rate limit on the sandbox tools (the only tools that spend real money / can run away), now more urgent with write sessions.

After that: flip `investigate_code` onto the same persistent scope sandbox (the machinery is proven by code actions; ~1 day) so investigate→propose hands off a warm session. Gating is cross-cutting (🟣) and lands as its own project-level layer. Live-verify `search/issues` scoping against a real installation when convenient.
