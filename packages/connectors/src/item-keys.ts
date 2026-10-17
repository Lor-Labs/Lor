// Stable keys for items in connected services, shared by Lor's touches and
// stored sources so the same item always has one key.
// reference/planned/session-memory.md "Stable keys".

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
