// What web's file panel and the phone's file viewer show inline. Bigger
// files, and types neither can draw, offer Download, Share or the browser.
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

export function isTextPreviewable(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "image/svg+xml"
  )
}

const CODE_LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  json: "json",
  html: "html",
  sql: "sql",
  sh: "bash",
  diff: "diff",
  patch: "diff",
}

// A text file as the markdown both clients render: markdown as itself,
// anything else as one code block. The fence is longer than any backtick run
// in the file, so an embedded ``` can't close it early.
export function previewMarkdown(
  path: string,
  mime: string,
  text: string
): string {
  if (mime === "text/markdown") return text
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  const longestRun =
    text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return `${fence}${CODE_LANGUAGES[ext] ?? ext}\n${text}\n${fence}`
}

export function isCsvMime(mime: string): boolean {
  return mime === "text/csv" || mime === "text/tab-separated-values"
}

export function csvDelimiterForMime(mime: string): string {
  return mime === "text/tab-separated-values" ? "\t" : ","
}

// Character-level parser: handles quoted fields containing the delimiter,
// escaped quotes (""), and newlines inside quotes, the three cases a naive
// split corrupts.
function parseDelimited(csv: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ""
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const nextChar = csv[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      currentRow.push(currentField)
      currentField = ""
    } else if (char === "\n") {
      currentRow.push(currentField)
      rows.push(currentRow)
      currentRow = []
      currentField = ""
    } else {
      currentField += char
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return rows
}

// Header names (blank ones become "Column N") and the non-empty data rows,
// each padded or cut to the header's width.
export function parseCsv(
  text: string,
  delimiter = ","
): { columns: string[]; rows: string[][] } {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const [header = [], ...dataRows] = parseDelimited(
    normalized.trim(),
    delimiter
  )
  return {
    columns: header.map((name, idx) => name.trim() || `Column ${idx + 1}`),
    rows: dataRows
      .filter((row) => row.some((cell) => cell.trim()))
      .map((row) => header.map((_, idx) => row[idx] ?? "")),
  }
}
