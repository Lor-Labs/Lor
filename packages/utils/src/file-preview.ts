// What web's file panel and the phone's file viewer show inline. Bigger
// files, and types neither can draw, offer Download, Share or the browser.
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024

export function isTextPreviewable(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/typescript" ||
    mime === "application/xml" ||
    mime === "image/svg+xml"
  )
}

const CODE_LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  kt: "kotlin",
  php: "php",
  json: "json",
  jsonc: "jsonc",
  html: "html",
  css: "css",
  scss: "scss",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  vue: "vue",
  svelte: "svelte",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "zsh",
  diff: "diff",
  patch: "diff",
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
}

const CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  py: "text/x-python",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  patch: "text/x-diff",
  diff: "text/x-diff",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
}

function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ""
  return name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : ""
}

export function codeLanguageForPath(path: string): string | undefined {
  const extension = fileExtension(path)
  return Object.hasOwn(CODE_LANGUAGES, extension)
    ? CODE_LANGUAGES[extension]
    : undefined
}

export function imageMimeForPath(path: string): string | undefined {
  const extension = fileExtension(path)
  return Object.hasOwn(IMAGE_TYPES, extension)
    ? IMAGE_TYPES[extension]
    : undefined
}

export function fileContentType(path: string): string {
  const extension = fileExtension(path)
  const mime = Object.hasOwn(CONTENT_TYPES, extension)
    ? CONTENT_TYPES[extension]
    : undefined
  return (
    mime ??
    (codeLanguageForPath(path) ? "text/plain" : "application/octet-stream")
  )
}

// Older shared files may have been stored before their extension was known.
export function filePreviewMime(path: string, mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase()
  return !normalized || normalized === "application/octet-stream"
    ? fileContentType(path)
    : normalized
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
  const ext = fileExtension(path)
  const longestRun =
    text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return `${fence}${codeLanguageForPath(path) ?? ext}\n${text}\n${fence}`
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
