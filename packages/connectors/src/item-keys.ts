import type { IntegrationProvider, TouchKind } from "@repo/db/schema"

// Stable keys for items in connected services, shared by Lor's touches and
// stored sources so the same item always has one key.
// reference/planned/session-memory.md "Stable keys".

export type ItemRef = { kind: TouchKind; value: string }

// Which hosts belong to each connector. Shared with the web tool trail.
export const CONNECTOR_URL_HOSTS: Record<IntegrationProvider, RegExp> = {
  github: /(^|\.)github\.com$/i,
  linear: /(^|\.)linear\.app$/i,
  datadog: /(^|\.)datadoghq\.(com|eu)$/i,
  attio: /(^|\.)attio\.com$/i,
  notion: /(^|\.)notion\.(so|site|com)$/i,
  cloudwatch: /(^|\.)console\.aws\.amazon\.com$/i,
  betterstack: /(^|\.)betterstack\.com$/i,
  webhook: /$^/,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTION_ID = /([0-9a-f]{32})$/i

// The item a URL points at, per connector. null = this connector's URLs name
// no single item Lor tracks (logs, consoles, dashboards).
type ItemUrlParser = {
  host: RegExp
  parse: (segments: string[], url: URL) => ItemRef | null
}

const ITEM_URL_PARSERS: Record<IntegrationProvider, ItemUrlParser | null> = {
  github: {
    host: CONNECTOR_URL_HOSTS.github,
    parse: (segments, url) => {
      // api.github.com/repos/<owner>/<repo>/(pulls|issues)/<n>
      const [owner, repo, kind, number] = url.hostname.startsWith("api.")
        ? segments.slice(1)
        : segments
      if (!owner || !repo) return null
      const ownerRepo = `${owner}/${repo}`
      if (number && /^\d+$/.test(number)) {
        if (kind === "pull" || kind === "pulls") {
          return { kind: "github_pr", value: githubItemKey(ownerRepo, number) }
        }
        if (kind === "issues") {
          return {
            kind: "github_issue",
            value: githubItemKey(ownerRepo, number),
          }
        }
      }
      return { kind: "github_repo", value: githubRepoKey(ownerRepo) }
    },
  },
  // linear.app/<team>/issue/<IDENTIFIER>/<title-slug>
  linear: {
    host: CONNECTOR_URL_HOSTS.linear,
    parse: (segments) => {
      const at = segments.indexOf("issue")
      const key =
        at >= 0 ? linearIssueKey(segments[at + 1]?.toUpperCase() ?? "") : null
      return key ? { kind: "linear_issue", value: key } : null
    },
  },
  // notion.so/<title-slug>-<32 hex>, also *.notion.site and app.notion.com
  notion: {
    host: CONNECTOR_URL_HOSTS.notion,
    parse: (segments) => {
      const id = segments.at(-1)?.match(NOTION_ID)?.[1]
      return id ? { kind: "notion_page", value: notionPageKey(id) } : null
    },
  },
  // app.attio.com/<workspace>/<object>/<recordId>/<tab>
  attio: {
    host: CONNECTOR_URL_HOSTS.attio,
    parse: (segments) => {
      const recordId = segments[2]
      return recordId && UUID.test(recordId)
        ? { kind: "attio_record", value: recordId.toLowerCase() }
        : null
    },
  },
  datadog: null,
  cloudwatch: null,
  betterstack: null,
  webhook: null,
}

export function itemFromUrl(raw: string): ItemRef | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const segments = url.pathname.split("/").filter(Boolean)
  for (const parser of Object.values(ITEM_URL_PARSERS)) {
    if (parser?.host.test(url.hostname)) return parser.parse(segments, url)
  }
  return null
}

// owner/repo#n, lowercased: GitHub matches repos case-insensitively.
export function githubItemKey(repo: string, number: number | string): string {
  return `${repo.trim().toLowerCase()}#${number}`
}

export function githubRepoKey(repo: string): string {
  return repo.trim().toLowerCase()
}

const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/

// The issue identifier (LOR-123), what people type and what sources use.
// Linear tools also accept UUIDs; those have no identifier and return null.
export function linearIssueKey(value: string): string | null {
  const trimmed = value.trim()
  return LINEAR_IDENTIFIER.test(trimmed) ? trimmed : null
}

// A Better Stack error is a pattern within an application; neither alone is
// unique. Field names come from the tools' runtime input schemas (2026-10-16).
export function betterstackErrorKey(
  applicationId: string,
  pattern: string
): string {
  return `${applicationId.trim()}:${pattern.trim()}`
}

// Plain URLs match exactly: lowercase host, no fragment. null = not a URL.
export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    url.hash = ""
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  } catch {
    return null
  }
}

// Notion ids appear dashed and undashed; the key is undashed lowercase hex.
export function notionPageKey(id: string): string {
  return id.trim().replaceAll("-", "").toLowerCase()
}
