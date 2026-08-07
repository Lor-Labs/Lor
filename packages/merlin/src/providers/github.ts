import { env } from "@repo/env/server"
import { App } from "octokit"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

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
function normalizePrivateKey(raw: string | undefined): string | undefined {
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

export async function getInstallationToken(
  installationId: string
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
// Bound each GitHub request so a hung connection can't stall the caller (Octokit
// has no default request timeout).
const REQUEST_TIMEOUT_MS = 10_000

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

function parseRef(externalId: string, sep: "#" | "@") {
  const [ownerRepo, tail] = externalId.split(sep)
  const [owner, repo] = (ownerRepo ?? "").split("/")
  const id = Number(tail)
  if (!owner || !repo || !Number.isFinite(id)) return null
  return { owner, repo, id }
}

export const githubProvider: SourceProvider = {
  async fetchContent(source, connection) {
    const app = getApp()
    if (!app) return null
    const installationId = Number(connection.externalId)
    if (!Number.isFinite(installationId)) return null
    const octokit = await app.getInstallationOctokit(installationId)

    if (source.kind === "pull_request") {
      const ref = parseRef(source.externalId, "#")
      if (!ref) return null
      const { data } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.id,
      })
      const state = data.merged ? "merged" : data.state
      let out = `# ${data.title}\nState: ${state} · by ${data.user?.login ?? "unknown"}\n\n${data.body ?? "(no description)"}`
      // PR discussion is split across issue comments and review comments.
      const [comments, reviewComments] = await Promise.all([
        octokit.rest.issues
          .listComments({
            owner: ref.owner,
            repo: ref.repo,
            issue_number: ref.id,
            per_page: MAX_COMMENTS,
          })
          .then((r) => r.data)
          .catch(() => []),
        octokit.rest.pulls
          .listReviewComments({
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.id,
            per_page: MAX_COMMENTS,
          })
          .then((r) => r.data)
          .catch(() => []),
      ])
      for (const cm of comments) {
        out += `\n\n— ${cm.user?.login ?? "unknown"}: ${cm.body ?? ""}`
      }
      for (const rc of reviewComments) {
        out += `\n\n— ${rc.user?.login ?? "unknown"} on ${rc.path}: ${rc.body ?? ""}`
      }
      return clip(out)
    }

    if (source.kind === "issue") {
      const ref = parseRef(source.externalId, "#")
      if (!ref) return null
      const { data } = await octokit.rest.issues.get({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.id,
      })
      let out = `# ${data.title}\nState: ${data.state} · by ${data.user?.login ?? "unknown"}\n\n${data.body ?? "(no description)"}`
      const comments = await octokit.rest.issues
        .listComments({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.id,
          per_page: MAX_COMMENTS,
        })
        .then((r) => r.data)
        .catch(() => [])
      for (const cm of comments) {
        out += `\n\n— ${cm.user?.login ?? "unknown"}: ${cm.body ?? ""}`
      }
      return clip(out)
    }

    if (source.kind === "release") {
      const ref = parseRef(source.externalId, "@")
      if (!ref) return null
      const { data } = await octokit.rest.repos.getRelease({
        owner: ref.owner,
        repo: ref.repo,
        release_id: ref.id,
      })
      return clip(
        `# ${data.name ?? data.tag_name}\n\n${data.body ?? "(no notes)"}`
      )
    }

    return null
  },

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
