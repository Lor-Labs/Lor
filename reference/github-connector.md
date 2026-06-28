# GitHub Connector — Status & Definition of Done

Status as of 2026-06-28. The **code-investigation core works end-to-end** (verified live: clone → agent → streamed nested trail → cited findings → metered → torn down). It is **NOT "done"** by our bar yet. This is the resume-here doc.

## How it works today (as-built)

The flow: Merlin calls the `investigate_code(repo, question)` tool → clone the repo into an ephemeral Railway sandbox at query time → run Claude Code as an autonomous sub-agent → stream its tool calls back live → return findings → Merlin composes the answer.

- **Tool:** `packages/merlin/src/code.ts` (`buildCodeTools`) — registered in `respond()` (`index.ts`) only when `env.RAILWAY_API_TOKEN` is set. Resolves the workspace's active GitHub connection → mints a short-lived installation token (`getInstallationToken`, `providers/github.ts`).
- **Engine:** `packages/merlin/src/sandbox/investigate.ts` → `withSandbox` (`sandbox/index.ts`). Shallow clone (`git clone --depth 1 --single-branch`, **no deps, no checkpoint** — fresh per query) via an `x-access-token` URL. Agent: `claude -p --output-format stream-json --verbose --dangerously-skip-permissions` with `ANTHROPIC_API_KEY` + `IS_SANDBOX=1` baked as sandbox env.
- **Realtime trail:** stream-json parsed off `exec` `onStdout` → each agent `tool_use` emitted as a `merlin:tool` with `parentToolCallId` = the investigate_code call id. Web nests it: `merlin-message-body.tsx` (`childrenByParent`) + `merlin-tool-trail.tsx`. Findings rendered as markdown (small/dimmed). Findings + usage come from the final `result` event.
- **Usage metering:** `packages/merlin/src/usage.ts` (`UsageEvent`/`OnUsage`); worker logs each (`"Merlin tool usage"`, e.g. $0.29 / ~7k tokens). **No Stripe yet** — implementing `onUsage` to persist a row + bill is the seam.
- **Sandbox lifecycle:** `"Sandbox: created"` / `"Sandbox: destroyed"` logs confirm teardown (no surprise billing).
- **SDK:** `railway@3.4.1`; `authType: "project-token"` in `withSandbox` DEFAULTS (RAILWAY_API_TOKEN is a project token); env `RAILWAY_API_TOKEN` + `RAILWAY_ENVIRONMENT_ID`.

## Definition of Done

### ✅ Done
- [x] Code investigation: clone → agentic exploration → findings (with `path#L..` citations).
- [x] Realtime **nested** sub-tool streaming (live trail) + persisted on the message.
- [x] Findings rendered as markdown (dimmed, 11px) in the drill-down, scrollable, untruncated.
- [x] Per-invocation usage metering (seam for billing).
- [x] Sandbox create/destroy logging; full sandbox-exec error logging.
- [x] Auth: GitHub App installation tokens + robust PEM handling.

### 🔴 Must-have before shipping (even read-only)
- [ ] **Gating — Layer 2 per-channel tool profiles.** `investigate_code` (~$0.30/call) is currently callable in *every* channel by anyone. Scope it to eng channels.
- [ ] **Cost/rate guard.** Per-workspace budget + rate limit on the sandbox tool (runaway-cost protection).
- [ ] **Repo resolution.** Merlin currently *guesses* `owner/repo` from its brain/question. Feed it the installation's actual repos (a list-repos tool, or auto-resolve when there's one connected repo). Wrong guess = clone of a nonexistent repo.
- [ ] **On-demand GitHub PR/issue search.** Promised when we turned off embedding; not built. `search_sources` returns nothing now, so "what PRs touched auth?" has no path (`investigate_code` is for *code*, not PR/issue discussion). Build a live GitHub search tool.

### 🟡 For the "proper = read + write" bar
- [ ] **Draft-PR write loop (§7.5).** Agent proposes a fix → opens a **draft** PR (never auto-merge) → links it in-thread. Needs App write perms + (for verifying fixes) dep install in the sandbox. The Datadog→code→PR payoff builds on this.

### ⚪ Nice-to-have / robustness
- [ ] Connect-time repo-map → brain (cheap orientation; avoid spinning a sandbox for every question).
- [ ] Session reuse (`Sandbox.connect`) so follow-ups don't re-clone.
- [ ] Re-verify `fetch_source` now that App auth works (was silently broken by the PEM issue).
- [ ] Edge cases: large-repo clone timeout, concurrent-sandbox cap (100/env), mid-stream agent failure, repo-not-found.
- [ ] **Verify the `stream-json` event schema live** and tighten the parser in `investigate.ts` (currently best-effort/defensive). Decide whether to keep the `getApp` key diagnostic log.

## Decisions locked (do NOT re-litigate)
- **No embedding** of GitHub PRs/issues — brain-centric. `SOURCE_INGEST_ENABLED = false` in `github/events.ts` (code kept; user may revisit).
- **No checkpoints** (100/env cap + freshness) → clone-per-query, shallow, no deps.
- **Draft PRs only**, never auto-merge.
- **Webhooks not needed** for GitHub's core loop (brain-centric → no index to sync). They'd only return for proactive notifs/synthesis.
- **Linear is deferred** until GitHub is done; when resumed: proper OAuth + write scope + webhooks from day 1 (tokens expire ~24h w/ refresh — design researched).

## Recommended next step
**Gating + cost guard (the two 🔴 safety items).** That's the line between "cool demo" and "safe to leave on." Then repo resolution + PR/issue search to make the read side trustworthy; draft-PR write after that.
