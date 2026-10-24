import { githubItemKey } from "@repo/connectors"
import { env } from "@repo/env/server"
import { App } from "octokit"
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

const MAX_CONTENT = 8000
const MAX_COMMENTS = 10
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) {
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) return []
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) return null
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) return null
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

function clip(s: string): string {
  return s.length > MAX_CONTENT ? `${s.slice(0, MAX_CONTENT)}\n…(truncated)` : s
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) return []
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
  const id = Number(installationId)
  if (!Number.isFinite(id)) return null
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

export async function fetchIssueOrPr(
  installationId: string,
  ref: string
): Promise<FetchedIssue | null> {
  const app = getApp()
  if (!app) return null
  const id = Number(installationId)
  if (!Number.isFinite(id)) return null
  const parsed = parseRef(ref, "#")
  if (!parsed) return null
  try {
    const octokit = await app.getInstallationOctokit(id)
    const { data } = await octokit.rest.issues.get({
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: parsed.id,
    })
    const isPr = Boolean(data.pull_request)
    const state =
      isPr && data.pull_request?.merged_at ? "merged" : (data.state ?? "open")
    let out = `# ${data.title}\nState: ${state} · by ${data.user?.login ?? "unknown"}\n\n${data.body ?? "(no description)"}`

    const comments = await octokit.rest.issues
      .listComments({
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: parsed.id,
        per_page: MAX_COMMENTS,
      })
      .then((r) => r.data)
      .catch(() => [])
    for (const cm of comments) {
      out += `\n\n— ${cm.user?.login ?? "unknown"}: ${cm.body ?? ""}`
    }
    if (isPr) {
      const reviewComments = await octokit.rest.pulls
        .listReviewComments({
          owner: parsed.owner,
          repo: parsed.repo,
          pull_number: parsed.id,
          per_page: MAX_COMMENTS,
        })
        .then((r) => r.data)
        .catch(() => [])
      for (const rc of reviewComments) {
        out += `\n\n— ${rc.user?.login ?? "unknown"} on ${rc.path}: ${rc.body ?? ""}`
      }
    }

    return {
      ref: `${parsed.owner}/${parsed.repo}#${parsed.id}`,
      type: isPr ? "pull_request" : "issue",
      title: data.title,
      state,
      url: data.html_url,
      content: clip(out),
    }
  } catch (err) {
    logger.error({ err, ref }, "GitHub issue/PR fetch failed")
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
  const id = Number(installationId)
  const parsed = parseRef(ref, "#")
  if (!app || !Number.isFinite(id) || !parsed) return null
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
  const installationId = Number(connection.externalId)
  const parsed = parseRef(ref, "#")
  if (!(Number.isFinite(installationId) && parsed)) {
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
    const installationId = Number(connection.externalId)
    if (!Number.isFinite(installationId)) return null
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
