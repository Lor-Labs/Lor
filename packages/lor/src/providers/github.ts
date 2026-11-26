import { githubItemKey } from "@repo/connectors"
import { env } from "@repo/env/server"
import { parseGithubInstallationId } from "@repo/utils/github"
import { App, type Octokit } from "octokit"
import { logger } from "../logger"
import type { SourceFetcher, SourceProvider } from "./types"

function fromBase64(s: string): string | undefined {
  try {
    return Buffer.from(s, "base64").toString("utf8")
  } catch {
    return undefined
  }
}

// .env often strips PEM newlines; re-emit canonical header/body/footer form.
function rewrapPem(key: string): string {
  const match = key.match(
    /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/
  )
  const type = match?.[1]
  if (!type) return key
  const body = (match[2] ?? "").replace(/\s+/g, "")
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body
  return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----\n`
}

// Accept multi-line, escaped-newline, single-line, or base64-encoded PEMs.
// PEM from env: real newlines, "\n" escapes, or base64. Also used for the
// Code Storage key (code-checkpoints.ts).
export function normalizePrivateKey(
  raw: string | undefined
): string | undefined {
  if (!raw) return undefined
  let key = raw.trim()
  if (!key.includes("-----BEGIN")) {
    const decoded = fromBase64(key)
    if (decoded?.includes("-----BEGIN")) key = decoded
  }
  key = key.replace(/\\n/g, "\n")
  return rewrapPem(key)
}

let cachedApp: App | null | undefined
function getApp(): App | null {
  if (cachedApp !== undefined) return cachedApp
  const appId = env.GITHUB_APP_ID
  const raw = env.GITHUB_APP_PRIVATE_KEY
  const privateKey = normalizePrivateKey(raw)
  // Safe metadata only; never log key bytes.
  if (raw) {
    logger.info(
      {
        appIdSet: Boolean(appId),
        keyLength: privateKey?.length ?? 0,
        pemType: privateKey?.match(/-----BEGIN ([A-Z0-9 ]+?)-----/)?.[1] ?? "?",
        lineCount: privateKey?.split("\n").length ?? 0,
      },
      "GitHub App private key loaded"
    )
  }
  cachedApp = appId && privateKey ? new App({ appId, privateKey }) : null
  return cachedApp
}

// Bound each GitHub request so a hung connection can't stall the caller (Octokit
// has no default request timeout).
const REQUEST_TIMEOUT_MS = 10_000

// Narrow a minted installation token below the App's full grant. `repositories`
// takes bare repo names (not owner/repo); a token can only ever be a subset of
// what the App itself was granted.
export type InstallationTokenScope = {
  repositories?: string[]
  permissions?: {
    contents?: "read" | "write"
    pull_requests?: "read" | "write"
  }
  request?: { signal: AbortSignal }
}

export async function getInstallationToken(
  installationId: string,
  scope?: InstallationTokenScope
): Promise<string | null> {
  const app = getApp()
  if (!app) {
    logger.warn(
      "GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) — cannot mint an installation token"
    )
    return null
  }
  const id = parseGithubInstallationId(installationId)
  if (id === null) {
    logger.warn({ installationId }, "Invalid GitHub installation id")
    return null
  }
  try {
    const { data } = await app.octokit.rest.apps.createInstallationAccessToken({
      installation_id: id,
      ...(scope?.repositories ? { repositories: scope.repositories } : {}),
      ...(scope?.permissions ? { permissions: scope.permissions } : {}),
      request: scope?.request ?? {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    })
    return data.token
  } catch (err) {
    logger.error(
      { err, installationId: id },
      "Failed to mint GitHub installation access token"
    )
    return null
  }
}

export type InstallationRepo = {
  fullName: string
  private: boolean
  defaultBranch: string
  pushedAt: string | null
}

const REPO_PAGE_SIZE = 100
const MAX_REPO_PAGES = 5

export async function listInstallationRepos(
  installationId: string
): Promise<InstallationRepo[]> {
  const app = getApp()
  if (!app) return []
  const id = parseGithubInstallationId(installationId)
  if (id === null) return []
  try {
    const octokit = await app.getInstallationOctokit(id)
    const repos: InstallationRepo[] = []
    for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
      const { data } =
        await octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: REPO_PAGE_SIZE,
          page,
          request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        })
      for (const r of data.repositories) {
        repos.push({
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          pushedAt: r.pushed_at ?? null,
        })
      }
      if (data.repositories.length < REPO_PAGE_SIZE) break
    }
    repos.sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))
    return repos
  } catch (err) {
    logger.error(
      { err, installationId: id },
      "Failed to list installation repos"
    )
    return []
  }
}

export type RepoBranches = { defaultBranch: string | null; branches: string[] }

const BRANCH_PAGE_SIZE = 50

// Branches for the code session picker. GitHub filters by name, so a repo with
// thousands of branches still finds the one being typed. REST has no name
// search; GraphQL `refs(query:)` does.
export async function listRepoBranches(
  installationId: string,
  repoFullName: string,
  query: string
): Promise<RepoBranches | null> {
  const app = getApp()
  if (!app) return null
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const [owner, name] = repoFullName.split("/")
  if (!(owner && name)) return null
  try {
    const octokit = await app.getInstallationOctokit(id)
    const { repository } = await octokit.graphql<{
      repository: {
        defaultBranchRef: { name: string } | null
        refs: { nodes: { name: string }[] } | null
      } | null
    }>(
      `query ($owner: String!, $name: String!, $filter: String, $first: Int!) {
        repository(owner: $owner, name: $name) {
          defaultBranchRef { name }
          refs(refPrefix: "refs/heads/", query: $filter, first: $first, orderBy: { field: ALPHABETICAL, direction: ASC }) {
            nodes { name }
          }
        }
      }`,
      {
        owner,
        name,
        // "query" is reserved by @octokit/graphql (it carries the document).
        filter: query.trim() || undefined,
        first: BRANCH_PAGE_SIZE,
        request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      }
    )
    if (!repository) return null
    const defaultBranch = repository.defaultBranchRef?.name ?? null
    const names = (repository.refs?.nodes ?? []).map((ref) => ref.name)
    // The default branch leads when it matches, and always with no query (it
    // can sort past the first page).
    const lead =
      defaultBranch && (!query.trim() || names.includes(defaultBranch))
        ? defaultBranch
        : null
    const branches = lead ? [lead, ...names.filter((n) => n !== lead)] : names
    return { defaultBranch, branches }
  } catch (err) {
    logger.error({ err, repoFullName }, "GitHub branch list failed")
    return null
  }
}

export async function getInstallationOverview(
  installationId: string
): Promise<{ repos: InstallationRepo[]; manageUrl: string | null } | null> {
  const app = getApp()
  if (!app) return null
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const [repos, manageUrl] = await Promise.all([
    listInstallationRepos(installationId),
    app.octokit.rest.apps
      .getInstallation({
        installation_id: id,
        request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      })
      .then((r) => r.data.html_url ?? null)
      .catch(() => null),
  ])
  return { repos, manageUrl }
}

export type IssueSearchHit = {
  ref: string // "owner/repo#number" — pass to fetchIssueOrPr
  type: "pull_request" | "issue"
  number: number
  repo: string // "owner/repo"
  title: string
  state: string // open / closed / merged
  author: string | null
  url: string
  updatedAt: string
  snippet: string
}

const SEARCH_SNIPPET = 240

export async function searchIssues(
  installationId: string,
  opts: {
    query: string
    repos: string[]
    type?: "pull_request" | "issue"
    limit: number
  }
): Promise<IssueSearchHit[]> {
  const app = getApp()
  if (!app) return []
  const id = parseGithubInstallationId(installationId)
  if (id === null) return []
  if (opts.repos.length === 0) return []
  try {
    const octokit = await app.getInstallationOctokit(id)
    const scope = opts.repos.map((r) => `repo:${r}`).join(" ")
    const typeQ =
      opts.type === "pull_request"
        ? " is:pr"
        : opts.type === "issue"
          ? " is:issue"
          : ""
    const q = `${opts.query} ${scope}${typeQ}`.trim()
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q,
      per_page: opts.limit,
      sort: "updated",
      order: "desc",
    })
    return data.items.map((it) => {
      const isPr = Boolean(it.pull_request)
      const repo = it.repository_url.split("/repos/")[1] ?? ""
      const state =
        isPr && it.pull_request?.merged_at ? "merged" : (it.state ?? "open")
      return {
        ref: `${repo}#${it.number}`,
        type: isPr ? "pull_request" : "issue",
        number: it.number,
        repo,
        title: it.title,
        state,
        author: it.user?.login ?? null,
        url: it.html_url,
        updatedAt: it.updated_at,
        snippet: (it.body ?? "").trim().slice(0, SEARCH_SNIPPET),
      }
    })
  } catch (err) {
    logger.error({ err, installationId: id }, "GitHub issue search failed")
    return []
  }
}

export type RepoTreeEntry = {
  path: string
  type: "blob" | "tree"
}

export type RepoTree = {
  ref: string
  entries: RepoTreeEntry[]
  // GitHub caps the recursive tree response; past that the listing is partial.
  truncated: boolean
}

// Cap what we keep per repo — a monorepo tree can be six figures of paths, and
// the picker only ever shows a handful.
const MAX_TREE_ENTRIES = 20_000
// Longer than the per-request default: a whole tree is a big response.
const TREE_REQUEST_TIMEOUT_MS = 15_000

// One recursive call returns every path in the repo, which the composer's file
// picker then filters locally. Callers are expected to cache this.
export async function fetchRepoTree(
  installationId: string,
  repoFullName: string,
  ref: string
): Promise<RepoTree | null> {
  const app = getApp()
  if (!app) return null
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const [owner, repo] = repoFullName.split("/")
  if (!(owner && repo)) return null

  try {
    const octokit = await app.getInstallationOctokit(id)
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "1",
      request: { signal: AbortSignal.timeout(TREE_REQUEST_TIMEOUT_MS) },
    })
    const entries = data.tree.flatMap<RepoTreeEntry>((entry) =>
      entry.path && (entry.type === "blob" || entry.type === "tree")
        ? [{ path: entry.path, type: entry.type }]
        : []
    )
    return {
      ref,
      entries: entries.slice(0, MAX_TREE_ENTRIES),
      truncated: Boolean(data.truncated) || entries.length > MAX_TREE_ENTRIES,
    }
  } catch (err) {
    logger.error({ err, repoFullName, ref }, "GitHub tree fetch failed")
    return null
  }
}

export type FetchedIssue = {
  ref: string
  type: "pull_request" | "issue"
  title: string
  state: string
  url: string
  content: string
}

// fetch_github budget. The body and each comment are clipped on their own so a
// long PR description or bot summary can't crowd out the rest; when the
// discussion still overflows, the oldest comments are dropped (latest kept).
const FETCH_TOTAL_CHARS = 40_000
const FETCH_BODY_CHARS = 8_000
const FETCH_COMMENT_CHARS = 6_000
const FETCH_PAGE_SIZE = 100
const FAILED_RUNS_DETAILED = 5
const ANNOTATIONS_PER_RUN = 10

function clipTo(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s
}

// Review bots (Greptile, CodeRabbit, CI reporters) post mostly HTML: hidden
// comments, badge images, <details> wrappers. Strip it outside code fences so
// the findings fit the budget.
function stripGithubHtml(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<img\b[^>]*>/gi, "")
            .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(
              /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
              (_, href: string, text: string) =>
                text.trim() ? `[${text.trim()}](${href})` : ""
            )
            .replace(/<\/?code\b[^>]*>/gi, "`")
            .replace(
              /<\/?(?:b|strong|em|i|span|sub|sup|kbd|picture|source)\b[^>]*>/gi,
              ""
            )
            .replace(
              /<br\s*\/?>|<\/?(?:details|summary|p|div|h[1-6]|table|thead|tbody|tr|td|th|ul|ol|li|blockquote)\b[^>]*>/gi,
              "\n"
            )
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
    )
    .join("")
    .trim()
}

const forbidden = (err: unknown) => {
  const status = (err as { status?: number }).status
  return status === 403 || status === 404
}

// Check runs on the PR head, with failure annotations (the failing step and
// error lines) for failed runs. Needs the App's Checks: read permission;
// Actions logs need Actions: read and aren't fetched here.
async function checkRunsText(
  octokit: Octokit,
  target: { owner: string; repo: string },
  sha: string,
  request: () => { signal: AbortSignal }
): Promise<string> {
  let runs: Awaited<
    ReturnType<Octokit["rest"]["checks"]["listForRef"]>
  >["data"]["check_runs"]
  try {
    runs = (
      await octokit.rest.checks.listForRef({
        ...target,
        ref: sha,
        per_page: FETCH_PAGE_SIZE,
        request: request(),
      })
    ).data.check_runs
  } catch (err) {
    return forbidden(err)
      ? "Checks: unavailable. The Lor GitHub App isn't granted Checks: read on this repository."
      : "Checks: couldn't be read right now."
  }
  if (runs.length === 0) return `Checks on ${sha.slice(0, 7)}: none`

  const failed = runs.filter(
    (run) => run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)
  )
  const annotations = await Promise.all(
    failed.slice(0, FAILED_RUNS_DETAILED).map((run) =>
      run.output.annotations_count > 0
        ? octokit.rest.checks
            .listAnnotations({
              ...target,
              check_run_id: run.id,
              per_page: ANNOTATIONS_PER_RUN,
              request: request(),
            })
            .then((r) => r.data)
            .catch(() => [])
        : Promise.resolve([])
    )
  )
  const detail = new Map(
    failed.slice(0, FAILED_RUNS_DETAILED).map((run, i) => [run.id, i])
  )

  const lines = runs.map((run) => {
    const result = run.status === "completed" ? run.conclusion : run.status
    let line = `- ${run.name}: ${result ?? "unknown"}${run.details_url ? ` (${run.details_url})` : ""}`
    const i = detail.get(run.id)
    if (i === undefined) return line
    const title = run.output.title?.trim()
    const summary = run.output.summary?.trim()
    if (title) line += `\n  ${title}`
    if (summary) line += `\n  ${clipTo(stripGithubHtml(summary), 1_500)}`
    for (const a of annotations[i] ?? []) {
      line += `\n  ${a.annotation_level ?? "note"} ${a.path}:${a.start_line}: ${clipTo(a.message ?? "", 500)}`
    }
    return line
  })
  const hint =
    failed.length > 0
      ? "\n(fetch_github with logs: true reads the failed jobs' steps and logs)"
      : ""
  return `Checks on ${sha.slice(0, 7)}:\n${lines.join("\n")}${hint}`
}

export async function fetchIssueOrPr(
  installationId: string,
  ref: string
): Promise<FetchedIssue | null> {
  const app = getApp()
  if (!app) return null
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const parsed = parseRef(ref, "#")
  if (!parsed) return null
  const request = () => ({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  try {
    const octokit = await app.getInstallationOctokit(id)
    const target = { owner: parsed.owner, repo: parsed.repo }
    const { data } = await octokit.rest.issues.get({
      ...target,
      issue_number: parsed.id,
      request: request(),
    })
    const isPr = Boolean(data.pull_request)
    const state =
      isPr && data.pull_request?.merged_at ? "merged" : (data.state ?? "open")
    const page = { ...target, per_page: FETCH_PAGE_SIZE, request: request() }

    const [comments, reviews, reviewComments, checks] = await Promise.all([
      octokit
        .paginate(octokit.rest.issues.listComments, {
          ...page,
          issue_number: parsed.id,
        })
        .catch(() => []),
      isPr
        ? octokit
            .paginate(octokit.rest.pulls.listReviews, {
              ...page,
              pull_number: parsed.id,
            })
            .catch(() => [])
        : [],
      isPr
        ? octokit
            .paginate(octokit.rest.pulls.listReviewComments, {
              ...page,
              pull_number: parsed.id,
            })
            .catch(() => [])
        : [],
      isPr
        ? octokit.rest.pulls
            .get({ ...target, pull_number: parsed.id, request: request() })
            .then((r) =>
              checkRunsText(octokit, target, r.data.head.sha, request)
            )
            .catch(() => "Checks: couldn't be read right now.")
        : null,
    ])

    const entry = (at: string | null | undefined, text: string) => ({
      at: at ?? "",
      text: clipTo(stripGithubHtml(text), FETCH_COMMENT_CHARS),
    })
    const discussion = [
      ...comments.flatMap((c) =>
        c.body?.trim()
          ? [
              entry(
                c.created_at,
                `— ${login(c.user)} (${day(c.created_at)}): ${c.body}`
              ),
            ]
          : []
      ),
      ...reviews.flatMap((r) => {
        const body = r.body?.trim()
        if (r.state === "COMMENTED" && !body) return []
        const verdict = REVIEW_VERDICTS[r.state] ?? r.state.toLowerCase()
        return [
          entry(
            r.submitted_at,
            `— ${login(r.user)} reviewed: ${verdict} (${day(r.submitted_at)})${body ? `: ${body}` : ""}`
          ),
        ]
      }),
      ...reviewComments.map((c) =>
        entry(
          c.created_at,
          `— ${login(c.user)} on ${c.path}${c.line ? `:${c.line}` : ""} (${day(c.created_at)}): ${c.body}`
        )
      ),
    ].sort((a, b) => a.at.localeCompare(b.at))

    const head = [
      `# ${data.title}\nState: ${state} · by ${login(data.user)}`,
      clipTo(
        stripGithubHtml(data.body ?? "") || "(no description)",
        FETCH_BODY_CHARS
      ),
      ...(checks ? [checks] : []),
    ].join("\n\n")

    let used = head.length
    let keepFrom = discussion.length
    while (keepFrom > 0) {
      const next = (discussion[keepFrom - 1]?.text.length ?? 0) + 2
      if (used + next > FETCH_TOTAL_CHARS) break
      used += next
      keepFrom -= 1
    }
    const parts = [head]
    if (keepFrom > 0) {
      parts.push(
        `(${keepFrom} earlier comment${keepFrom === 1 ? "" : "s"} omitted to fit; ${discussion.length - keepFrom} latest shown)`
      )
    }
    parts.push(...discussion.slice(keepFrom).map((d) => d.text))

    return {
      ref: `${parsed.owner}/${parsed.repo}#${parsed.id}`,
      type: isPr ? "pull_request" : "issue",
      title: data.title,
      state,
      url: data.html_url,
      content: parts.join("\n\n"),
    }
  } catch (err) {
    logger.error({ err, ref }, "GitHub issue/PR fetch failed")
    return null
  }
}

// One commit's CI: check runs (GitHub Actions jobs, apps like Vercel) and
// legacy commit statuses, for the session's Checks list, its checks cards and
// fetch_github's logs mode. Check runs need the App's Checks: read; statuses
// need Commit statuses: read and are skipped without it.
export type CommitCheckState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "skipped"
  | "neutral"

export type CommitCheck = {
  // The check run id (for GitHub Actions, also the job id); null for a
  // commit status.
  id: number | null
  name: string
  state: CommitCheckState
  url: string | null
  // The app that ran it ("github-actions", "vercel"); null for a status.
  app: string | null
}

export type CommitChecks = {
  sha: string
  // forbidden: the App lacks Checks: read on the repository.
  access: "ok" | "forbidden" | "error"
  checks: CommitCheck[]
}

type CheckRun = Awaited<
  ReturnType<Octokit["rest"]["checks"]["listForRef"]>
>["data"]["check_runs"][number]

function checkRunState(run: {
  status: string
  conclusion: string | null
}): CommitCheckState {
  if (run.status === "queued" || run.status === "pending") return "queued"
  if (run.status !== "completed") return "running"
  switch (run.conclusion) {
    case "success":
      return "passed"
    case "cancelled":
      return "cancelled"
    case "skipped":
      return "skipped"
    case "neutral":
    case "stale":
      return "neutral"
    default:
      return "failed"
  }
}

const CHECK_ORDER: Record<CommitCheckState, number> = {
  failed: 0,
  running: 1,
  queued: 2,
  cancelled: 3,
  passed: 4,
  neutral: 5,
  skipped: 6,
}

async function listCheckRuns(
  octokit: Octokit,
  target: { owner: string; repo: string },
  sha: string
): Promise<CheckRun[]> {
  return octokit.paginate(octokit.rest.checks.listForRef, {
    ...target,
    ref: sha,
    per_page: FETCH_PAGE_SIZE,
    request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  })
}

export async function fetchCommitChecks(
  installationId: string,
  repoFullName: string,
  sha: string
): Promise<CommitChecks | null> {
  const app = getApp()
  const id = parseGithubInstallationId(installationId)
  const [owner, repo] = repoFullName.split("/")
  if (!app || id === null || !(owner && repo)) return null
  const octokit = await app.getInstallationOctokit(id)
  const target = { owner, repo }
  const [runs, statuses] = await Promise.all([
    listCheckRuns(octokit, target, sha).catch((err: unknown) =>
      forbidden(err) ? ("forbidden" as const) : ("error" as const)
    ),
    octokit.rest.repos
      .getCombinedStatusForRef({
        ...target,
        ref: sha,
        per_page: FETCH_PAGE_SIZE,
        request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      })
      .then((r) => r.data.statuses)
      .catch(() => []),
  ])
  const checks: CommitCheck[] = [
    ...(Array.isArray(runs) ? runs : []).map((run) => ({
      id: run.id,
      name: run.name,
      state: checkRunState(run),
      url: run.details_url ?? run.html_url ?? null,
      app: run.app?.slug ?? null,
    })),
    ...statuses.map((status) => ({
      id: null,
      name: status.context,
      state: (status.state === "success"
        ? "passed"
        : status.state === "pending"
          ? "running"
          : "failed") as CommitCheckState,
      url: status.target_url ?? null,
      app: null,
    })),
  ].sort(
    (a, b) =>
      CHECK_ORDER[a.state] - CHECK_ORDER[b.state] ||
      a.name.localeCompare(b.name)
  )
  return {
    sha,
    access: Array.isArray(runs) ? "ok" : runs,
    checks,
  }
}

const LOG_RUNS_MAX = 3
const LOG_CONTEXT_LINES = 150
const LOG_WINDOW_LINES = 300
const LOG_RUN_CHARS = 12_000
const LOG_TIMEOUT_MS = 20_000

// The part of an Actions job log that explains the failure: from a little
// before the first ##[error] line to just after the last, else the tail.
// Timestamps and ANSI colors are stripped.
function logExcerpt(raw: string): string {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes
        .replace(/\x1b\[[0-9;]*m/g, "")
    )
  const errors = lines.flatMap((line, i) =>
    line.includes("##[error]") ? [i] : []
  )
  const first = errors[0]
  const last = errors.at(-1)
  let start: number
  let end: number
  if (first === undefined || last === undefined) {
    end = lines.length
    start = Math.max(0, end - LOG_CONTEXT_LINES)
  } else {
    end = Math.min(lines.length, last + 10)
    start = Math.max(0, first - LOG_CONTEXT_LINES, end - LOG_WINDOW_LINES)
  }
  let text = lines.slice(start, end).join("\n").trim()
  if (text.length > LOG_RUN_CHARS) {
    text = `…${text.slice(text.length - LOG_RUN_CHARS)}`
  }
  return `(log lines ${start + 1}–${end} of ${lines.length})\n${text}`
}

async function checkRunLogText(
  octokit: Octokit,
  target: { owner: string; repo: string },
  run: CheckRun
): Promise<string> {
  const result = run.status === "completed" ? run.conclusion : run.status
  const head = `## ${run.name}: ${result ?? "unknown"}${run.details_url ? ` (${run.details_url})` : ""}`
  if (run.app?.slug !== "github-actions") {
    const output = [run.output.title, run.output.summary, run.output.text]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join("\n\n")
    return `${head}\nRun by ${run.app?.name ?? "another app"}, not GitHub Actions: no log to read here.${output ? `\n\n${clipTo(stripGithubHtml(output), LOG_RUN_CHARS)}` : ""}`
  }
  const request = () => ({ signal: AbortSignal.timeout(LOG_TIMEOUT_MS) })
  try {
    const [{ data: job }, { data: log }] = await Promise.all([
      octokit.rest.actions.getJobForWorkflowRun({
        ...target,
        job_id: run.id,
        request: request(),
      }),
      octokit.request("GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs", {
        ...target,
        job_id: run.id,
        request: request(),
      }),
    ])
    const steps = (job.steps ?? [])
      .map(
        (step) =>
          `- ${step.number}. ${step.name}: ${step.conclusion ?? step.status}`
      )
      .join("\n")
    // The log redirects to blob storage; its content type decides whether
    // Octokit hands back text or bytes.
    const raw =
      typeof log === "string"
        ? log
        : log instanceof ArrayBuffer
          ? new TextDecoder().decode(log)
          : null
    const logText = raw ? logExcerpt(raw) : "(no log)"
    return `${head}\nSteps:\n${steps || "(none)"}\n\nLog:\n${logText}`
  } catch (err) {
    return forbidden(err)
      ? `${head}\nLog unavailable: the Lor GitHub App isn't granted Actions: read on this repository.`
      : `${head}\nLog couldn't be read right now.`
  }
}

// fetch_github's logs mode: the pull request head's failed checks (or the
// ones whose name contains `check`), each with its Actions job steps and an
// excerpt of its log around the errors.
export async function fetchPullRequestCheckLogs(
  installationId: string,
  ref: string,
  check?: string
): Promise<FetchedIssue | { error: string } | null> {
  const app = getApp()
  const id = parseGithubInstallationId(installationId)
  const parsed = parseRef(ref, "#")
  if (!app || id === null || !parsed) return null
  try {
    const octokit = await app.getInstallationOctokit(id)
    const target = { owner: parsed.owner, repo: parsed.repo }
    const pr = await octokit.rest.pulls
      .get({
        ...target,
        pull_number: parsed.id,
        request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      })
      .then((r) => r.data)
      .catch((err: unknown) => {
        if ((err as { status?: number }).status === 404) return null
        throw err
      })
    if (!pr) return { error: `${ref} isn't a pull request` }
    let runs: CheckRun[]
    try {
      runs = await listCheckRuns(octokit, target, pr.head.sha)
    } catch (err) {
      if (!forbidden(err)) throw err
      return {
        error:
          "The Lor GitHub App isn't granted Checks: read on this repository, so its checks can't be read.",
      }
    }
    const wanted = check?.trim().toLowerCase()
    const chosen = runs.filter((run) =>
      wanted
        ? run.name.toLowerCase().includes(wanted)
        : checkRunState(run) === "failed"
    )
    const sha = pr.head.sha.slice(0, 7)
    let content: string
    if (chosen.length === 0) {
      content = wanted
        ? `No check on ${sha} matches "${check}". Checks: ${runs.map((run) => run.name).join(", ") || "none"}`
        : `No failed checks on ${sha} (${runs.length} check run${runs.length === 1 ? "" : "s"}).`
    } else {
      const parts = await Promise.all(
        chosen
          .slice(0, LOG_RUNS_MAX)
          .map((run) => checkRunLogText(octokit, target, run))
      )
      const more = chosen.length - LOG_RUNS_MAX
      content = [
        `# Checks on ${sha} for #${pr.number} ${pr.title}`,
        ...parts,
        ...(more > 0
          ? [
              `(${more} more: ${chosen
                .slice(LOG_RUNS_MAX)
                .map((run) => run.name)
                .join(", ")}; pass check to read one)`,
            ]
          : []),
      ].join("\n\n")
    }
    return {
      ref: `${parsed.owner}/${parsed.repo}#${parsed.id}`,
      type: "pull_request",
      title: pr.title,
      state: pr.merged_at ? "merged" : pr.state,
      url: pr.html_url,
      content,
    }
  } catch (err) {
    logger.error({ err, ref }, "GitHub check logs fetch failed")
    return null
  }
}

export type PullRequestCard = {
  ref: string
  title: string
  url: string
  state: "open" | "draft" | "merged" | "closed"
  author: string | null
  authorAvatarUrl: string | null
  additions: number
  deletions: number
  review: "approved" | "changes_requested" | "waiting" | null
  checks: "passing" | "failing" | "running" | null
  updatedAt: string
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
])

// A pull request's live state for a card in Lor's window: the PR, its
// reviews (each reviewer's latest verdict), and its check runs.
export async function fetchPullRequestCard(
  installationId: string,
  ref: string
): Promise<PullRequestCard | null> {
  const app = getApp()
  const id = parseGithubInstallationId(installationId)
  const parsed = parseRef(ref, "#")
  if (!app || id === null || !parsed) return null
  const request = () => ({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  try {
    const octokit = await app.getInstallationOctokit(id)
    const target = { owner: parsed.owner, repo: parsed.repo }
    const { data: pr } = await octokit.rest.pulls.get({
      ...target,
      pull_number: parsed.id,
      request: request(),
    })
    const [reviews, checkRuns] = await Promise.all([
      octokit.rest.pulls
        .listReviews({
          ...target,
          pull_number: parsed.id,
          per_page: 100,
          request: request(),
        })
        .then((r) => r.data)
        .catch(() => []),
      octokit.rest.checks
        .listForRef({
          ...target,
          ref: pr.head.sha,
          per_page: 100,
          request: request(),
        })
        .then((r) => r.data.check_runs)
        .catch(() => []),
    ])

    const verdicts = new Map<string, string>()
    for (const review of reviews) {
      if (review.user && review.state !== "COMMENTED") {
        verdicts.set(review.user.login, review.state)
      }
    }
    const latest = [...verdicts.values()]
    const review = latest.includes("CHANGES_REQUESTED")
      ? "changes_requested"
      : latest.includes("APPROVED")
        ? "approved"
        : (pr.requested_reviewers?.length ?? 0) > 0
          ? "waiting"
          : null
    const checks =
      checkRuns.length === 0
        ? null
        : checkRuns.some(
              (run) => run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)
            )
          ? "failing"
          : checkRuns.some((run) => run.status !== "completed")
            ? "running"
            : "passing"

    return {
      ref: `${parsed.owner}/${parsed.repo}#${parsed.id}`,
      title: pr.title,
      url: pr.html_url,
      state: pr.merged_at
        ? "merged"
        : pr.state === "closed"
          ? "closed"
          : pr.draft
            ? "draft"
            : "open",
      author: pr.user?.login ?? null,
      authorAvatarUrl: pr.user?.avatar_url ?? null,
      additions: pr.additions,
      deletions: pr.deletions,
      review,
      checks,
      updatedAt: pr.updated_at,
    }
  } catch (err) {
    logger.warn({ err, ref }, "GitHub pull request card fetch failed")
    return null
  }
}

function parseRef(externalId: string, sep: "#" | "@") {
  const [ownerRepo, tail] = externalId.split(sep)
  const [owner, repo] = (ownerRepo ?? "").split("/")
  const id = Number(tail)
  if (!owner || !repo || !Number.isFinite(id)) return null
  return { owner, repo, id }
}

// Ingestion reads the whole first page of each discussion list, more than
// fetch_github: comments and reviews are where decisions live.
const INGEST_PAGE_SIZE = 100
const INGEST_REQUEST_TIMEOUT_MS = 15_000

const REVIEW_VERDICTS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
}

type GithubUser = { login: string; type: string } | null | undefined

const login = (user: GithubUser) => user?.login ?? "unknown"
const day = (iso: string | null | undefined) => iso?.slice(0, 10) ?? "?"

// Bot output (CI reports, AI review summaries) is long LLM-written text that
// retrievers over-rank. The item stays; its bot comments don't.
const isBot = (user: GithubUser) => user?.type === "Bot"

// One PR or issue with its discussion, as text for `source`. `ref` is a
// lowercased owner/repo#n key. 404 and 410 mean deleted or out of the
// installation's reach.
export const fetchGithubSourceItem: SourceFetcher = async (
  connection,
  _kind,
  ref
) => {
  const app = getApp()
  if (!app) throw new Error("GitHub App not configured")
  const installationId = parseGithubInstallationId(connection.externalId)
  const parsed = parseRef(ref, "#")
  if (installationId === null || !parsed) {
    return { item: null, gone: [] }
  }
  const octokit = await app.getInstallationOctokit(installationId)
  const request = () => ({
    signal: AbortSignal.timeout(INGEST_REQUEST_TIMEOUT_MS),
  })

  let issue: Awaited<ReturnType<typeof octokit.rest.issues.get>>["data"]
  try {
    const response = await octokit.rest.issues.get({
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: parsed.id,
      request: request(),
    })
    issue = response.data
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 404 || status === 410) return { item: null, gone: [ref] }
    throw err
  }

  const repo =
    issue.repository_url.split("/repos/")[1] ?? `${parsed.owner}/${parsed.repo}`
  const [owner = parsed.owner, name = parsed.repo] = repo.split("/")
  const target = { owner, repo: name, per_page: INGEST_PAGE_SIZE }
  const isPr = Boolean(issue.pull_request)
  const [comments, reviews, reviewComments] = await Promise.all([
    octokit.rest.issues
      .listComments({
        ...target,
        issue_number: issue.number,
        request: request(),
      })
      .then((r) => r.data),
    isPr
      ? octokit.rest.pulls
          .listReviews({
            ...target,
            pull_number: issue.number,
            request: request(),
          })
          .then((r) => r.data)
      : [],
    isPr
      ? octokit.rest.pulls
          .listReviewComments({
            ...target,
            pull_number: issue.number,
            request: request(),
          })
          .then((r) => r.data)
      : [],
  ])

  const discussion = [
    ...comments.flatMap((c) =>
      isBot(c.user) || !c.body?.trim()
        ? []
        : [
            {
              at: c.created_at,
              text: `— ${login(c.user)} (${day(c.created_at)}): ${c.body.trim()}`,
            },
          ]
    ),
    ...reviews.flatMap((r) => {
      const verdict = REVIEW_VERDICTS[r.state]
      const body = r.body?.trim()
      if (isBot(r.user) || !verdict || (r.state === "COMMENTED" && !body)) {
        return []
      }
      return [
        {
          at: r.submitted_at ?? "",
          text: `— ${login(r.user)} reviewed: ${verdict} (${day(r.submitted_at)})${body ? `: ${body}` : ""}`,
        },
      ]
    }),
    ...reviewComments.flatMap((c) =>
      isBot(c.user) || !c.body.trim()
        ? []
        : [
            {
              at: c.created_at,
              text: `— ${login(c.user)} on ${c.path} (${day(c.created_at)}): ${c.body.trim()}`,
            },
          ]
    ),
  ].sort((a, b) => a.at.localeCompare(b.at))

  const mergedAt = issue.pull_request?.merged_at
  const state = mergedAt
    ? "merged"
    : isPr && issue.draft && issue.state === "open"
      ? "draft"
      : issue.state
  const labels = issue.labels.flatMap((l) =>
    typeof l === "string" ? [l] : l.name ? [l.name] : []
  )
  const meta = [
    `${isPr ? "Pull request" : "Issue"} ${repo}#${issue.number}`,
    !isPr && issue.state_reason === "not_planned"
      ? "closed as not planned"
      : state,
    `by ${login(issue.user)}`,
    `opened ${day(issue.created_at)}`,
    mergedAt
      ? `merged ${day(mergedAt)}`
      : issue.closed_at
        ? `closed ${day(issue.closed_at)}`
        : null,
    labels.length > 0 ? `labels: ${labels.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const key = githubItemKey(repo, issue.number)
  return {
    item: {
      kind: isPr ? "pull_request" : "issue",
      externalId: key,
      url: issue.html_url,
      title: issue.title,
      author: issue.user?.login ?? null,
      state,
      body: [
        meta,
        issue.body?.trim() || "(no description)",
        ...discussion.map((d) => d.text),
      ].join("\n\n"),
      sourceCreatedAt: new Date(issue.created_at),
      sourceUpdatedAt: new Date(issue.updated_at),
    },
    // A transferred issue or renamed repo answers under its new key.
    gone: key === ref ? [] : [ref],
  }
}

export const githubProvider: SourceProvider = {
  async verifyConnection(connection) {
    const app = getApp()
    if (!app) return null
    const installationId = parseGithubInstallationId(connection.externalId)
    if (installationId === null) return null
    try {
      const { data } = await app.octokit.rest.apps.getInstallation({
        installation_id: installationId,
      })
      const account = data.account
      const accountLabel = account && "login" in account ? account.login : null
      return { accountLabel }
    } catch {
      return null
    }
  },
}

export type GithubReviewAuthor = {
  login: string
  avatarUrl: string
  __typename: string
} | null

export type GithubBranchPullRequest = {
  number: number
  url: string
  title: string
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  headRefOid: string
  reviews: {
    databaseId: number
    state: string
    body: string
    url: string
    submittedAt: string | null
    author: GithubReviewAuthor
  }[]
  threads: {
    id: string
    isResolved: boolean
    isOutdated: boolean
    path: string
    line: number | null
    originalLine: number | null
    comments: {
      databaseId: number
      body: string
      url: string
      createdAt: string
      author: GithubReviewAuthor
      pullRequestReview: { databaseId: number } | null
    }[]
  }[]
}

// The newest pull request whose head is `branch` in the repo itself (a
// fork's same-named branch is someone else's), with its reviews and review
// threads. reference/planned/pr-reviews.md.
export async function fetchBranchPullRequest(
  installationId: string,
  repoFullName: string,
  branch: string
): Promise<GithubBranchPullRequest | null> {
  const app = getApp()
  if (!app) return null
  const id = parseGithubInstallationId(installationId)
  if (id === null) return null
  const [owner, name] = repoFullName.split("/")
  if (!(owner && name)) return null
  const author = "author { login avatarUrl __typename }"
  const octokit = await app.getInstallationOctokit(id)
  const { repository } = await octokit.graphql<{
    repository: {
      pullRequests: {
        nodes: (Omit<GithubBranchPullRequest, "reviews" | "threads"> & {
          headRepository: { nameWithOwner: string } | null
          reviews: { nodes: GithubBranchPullRequest["reviews"] }
          reviewThreads: {
            nodes: (Omit<
              GithubBranchPullRequest["threads"][number],
              "comments"
            > & {
              comments: {
                nodes: GithubBranchPullRequest["threads"][number]["comments"]
              }
            })[]
          }
        })[]
      }
    } | null
  }>(
    `query ($owner: String!, $name: String!, $branch: String!) {
      repository(owner: $owner, name: $name) {
        pullRequests(headRefName: $branch, first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            number url title state isDraft headRefOid
            headRepository { nameWithOwner }
            reviews(last: 50) {
              nodes { databaseId state body url submittedAt ${author} }
            }
            reviewThreads(first: 100) {
              nodes {
                id isResolved isOutdated path line originalLine
                comments(first: 30) {
                  nodes { databaseId body url createdAt ${author} pullRequestReview { databaseId } }
                }
              }
            }
          }
        }
      }
    }`,
    {
      owner,
      name,
      branch,
      request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    }
  )
  const pr = repository?.pullRequests.nodes.find(
    (node) =>
      node.headRepository?.nameWithOwner.toLowerCase() ===
      repoFullName.toLowerCase()
  )
  if (!pr) return null
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title,
    state: pr.state,
    isDraft: pr.isDraft,
    headRefOid: pr.headRefOid,
    reviews: pr.reviews.nodes,
    threads: pr.reviewThreads.nodes.map((thread) => ({
      ...thread,
      comments: thread.comments.nodes,
    })),
  }
}

// Whether a review opened a thread of its own: a reply on GitHub is a review
// too, with no body and only comments in reply to earlier ones.
export async function reviewStartsThreads(
  installationId: string,
  repoFullName: string,
  pullNumber: number,
  reviewId: number
): Promise<boolean> {
  const app = getApp()
  if (!app) return false
  const id = parseGithubInstallationId(installationId)
  if (id === null) return false
  const [owner, repo] = repoFullName.split("/")
  if (!(owner && repo)) return false
  const octokit = await app.getInstallationOctokit(id)
  const { data } = await octokit.rest.pulls.listCommentsForReview({
    owner,
    repo,
    pull_number: pullNumber,
    review_id: reviewId,
    per_page: 100,
    request: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  })
  return data.some((comment) => !comment.in_reply_to_id)
}
