// [[/page]], [[msg:<id>]], [[src:<id>]], or [[call:<id>@<m:ss>]]; excludes
// "]" from tokens.
export const CITATION_REGEX = /\[\[([^\]]+)\]\]/g

export type CitationKind = "page" | "msg" | "src" | "call"

export type CallCitation = {
  sessionId: string
  atMs: number | null
  channelName: string
  startedAt: string
}

export type Resolution =
  | { kind: "page"; exists: boolean }
  | { kind: "msg"; exists: boolean }
  | { kind: "src"; source: { title: string; url: string | null } | null }
  | { kind: "call"; call: CallCitation | null }

export function classifyToken(token: string): CitationKind {
  if (token.startsWith("src:")) return "src"
  if (token.startsWith("msg:")) return "msg"
  if (token.startsWith("call:")) return "call"
  return "page"
}

// Handles already-enriched [[src:<id>|...]] tokens during re-grounding.
export function prefixedTokenId(token: string): string {
  return token.slice(4).split("|")[0]?.trim() ?? ""
}

// "call:<id>@4:05" as written by the model, or "call:<id>@245000|…" once
// grounded. The time is optional.
export function splitCallToken(token: string) {
  const [body = ""] = token.slice(5).split("|")
  const [sessionId = "", at] = body.split("@")
  return { sessionId: sessionId.trim(), at: at?.trim() || null }
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

// Keep resolved citations, enrich sources and calls, and unwrap/drop
// unresolved tokens. A grounded call carries its time in ms plus the channel
// and start time, so clients can label it without a lookup.
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
    if (r.kind === "call") {
      if (r.call) {
        valid++
        const at = r.call.atMs === null ? "" : `@${r.call.atMs}`
        const channel = sanitizeCitationField(r.call.channelName)
        return `[[call:${r.call.sessionId}${at}|${channel}|${r.call.startedAt}]]`
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
