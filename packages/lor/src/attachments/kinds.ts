export type DocumentKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "csv"
  | "markdown"
  | "text"

// Extension wins over the browser's content type: Windows reports .csv as
// application/vnd.ms-excel, and many uploads arrive as octet-stream.
const EXTENSION_KINDS: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  csv: "csv",
  tsv: "csv",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  json: "text",
  log: "text",
}

const TYPE_KINDS: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/tab-separated-values": "csv",
  "text/markdown": "markdown",
  "text/plain": "text",
  "application/json": "text",
}

export function documentKind(
  contentType: string,
  filename: string
): DocumentKind | null {
  const extension = filename.includes(".")
    ? filename.split(".").pop()?.toLowerCase()
    : undefined
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  return (extension && EXTENSION_KINDS[extension]) || TYPE_KINDS[type] || null
}

// Position 0 is the whole file (an image, or a filename-only row).
export function pieceLabel(
  contentType: string,
  filename: string,
  position: number
): string | null {
  if (position === 0) return null
  const kind = documentKind(contentType, filename)
  if (kind === "pdf") return `page ${position}`
  if (kind === "pptx") return `slide ${position}`
  return `part ${position}`
}
