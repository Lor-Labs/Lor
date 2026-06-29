import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  fetchIssueOrPr,
  type InstallationRepo,
  listInstallationRepos,
  searchIssues,
} from "./providers/github"

const SEARCH_DEFAULT = 8
const SEARCH_MAX = 20
// Repos a scope-less search fans out over (GitHub's q has a length limit, so we
// can't list every repo of a big "All repos" org). Most-recently-active first.
const MAX_SCOPE_REPOS = 8
// Repo names listed in tool descriptions / errors.
const MAX_LISTED = 30

// The active GitHub installation id for a workspace (one active connection per
// workspace), or null when GitHub isn't connected.
export async function activeGithubInstallation(
  workspaceId: string
): Promise<string | null> {
  const connection = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "github"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return connection?.externalId ?? null
}

// Optional cache for the installation→repos lookup (the per-turn GitHub call).
// The worker injects a Redis-backed store at startup (setRepoCacheStore); the
// eval harness and tests leave it unset and fetch live. The API invalidates by
// key (githubReposCacheKey) on connect / disconnect / repo-access change, with
// the TTL as the backstop. Merlin itself has no Redis dependency.
export type RepoCacheStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
}

let repoCacheStore: RepoCacheStore | null = null
export function setRepoCacheStore(store: RepoCacheStore | null): void {
  repoCacheStore = store
}

// Cache key for an installation's repo list. Exported so the API can invalidate
// it; keep the format in sync on both sides.
export function githubReposCacheKey(installationId: string): string {
  return `github:repos:${installationId}`
}

// 1h backstop; explicit invalidation handles the common change cases.
const REPO_CACHE_TTL_SECONDS = 60 * 60

function parseCachedRepos(raw: string): InstallationRepo[] | null {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as InstallationRepo[]) : null
  } catch {
    return null
  }
}

// Resolve a workspace's GitHub once: the active installation id + its accessible
// repos. Null when GitHub isn't connected. Always a cheap DB lookup; the GitHub
// repo list is served from the cache (when a store is set) and only fetched on a
// miss — so a connected workspace pays at most one GitHub call per installation
// per hour, not per turn.
export async function resolveWorkspaceGithub(
  workspaceId: string
): Promise<{ installationId: string; repos: InstallationRepo[] } | null> {
  const installationId = await activeGithubInstallation(workspaceId)
  if (!installationId) return null

  const key = githubReposCacheKey(installationId)
  if (repoCacheStore) {
    const cached = await repoCacheStore.get(key).catch(() => null)
    const repos = cached ? parseCachedRepos(cached) : null
    if (repos) return { installationId, repos }
  }

  const repos = await listInstallationRepos(installationId).catch(() => [])
  // Only cache a non-empty list: an empty result is usually a transient
  // enumerate failure, and caching it for an hour would hide real repos.
  if (repoCacheStore && repos.length > 0) {
    await repoCacheStore
      .set(key, JSON.stringify(repos), REPO_CACHE_TTL_SECONDS)
      .catch(() => {})
  }
  return { installationId, repos }
}

function repoListText(repoNames: string[]): string {
  return repoNames.slice(0, MAX_LISTED).join(", ")
}

// Live GitHub PR/issue tools, available only when GitHub is connected. Results
// are referenced by url (Markdown link), not [[src:]] — they aren't ingested.
export function buildGithubTools({
  installationId,
  repos,
}: {
  installationId: string
  repos: InstallationRepo[]
}) {
  const repoNames = repos.map((r) => r.fullName)
  const repoHint = repoNames.length
    ? ` Connected repositories: ${repoListText(repoNames)}.`
    : ""
  return {
    search_github: tool({
      description: `Search the team's connected GitHub for pull requests and issues by keyword — use for "what PR changed X", "any issues about Y", recent work, or who worked on something. Returns matching PRs/issues with a ref (owner/repo#number), title, state, author, date, url, and a snippet. Reference a result with a Markdown link to its url. For the full body + discussion, call fetch_github with its ref.${repoHint}`,
      inputSchema: z.object({
        query: z.string().describe("keywords to search for"),
        repo: z
          .string()
          .optional()
          .describe("limit to one connected repo (owner/repo)"),
        type: z
          .enum(["pull_request", "issue"])
          .optional()
          .describe("limit to pull requests or issues"),
        limit: z.number().optional().describe("max results, 1–20 (default 8)"),
      }),
      execute: async ({ query, repo, type, limit }) => {
        const n = Math.floor(
          Math.min(Math.max(limit ?? SEARCH_DEFAULT, 1), SEARCH_MAX)
        )

        let scope: string[]
        let note: string | undefined
        if (repo) {
          const want = repo.trim().toLowerCase()
          const wantName = want.split("/").pop() ?? want
          const match = repoNames.find(
            (r) =>
              r.toLowerCase() === want ||
              (r.split("/")[1] ?? "").toLowerCase() === wantName
          )
          if (!match) {
            return {
              error: `"${repo}" isn't a connected repository. Connected repos: ${repoListText(repoNames)}`,
            }
          }
          scope = [match]
        } else {
          scope = repoNames.slice(0, MAX_SCOPE_REPOS)
          if (repoNames.length > MAX_SCOPE_REPOS) {
            note = `searched the ${MAX_SCOPE_REPOS} most-recently-active of ${repoNames.length} repos — pass repo to target another`
          }
        }
        if (scope.length === 0) {
          return { error: "no connected repositories to search" }
        }

        const results = await searchIssues(installationId, {
          query,
          repos: scope,
          type,
          limit: n,
        })
        return note ? { note, results } : { results }
      },
      strict: true,
    }),
    fetch_github: tool({
      description:
        "Fetch a GitHub pull request or issue's full body and discussion (comments, plus review comments for PRs), beyond the search snippet. Pass a ref as owner/repo#number (from search_github). Reference it with a Markdown link to its url.",
      inputSchema: z.object({
        ref: z
          .string()
          .describe("a pull request or issue ref, owner/repo#number"),
      }),
      execute: async ({ ref }) => {
        const fetched = await fetchIssueOrPr(installationId, ref)
        if (!fetched) return { error: "couldn't fetch that pull request/issue" }
        return fetched
      },
      strict: true,
    }),
  }
}
