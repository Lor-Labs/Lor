// [[/page]], [[msg:<id>]], or [[src:<id>]]; excludes "]" from tokens.
export const CITATION_REGEX = /\[\[([^\]]+)\]\]/g

export type CitationKind = "page" | "msg" | "src"

export type Resolution =
  | { kind: "page"; exists: boolean }
  | { kind: "msg"; exists: boolean }
  | { kind: "src"; source: { title: string; url: string | null } | null }

export function classifyToken(token: string): CitationKind {
  if (token.startsWith("src:")) return "src"
  if (token.startsWith("msg:")) return "msg"
  return "page"
}

// Handles already-enriched [[src:<id>|...]] tokens during re-grounding.
export function prefixedTokenId(token: string): string {
  return token.slice(4).split("|")[0]?.trim() ?? ""
}

export function extractCitationTokens(text: string): Set<string> {
  const tokens = new Set<string>()
  for (const m of text.matchAll(CITATION_REGEX)) {
    const t = m[1]?.trim()
    if (t) tokens.add(t)
  }
  return tokens
}

export function sanitizeCitationField(value: string): string {
  return value
    .replace(/[[\]|\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Keep resolved citations, enrich sources, and unwrap/drop unresolved tokens.
export function rewriteCitations(
  text: string,
  resolve: (token: string) => Resolution
): { text: string; valid: number; invalid: number } {
  let valid = 0
  let invalid = 0
  const cleaned = text.replace(CITATION_REGEX, (_full, raw: string) => {
    const t = raw.trim()
    const r = resolve(t)
    if (r.kind === "src") {
      if (r.source) {
        valid++
        const title = sanitizeCitationField(r.source.title)
        const url = sanitizeCitationField(r.source.url ?? "")
        return `[[src:${prefixedTokenId(t)}|${title}|${url}]]`
      }
      invalid++
      return ""
    }
    if (r.exists) {
      valid++
      return `[[${t}]]`
    }
    invalid++
    return r.kind === "msg" ? "" : t
  })
  return { text: cleaned, valid, invalid }
}
