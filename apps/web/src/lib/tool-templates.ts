// Placeholder references in custom-tool templates ({{args.x}} /
// {{secrets.KEY}}). The editor derives the tool's argument rows from these —
// the template is the single source of truth for what varies.

export type TemplateRefs = { args: string[]; secrets: string[] }

const REF_REGEX = /\{\{\s*(args|secrets)\.([A-Za-z0-9_]+)\s*\}\}/g

export function scanTemplateRefs(templates: (string | null)[]): TemplateRefs {
  const args: string[] = []
  const secrets: string[] = []
  for (const template of templates) {
    if (!template) continue
    for (const match of template.matchAll(REF_REGEX)) {
      const kind = match[1]
      const name = match[2]
      if (!name) continue
      const bucket = kind === "args" ? args : secrets
      if (!bucket.includes(name)) bucket.push(name)
    }
  }
  return { args, secrets }
}

// JSON handling for body templates: placeholders aren't valid JSON, so they
// substitute to sentinel numbers before parsing — works in value position
// ({"q": 880880000}) and inside strings ("https://880880000/x") alike.
const SENTINEL_BASE = 880880000

type SubstitutionRun = {
  subStart: number
  subLen: number
  tplStart: number
  tplLen: number
  placeholder: boolean
}

function substituteWithMap(template: string): {
  text: string
  runs: SubstitutionRun[]
} {
  const runs: SubstitutionRun[] = []
  let sub = ""
  let last = 0
  let i = 0
  for (const match of template.matchAll(REF_REGEX)) {
    const idx = match.index
    if (idx > last) {
      runs.push({
        subStart: sub.length,
        subLen: idx - last,
        tplStart: last,
        tplLen: idx - last,
        placeholder: false,
      })
      sub += template.slice(last, idx)
    }
    const sentinel = String(SENTINEL_BASE + i++)
    runs.push({
      subStart: sub.length,
      subLen: sentinel.length,
      tplStart: idx,
      tplLen: match[0].length,
      placeholder: true,
    })
    sub += sentinel
    last = idx + match[0].length
  }
  if (last < template.length) {
    runs.push({
      subStart: sub.length,
      subLen: template.length - last,
      tplStart: last,
      tplLen: template.length - last,
      placeholder: false,
    })
    sub += template.slice(last)
  }
  return { text: sub, runs }
}

function substitutePlaceholders(template: string): {
  text: string
  placeholders: string[]
} {
  const { text, runs } = substituteWithMap(template)
  return {
    text,
    placeholders: runs
      .filter((r) => r.placeholder)
      .map((r) => template.slice(r.tplStart, r.tplStart + r.tplLen)),
  }
}

// Null when the template parses as JSON (treating placeholders as values);
// otherwise the parse error message. Not parsing isn't necessarily wrong —
// some APIs take non-JSON bodies — so callers warn, never block.
export function templateJsonIssue(template: string): string | null {
  try {
    JSON.parse(substitutePlaceholders(template).text)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid JSON"
  }
}

export type TemplateLint = { message: string; start: number; end: number }

// Best-effort error location from a JSON.parse message. Engines differ:
// V8 says "at position N (line L column C)", Firefox "line L column C",
// Safari gives no location at all (null → caller underlines everything).
function parseErrorOffset(message: string, text: string): number | null {
  const abs = /position (\d+)/i.exec(message)
  if (abs?.[1]) return Math.min(Number(abs[1]), text.length)
  const lineCol = /line (\d+) column (\d+)/i.exec(message)
  if (lineCol?.[1] && lineCol[2]) {
    const lines = text.split("\n")
    let offset = 0
    for (let i = 0; i < Number(lineCol[1]) - 1 && i < lines.length; i++) {
      offset += (lines[i]?.length ?? 0) + 1
    }
    return Math.min(offset + Number(lineCol[2]) - 1, text.length)
  }
  return null
}

// Like templateJsonIssue, but with the error located in TEMPLATE coordinates
// (mapped back through the sentinel substitution) for squiggly underlining.
// An error inside a placeholder underlines the whole placeholder.
export function templateJsonLint(template: string): TemplateLint | null {
  if (!template.trim()) return null
  const { text, runs } = substituteWithMap(template)
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON"
    const subPos = parseErrorOffset(message, text)
    if (subPos === null) return { message, start: 0, end: template.length }
    for (const run of runs) {
      if (subPos < run.subStart + run.subLen) {
        if (run.placeholder) {
          return {
            message,
            start: run.tplStart,
            end: run.tplStart + run.tplLen,
          }
        }
        const start = run.tplStart + Math.max(0, subPos - run.subStart)
        return { message, start, end: Math.min(start + 1, template.length) }
      }
    }
    return {
      message,
      start: Math.max(0, template.length - 1),
      end: template.length,
    }
  }
}

// Pretty-print the template's JSON while preserving placeholders verbatim.
// Null when it doesn't parse (nothing sane to format).
export function formatTemplateJson(template: string): string | null {
  const { text, placeholders } = substitutePlaceholders(template)
  try {
    let out = JSON.stringify(JSON.parse(text), null, 2)
    placeholders.forEach((placeholder, i) => {
      out = out.replaceAll(String(SENTINEL_BASE + i), placeholder)
    })
    return out
  } catch {
    return null
  }
}
