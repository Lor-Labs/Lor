import { gunzipSync, gzipSync } from "node:zlib"
import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  fetchIssueOrPr,
  fetchRepoTree,
  type InstallationRepo,
  listInstallationRepos,
  type RepoTree,
  type RepoTreeEntry,
  searchIssues,
} from "./providers/github"

const SEARCH_DEFAULT = 8
const SEARCH_MAX = 20
const MAX_SCOPE_REPOS = 8
const MAX_LISTED = 30

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

// Injected by the worker so Merlin keeps no Redis dependency.
export type RepoCacheStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
}

let repoCacheStore: RepoCacheStore | null = null
export function setRepoCacheStore(store: RepoCacheStore | null): void {
  repoCacheStore = store
}

export function githubReposCacheKey(installationId: string): string {
  return `github:repos:${installationId}`
}

export function githubTreeCacheKey(
  installationId: string,
  repoFullName: string,
  ref: string
): string {
  return `github:tree:${installationId}:${repoFullName}@${ref}`
}

const REPO_CACHE_TTL_SECONDS = 60 * 60
const TREE_CACHE_TTL_SECONDS = 10 * 60
const REPO_FETCH_TIMEOUT_MS = 10_000
const TREE_FETCH_TIMEOUT_MS = 15_000

function isInstallationRepo(v: unknown): v is InstallationRepo {
  if (!v || typeof v !== "object") return false
  const r = v as Record<string, unknown>
  return (
    typeof r.fullName === "string" &&
    typeof r.private === "boolean" &&
    typeof r.defaultBranch === "string" &&
    (r.pushedAt === null || typeof r.pushedAt === "string")
  )
}

// Reject the whole payload on any shape mismatch (e.g. a stale cache from an
// older repo shape) so the caller falls back to a fresh enumeration.
function parseCachedRepos(raw: string): InstallationRepo[] | null {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isInstallationRepo)) return null
    return parsed
  } catch {
    return null
  }
}

// Resolve to the fallback if the promise hasn't settled within `ms` — keeps a
// hung GitHub/Redis call from blocking the caller indefinitely.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

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

  const repos = await withTimeout(
    listInstallationRepos(installationId),
    REPO_FETCH_TIMEOUT_MS,
    [] as InstallationRepo[]
  )
  // Empty repo lists are usually transient enumerate failures.
  if (repoCacheStore && repos.length > 0) {
    await repoCacheStore
      .set(key, JSON.stringify(repos), REPO_CACHE_TTL_SECONDS)
      .catch(() => {})
  }
  return { installationId, repos }
}

function isRepoTreeEntry(value: unknown): value is RepoTreeEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.path === "string" &&
    (entry.type === "blob" || entry.type === "tree")
  )
}

// Paths compress ~10x, and an uncompressed monorepo tree is megabytes of Redis
// per repo. Base64 so the store stays a plain string store. Exported with its
// reader so the round trip is testable — a silent decode failure would turn the
// cache into a permanent miss.
export function encodeTree(tree: RepoTree): string {
  return gzipSync(Buffer.from(JSON.stringify(tree))).toString("base64")
}

export function parseCachedTree(raw: string): RepoTree | null {
  try {
    // Values written before compression landed are plain JSON.
    const json = raw.startsWith("{")
      ? raw
      : gunzipSync(Buffer.from(raw, "base64")).toString("utf8")
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== "object") return null
    const tree = parsed as RepoTree
    if (!(Array.isArray(tree.entries) && typeof tree.ref === "string")) {
      return null
    }
    // Drop anything that doesn't match the shape the picker reads, so a stale
    // cache from an older entry shape degrades instead of throwing downstream.
    return { ...tree, entries: tree.entries.filter(isRepoTreeEntry) }
  } catch {
    return null
  }
}

// Concurrent searches on the same repo (the menu fires one on open, another as
// soon as you type) would each pull the whole tree before the first one caches.
const inFlightTrees = new Map<string, Promise<RepoTree | null>>()

// A repo's full path listing, cached because the composer's file picker filters
// it on every keystroke. Without an injected store this is one GitHub call per
// search, so hosts should provide one.
export async function resolveRepoTree(
  installationId: string,
  repoFullName: string,
  ref: string
): Promise<RepoTree | null> {
  const key = githubTreeCacheKey(installationId, repoFullName, ref)
  if (repoCacheStore) {
    const cached = await repoCacheStore.get(key).catch(() => null)
    const tree = cached ? parseCachedTree(cached) : null
    if (tree) return tree
  }

  const pending = inFlightTrees.get(key)
  if (pending) return pending

  const fetching = withTimeout(
    fetchRepoTree(installationId, repoFullName, ref),
    TREE_FETCH_TIMEOUT_MS,
    null
  )
    .then(async (tree) => {
      if (repoCacheStore && tree && tree.entries.length > 0) {
        await repoCacheStore
          .set(key, encodeTree(tree), TREE_CACHE_TTL_SECONDS)
          .catch(() => {})
      }
      return tree
    })
    .finally(() => {
      inFlightTrees.delete(key)
    })

  inFlightTrees.set(key, fetching)
  return fetching
}

function repoListText(repoNames: string[]): string {
  return repoNames.slice(0, MAX_LISTED).join(", ")
}

const githubContext = z.object({
  installationId: z.string(),
  repos: z.custom<InstallationRepo[]>(),
})

function repoHint(repos: InstallationRepo[]): string {
  const repoNames = repos.map((r) => r.fullName)
  return repoNames.length
    ? ` Connected repositories: ${repoListText(repoNames)}.`
    : ""
}

export const githubTools = {
  search_github: tool({
    description: ({ context }) =>
      `Search the team's connected GitHub for pull requests and issues by keyword — use for "what PR changed X", "any issues about Y", recent work, or who worked on something. Returns matching PRs/issues with a ref (owner/repo#number), title, state, author, date, url, and a snippet. Reference a result with a Markdown link to its url. For the full body + discussion, call fetch_github with its ref.${repoHint(context.repos)}`,
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
    contextSchema: githubContext,
    execute: async ({ query, repo, type, limit }, { context }) => {
      const repoNames = context.repos.map((r) => r.fullName)
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

      const results = await searchIssues(context.installationId, {
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
    contextSchema: githubContext,
    execute: async ({ ref }, { context }) => {
      // Enforce the connected-repo list before fetching; an empty list is
      // usually a transient enumeration failure, so stay permissive like
      // resolveRepo does.
      const refRepo = (ref.split("#")[0] ?? "").trim().toLowerCase()
      if (
        context.repos.length > 0 &&
        !context.repos.some((r) => r.fullName.toLowerCase() === refRepo)
      ) {
        return {
          error: `"${ref}" isn't in a connected repository. Connected repos: ${repoListText(
            context.repos.map((r) => r.fullName)
          )}`,
        }
      }
      const fetched = await fetchIssueOrPr(context.installationId, ref)
      if (!fetched) return { error: "couldn't fetch that pull request/issue" }
      return fetched
    },
    strict: true,
  }),
}
