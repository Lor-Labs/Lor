import { PaginationNulls, PaginationSortOrder } from "@linear/sdk"
import type { IntegrationProvider } from "@repo/db/schema"
import { attioSearchResult, resolveWorkspaceAttio } from "./attio"
import { resolveRepoTree, resolveWorkspaceGithub } from "./github"
import { resolveWorkspaceLinear } from "./linear"
import { notionSearchHit, resolveWorkspaceNotion } from "./notion"
import { attioRequest } from "./providers/attio"
import type { RepoTreeEntry } from "./providers/github"
import { searchIssues } from "./providers/github"
import { linearClientFor } from "./providers/linear"
import { notionCall } from "./providers/notion"

const MAX_RESULTS = 15
const MAX_GITHUB_REPOS = 8

// One attachable record: what the composer turns into a chip, and what it
// serializes to on send ([title](url)).
export type ConnectorSearchHit = {
  id: string
  title: string
  subtitle: string | null
  url: string
}

type ConnectorSearcher = (
  workspaceId: string,
  query: string,
  limit: number
) => Promise<ConnectorSearchHit[]>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const searchGithub: ConnectorSearcher = async (workspaceId, query, limit) => {
  const connection = await resolveWorkspaceGithub(workspaceId)
  if (!connection) return []
  const repos = connection.repos
    .map((repo) => repo.fullName)
    .slice(0, MAX_GITHUB_REPOS)
  if (repos.length === 0) return []

  const hits = await searchIssues(connection.installationId, {
    query,
    repos,
    limit,
  })
  return hits.map((hit) => ({
    id: hit.ref,
    title: hit.title,
    subtitle: `${hit.ref} · ${hit.state}`,
    url: hit.url,
  }))
}

const searchLinear: ConnectorSearcher = async (workspaceId, query, limit) => {
  const connection = await resolveWorkspaceLinear(workspaceId)
  if (!connection) return []
  const client = await linearClientFor(connection.externalId)
  if (!client) return []

  // No query yet → the most recently touched issues, so the menu is useful the
  // moment it opens.
  const issues = query
    ? await client
        .searchIssues(query, { first: limit })
        .then((payload) => payload.nodes)
        .catch(() => [])
    : await client
        .issues({
          first: limit,
          includeArchived: false,
          sort: [
            {
              updatedAt: {
                order: PaginationSortOrder.Descending,
                nulls: PaginationNulls.Last,
              },
            },
          ],
        })
        .then((payload) => payload.nodes)
        .catch(() => [])

  return issues.slice(0, limit).map((issue) => ({
    id: issue.id,
    title: issue.title,
    subtitle: issue.identifier,
    url: issue.url,
  }))
}

const searchNotion: ConnectorSearcher = async (workspaceId, query, limit) => {
  const connection = await resolveWorkspaceNotion(workspaceId)
  if (!connection) return []

  const response = await notionCall(connection.externalId, (client) =>
    client.search({
      ...(query ? { query } : {}),
      sort: query
        ? { property: "relevance" as const }
        : {
            timestamp: "last_edited_time" as const,
            direction: "descending" as const,
          },
      page_size: limit,
    })
  )
  if (!response) return []

  return response.results.flatMap((result) => {
    const hit = notionSearchHit(result)
    if (!hit.url) return []
    return [
      {
        id: hit.id ?? hit.url,
        title: hit.title,
        subtitle: hit.kind === "data_source" ? "Database" : "Page",
        url: hit.url,
      },
    ]
  })
}

const searchAttio: ConnectorSearcher = async (workspaceId, query, limit) => {
  const connection = await resolveWorkspaceAttio(workspaceId)
  // Attio's search is fuzzy-match only — there is no "recent records" listing.
  if (!(connection && query)) return []

  const catalog = await attioRequest<{ data: unknown[] }>(
    connection.externalId,
    "/objects"
  )
  const objects = (catalog?.data ?? []).flatMap((item) => {
    const slug = asString(asRecord(item)?.api_slug)
    return slug ? [slug] : []
  })
  if (objects.length === 0) return []

  const response = await attioRequest<{ data: unknown[] }>(
    connection.externalId,
    "/objects/records/search",
    {
      method: "POST",
      body: JSON.stringify({
        query,
        objects,
        request_as: { type: "workspace" },
        limit,
      }),
    }
  )
  if (!response) return []

  return (response.data ?? []).flatMap((item) => {
    const result = attioSearchResult(item)
    if (!result.url) return []
    return [
      {
        id: result.recordId ?? result.url,
        title: result.title,
        subtitle: result.object,
        url: result.url,
      },
    ]
  })
}

// A container a connector's files live in — currently only a GitHub repo.
export type ConnectorScope = {
  id: string
  label: string
}

type ConnectorFileBrowser = {
  listScopes: (workspaceId: string) => Promise<ConnectorScope[]>
  search: (
    workspaceId: string,
    scope: string,
    query: string,
    limit: number
  ) => Promise<ConnectorSearchHit[]>
}

const listGithubRepos = async (workspaceId: string) => {
  const connection = await resolveWorkspaceGithub(workspaceId)
  if (!connection) return []
  return connection.repos.map((repo) => ({
    id: repo.fullName,
    label: repo.fullName,
  }))
}

// Rank by how much of the filename the query accounts for, then prefer
// shallower paths — the file you meant is rarely six directories down. Tiers are
// spaced wider than any realistic depth so match quality always wins.
function rankPath(path: string, query: string): number {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  const stem = name.replace(/\.[^.]+$/, "")
  const depth = path.split("/").length
  if (name === query) return depth
  // "index" should find index.ts before indexing-notes.md.
  if (stem === query) return 1000 + depth
  if (name.startsWith(query)) return 2000 + depth
  if (name.includes(query)) return 3000 + depth
  return 4000 + depth
}

// Filter + rank a repo's path listing. Pure so the picker's ordering, root
// listing, and url shapes are testable without touching GitHub.
export function matchTreeEntries(
  entries: RepoTreeEntry[],
  repoFullName: string,
  ref: string,
  query: string,
  limit: number
): ConnectorSearchHit[] {
  const normalized = query.trim().toLowerCase()
  // No query yet → the repo root, directories first, so it reads as a browser.
  const matches = normalized
    ? entries
        .filter((entry) => entry.path.toLowerCase().includes(normalized))
        // Rank once per entry rather than twice per comparison — a monorepo
        // tree is tens of thousands of paths.
        .map((entry) => ({ entry, rank: rankPath(entry.path, normalized) }))
        .sort((a, b) => a.rank - b.rank)
        .map(({ entry }) => entry)
    : entries
        .filter((entry) => !entry.path.includes("/"))
        .sort((a, b) =>
          a.type === b.type
            ? a.path.localeCompare(b.path)
            : a.type === "tree"
              ? -1
              : 1
        )

  return matches.slice(0, limit).map((entry) => ({
    id: entry.path,
    title: entry.path,
    subtitle: entry.type === "tree" ? `${repoFullName} · folder` : repoFullName,
    url: `https://github.com/${repoFullName}/${
      entry.type === "tree" ? "tree" : "blob"
    }/${ref}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
  }))
}

const searchGithubFiles = async (
  workspaceId: string,
  scope: string,
  query: string,
  limit: number
) => {
  const connection = await resolveWorkspaceGithub(workspaceId)
  if (!connection) return []

  const repo = connection.repos.find(
    (candidate) => candidate.fullName === scope
  )
  if (!repo) return []

  const tree = await resolveRepoTree(
    connection.installationId,
    repo.fullName,
    repo.defaultBranch
  )
  if (!tree) return []

  return matchTreeEntries(tree.entries, repo.fullName, tree.ref, query, limit)
}

// Exhaustive over integrationProviderEnum — a new connector must say whether its
// files can be browsed. null = no file listing (the composer hides the option).
const FILE_BROWSERS: Record<IntegrationProvider, ConnectorFileBrowser | null> =
  {
    github: { listScopes: listGithubRepos, search: searchGithubFiles },
    linear: null,
    datadog: null,
    betterstack: null,
    attio: null,
    notion: null,
    cloudwatch: null,
    webhook: null,
  }

export function connectorSupportsFiles(provider: IntegrationProvider): boolean {
  return FILE_BROWSERS[provider] !== null
}

export async function listConnectorScopes(
  provider: IntegrationProvider,
  workspaceId: string
): Promise<ConnectorScope[] | null> {
  const browser = FILE_BROWSERS[provider]
  return browser ? browser.listScopes(workspaceId) : null
}

export async function searchConnectorFiles(
  provider: IntegrationProvider,
  workspaceId: string,
  scope: string,
  query: string,
  limit: number
): Promise<ConnectorSearchHit[] | null> {
  const browser = FILE_BROWSERS[provider]
  if (!browser) return null
  return browser.search(
    workspaceId,
    scope,
    query,
    Math.floor(Math.min(Math.max(limit, 1), MAX_RESULTS))
  )
}

// Exhaustive over integrationProviderEnum — a new connector must say whether it
// has attachable records. null = nothing to attach (Datadog is live log queries,
// not documents), and the composer hides it.
const SEARCHERS: Record<IntegrationProvider, ConnectorSearcher | null> = {
  github: searchGithub,
  linear: searchLinear,
  notion: searchNotion,
  attio: searchAttio,
  datadog: null,
  betterstack: null,
  // Live log/metric queries, not documents — nothing to attach.
  cloudwatch: null,
  // Inbound-only; deliveries aren't an attachable corpus.
  webhook: null,
}

export function isSearchableConnector(provider: IntegrationProvider): boolean {
  return SEARCHERS[provider] !== null
}

// null = this connector has nothing attachable; [] = connected but no matches.
export async function searchConnector(
  provider: IntegrationProvider,
  workspaceId: string,
  query: string,
  limit: number
): Promise<ConnectorSearchHit[] | null> {
  const searcher = SEARCHERS[provider]
  if (!searcher) return null
  return searcher(
    workspaceId,
    query.trim(),
    Math.floor(Math.min(Math.max(limit, 1), MAX_RESULTS))
  )
}
