// Parse a pasted `curl` command into a custom-tool draft. Deliberately
// forgiving: handles the shapes API docs and browser devtools emit (quoted
// args, line continuations, -X/-H/-d/--json/-u), ignores transfer flags, and
// returns null only when there's no URL to work with.

export type ParsedCurl = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  url: string
  headers: Record<string, string>
  body: string | null
}

// Shell-ish tokenizer: single quotes are literal, double quotes honor
// backslash escapes, backslash-newline is a continuation.
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let started = false
  let i = 0
  while (i < input.length) {
    const ch = input.charAt(i)
    if (ch === "\\" && (input[i + 1] === "\n" || input[i + 1] === "\r")) {
      i += input[i + 1] === "\r" && input[i + 2] === "\n" ? 3 : 2
      continue
    }
    if (ch === "'") {
      started = true
      const end = input.indexOf("'", i + 1)
      if (end === -1) {
        current += input.slice(i + 1)
        i = input.length
      } else {
        current += input.slice(i + 1, end)
        i = end + 1
      }
      continue
    }
    if (ch === '"') {
      started = true
      i++
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          current += input.charAt(i + 1)
          i += 2
        } else {
          current += input.charAt(i)
          i++
        }
      }
      i++
      continue
    }
    if (/\s/.test(ch)) {
      if (started || current) {
        tokens.push(current)
        current = ""
        started = false
      }
      i++
      continue
    }
    current += ch
    started = true
    i++
  }
  if (started || current) tokens.push(current)
  return tokens
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
// Flags that take a value we deliberately ignore.
const IGNORED_WITH_VALUE = new Set([
  "-o",
  "--output",
  "--connect-timeout",
  "--max-time",
  "-m",
  "--retry",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-b",
  "--cookie",
  "-c",
  "--cookie-jar",
  "--cacert",
  "--capath",
])

export function parseCurl(input: string): ParsedCurl | null {
  const tokens = tokenize(input.trim())
  if (tokens.length === 0) return null
  const start = tokens[0] === "curl" ? 1 : 0

  let method: string | null = null
  let url: string | null = null
  const headers: Record<string, string> = {}
  let body: string | null = null
  let sawJsonFlag = false

  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === undefined) continue
    if (t === "-X" || t === "--request") {
      method = tokens[++i]?.toUpperCase() ?? null
    } else if (t === "-H" || t === "--header") {
      const raw = tokens[++i] ?? ""
      const idx = raw.indexOf(":")
      if (idx > 0) {
        headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim()
      }
    } else if (
      t === "-d" ||
      t === "--data" ||
      t === "--data-raw" ||
      t === "--data-binary" ||
      t === "--data-ascii"
    ) {
      const value = tokens[++i] ?? ""
      // curl strips a leading @file marker; we can't read files — skip those.
      if (!value.startsWith("@"))
        body = body === null ? value : `${body}&${value}`
    } else if (t === "--json") {
      body = tokens[++i] ?? ""
      sawJsonFlag = true
    } else if (t === "-u" || t === "--user") {
      const creds = tokens[++i] ?? ""
      headers.Authorization = `Basic ${btoa(creds)}`
    } else if (t === "--url") {
      url = tokens[++i] ?? null
    } else if (IGNORED_WITH_VALUE.has(t)) {
      i++
    } else if (t.startsWith("-")) {
      // Boolean transfer flags (-s, -L, --compressed, -k, …): ignore.
    } else if (!url) {
      url = t
    }
  }

  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  const hasContentType = Object.keys(headers).some(
    (h) => h.toLowerCase() === "content-type"
  )
  if (sawJsonFlag && !hasContentType) {
    headers["Content-Type"] = "application/json"
  }

  const resolvedMethod =
    method && METHODS.has(method)
      ? (method as ParsedCurl["method"])
      : body !== null
        ? "POST"
        : "GET"

  return { method: resolvedMethod, url, headers, body }
}

export type ExtractedSecret = { name: string; value: string }

// Header names that carry credentials when they have a substantive value.
const SECRET_HEADER_REGEX =
  /(api[-_]?key|token|secret|password|access[-_]?key|auth)/i
const MIN_SECRET_CHARS = 8

function secretName(header: string, taken: Set<string>): string {
  const base =
    header
      .replace(/^x[-_]/i, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "SECRET"
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`
  taken.add(name)
  return name
}

// Pull credential values out of parsed headers and replace them with
// {{secrets.NAME}} references. Names derive from the header (Authorization:
// Bearer … → BEARER_TOKEN, X-Api-Key → API_KEY) — a guess the user can
// rename; the point is the value lands in encrypted storage, never the
// template.
export function extractCurlSecrets(headers: Record<string, string>): {
  headers: Record<string, string>
  secrets: ExtractedSecret[]
} {
  const out: Record<string, string> = {}
  const secrets: ExtractedSecret[] = []
  const taken = new Set<string>()

  for (const [header, value] of Object.entries(headers)) {
    const scheme = /^(Bearer|Basic|Token)\s+(\S+)$/i.exec(value)
    if (header.toLowerCase() === "authorization" && scheme?.[1] && scheme[2]) {
      const kind = scheme[1].toLowerCase()
      const name = secretName(
        kind === "basic" ? "BASIC_AUTH" : "BEARER_TOKEN",
        taken
      )
      secrets.push({ name, value: scheme[2] })
      out[header] = `${scheme[1]} {{secrets.${name}}}`
      continue
    }
    if (
      SECRET_HEADER_REGEX.test(header) &&
      value.length >= MIN_SECRET_CHARS &&
      !value.includes("{{")
    ) {
      const name = secretName(header, taken)
      secrets.push({ name, value })
      out[header] = `{{secrets.${name}}}`
      continue
    }
    out[header] = value
  }
  return { headers: out, secrets }
}
