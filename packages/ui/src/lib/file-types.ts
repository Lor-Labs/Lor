// File types by extension for the web and phone FileTypeIcon: a page glyph
// whose color reads as the type (a spreadsheet is green, a PDF red) and whose
// label is the extension.
export type FileTypeTone =
  | "spreadsheet"
  | "pdf"
  | "document"
  | "presentation"
  | "code"
  | "image"
  | "media"
  | "archive"
  | "generic"

const TONE_BY_EXTENSION: Record<string, Exclude<FileTypeTone, "generic">> = {
  csv: "spreadsheet",
  numbers: "spreadsheet",
  tsv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  md: "document",
  pages: "document",
  rtf: "document",
  txt: "document",
  key: "presentation",
  ppt: "presentation",
  pptx: "presentation",
  css: "code",
  html: "code",
  js: "code",
  json: "code",
  jsx: "code",
  log: "code",
  py: "code",
  sh: "code",
  sql: "code",
  toml: "code",
  ts: "code",
  tsx: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  gif: "image",
  heic: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  m4a: "media",
  mov: "media",
  mp3: "media",
  mp4: "media",
  wav: "media",
  webm: "media",
  gz: "archive",
  tar: "archive",
  tgz: "archive",
  zip: "archive",
}

// Unknown extensions get the generic page with no label.
export function fileType(filename: string): {
  tone: FileTypeTone
  label: string
} {
  const dot = filename.lastIndexOf(".")
  const extension = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ""
  const tone = TONE_BY_EXTENSION[extension]
  return tone
    ? { tone, label: extension.slice(0, 4).toUpperCase() }
    : { tone: "generic", label: "" }
}

// The glyph on a 24 × 24 grid: page, folded corner, and a label that fits
// 17 units of page width, so long extensions step down.
export const FILE_PAGE_PATH =
  "M5.5 1.5H13.7L20.5 8.3V20.5A2 2 0 0 1 18.5 22.5H5.5A2 2 0 0 1 3.5 20.5V3.5A2 2 0 0 1 5.5 1.5Z"
export const FILE_CORNER_PATH = "M13.7 1.5L20.5 8.3H15.7A2 2 0 0 1 13.7 6.3Z"
const LABEL_FONT_SIZE: Record<number, number> = { 1: 8, 2: 8, 3: 7, 4: 5.5 }
export function fileLabelFontSize(label: string): number {
  return LABEL_FONT_SIZE[label.length] ?? 5.5
}
