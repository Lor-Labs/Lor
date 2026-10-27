import { posix } from "node:path"
import { inflateRawSync } from "node:zlib"
import { strFromU8, unzipSync, zipSync } from "fflate"
import mammoth from "mammoth"
import { getDocumentProxy, renderPageAsImage } from "unpdf"
import type { DocumentKind } from "./kinds"
import { splitText } from "./split"
import { extractCsv, extractXlsx } from "./tables"

export type Piece = { position: number; text: string }
export type Extracted = { pieces: Piece[]; truncated: boolean }
// Reads an image-only page or slide; null when it could not be read.
export type Transcriber = (image: {
  bytes: Uint8Array
  mediaType: string
}) => Promise<string | null>

// Chunk sizes and caps: see Step 3 and the chunking research notes in
// reference/attachment-search.md.
const TARGET_CHARS = 2000
const MIN_SECTION_CHARS = 500
const MAX_PIECE_CHARS = 16_000
// A sheet is one piece; its value lists past the embed cap still feed FTS.
const MAX_TABLE_PIECE_CHARS = 64_000
const MAX_PIECES = 200
const MAX_PDF_PAGES = 300
// Image-only pages and slides (scans, screenshot slides) go through the
// vision model; the cap bounds cost and job time per file.
const MAX_TRANSCRIBED_PAGES = 30
const TRANSCRIBE_CONCURRENCY = 4
const SCANNED_PAGE_MAX_CHARS = 20
const PDF_RENDER_SCALE = 2
const MAX_SLIDE_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_ENTRY_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 2_000
const MAX_RENDER_PIXELS = 16_000_000
const SLIDE_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

type Section = { path: string[]; body: string }
type Heading = { level: number; text: string }

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const lower = e.toLowerCase()
    if (lower.startsWith("#x"))
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith("#"))
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return NAMED_ENTITIES[lower] ?? ""
  })
}

type PendingImage = {
  position: number
  image: { bytes: Uint8Array; mediaType: string }
  prefix?: string
}

async function transcribePages(
  pending: PendingImage[],
  transcribe: Transcriber
): Promise<Piece[]> {
  const pieces: Piece[] = []
  let next = 0
  const worker = async () => {
    while (next < pending.length) {
      const item = pending[next++]
      if (!item) continue
      const text = await transcribe(item.image)
      if (text) {
        pieces.push({
          position: item.position,
          text: item.prefix ? `${item.prefix}\n${text}` : text,
        })
      }
    }
  }
  await Promise.all(
    Array.from({ length: TRANSCRIBE_CONCURRENCY }, () => worker())
  )
  return pieces
}

function descend(headings: Heading[], level: number, text: string) {
  return [...headings.filter((h) => h.level < level), { level, text }]
}

function commonPath(a: string[], b: string[]): string[] {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return a.slice(0, i)
}

// A merged section keeps each part's own headings inline, below the shared
// heading path.
function mergeSections(a: Section, b: Section): Section {
  const path = commonPath(a.path, b.path)
  const inline = (s: Section) =>
    [s.path.slice(path.length).join(" > "), s.body].filter(Boolean).join("\n")
  return { path, body: [inline(a), inline(b)].filter(Boolean).join("\n\n") }
}

// Small neighbouring sections merge; big ones split. Each piece starts with
// its heading path so vector and keyword search both see the context. Only
// siblings or parent/child sections merge, and a heading with no body never
// merges backward (it introduces the next section).
function sectionPieces(sections: Section[]): Piece[] {
  const merged: Section[] = []
  for (const section of sections) {
    const prev = merged.at(-1)
    if (
      prev &&
      section.body &&
      prev.body.length < MIN_SECTION_CHARS &&
      prev.body.length + section.body.length <= TARGET_CHARS &&
      commonPath(prev.path, section.path).length >=
        Math.max(prev.path.length, section.path.length) - 1
    ) {
      merged[merged.length - 1] = mergeSections(prev, section)
    } else {
      merged.push(section)
    }
  }
  const pieces: Piece[] = []
  for (const section of merged) {
    const header = section.path.join(" > ")
    for (const chunk of splitText(section.body, TARGET_CHARS)) {
      pieces.push({
        position: pieces.length + 1,
        text: header ? `${header}\n\n${chunk}` : chunk,
      })
    }
  }
  return pieces
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<\/(td|th)>/g, "\t")
      .replace(/<\/(tr|li)>/g, "\n")
      .replace(/<\/(p|table|ul|ol)>/g, "\n\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function htmlSections(html: string): Section[] {
  const sections: Section[] = []
  let headings: Heading[] = []
  let last = 0
  const push = (end: number) =>
    sections.push({
      path: headings.map((h) => h.text),
      body: htmlToText(html.slice(last, end)),
    })
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)) {
    push(m.index)
    headings = descend(headings, Number(m[1]), htmlToText(m[2] ?? ""))
    last = m.index + m[0].length
  }
  push(html.length)
  return sections
}

function markdownSections(md: string): Section[] {
  const sections: Section[] = []
  let headings: Heading[] = []
  let lines: string[] = []
  let fenced = false
  const push = () => {
    sections.push({
      path: headings.map((h) => h.text),
      body: lines.join("\n").trim(),
    })
    lines = []
  }
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const m = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      push()
      headings = descend(headings, m[1]?.length ?? 1, m[2] ?? "")
    } else {
      lines.push(line)
    }
  }
  push()
  return sections
}

async function extractPdf(
  bytes: Uint8Array,
  transcribe?: Transcriber
): Promise<Extracted> {
  const pdf = await getDocumentProxy(bytes)
  const pieces: Piece[] = []
  const scanned: PendingImage[] = []
  let truncated = pdf.numPages > MAX_PDF_PAGES
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES)
    for (let n = 1; n <= pageCount; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""
        )
        .join("")
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
      if (text.length >= SCANNED_PAGE_MAX_CHARS || !transcribe) {
        if (text) pieces.push({ position: n, text })
        continue
      }
      if (scanned.length >= MAX_TRANSCRIBED_PAGES) {
        truncated = true
        if (text) pieces.push({ position: n, text })
        continue
      }
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      if (
        !Number.isFinite(viewport.width * viewport.height) ||
        viewport.width * viewport.height > MAX_RENDER_PIXELS
      ) {
        truncated = true
        continue
      }
      const png = await renderPageAsImage(pdf, n, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: PDF_RENDER_SCALE,
      })
      scanned.push({
        position: n,
        image: { bytes: new Uint8Array(png), mediaType: "image/png" },
      })
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
  if (transcribe && scanned.length > 0) {
    pieces.push(...(await transcribePages(scanned, transcribe)))
    pieces.sort((a, b) => a.position - b.position)
  }
  return { pieces, truncated }
}

// Repack bounded bytes so downstream OOXML parsers never decompress attacker
// supplied streams or trust a different ZIP header's declared sizes.
function boundedOfficeArchive(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const invalid = () =>
    new Error("Document archive is invalid or exceeds the extraction limits")
  let end = bytes.byteLength - 22
  const earliest = Math.max(0, end - 65_535)
  for (; end >= earliest; end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.byteLength
    )
      break
  }
  if (end < earliest) throw invalid()
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const directoryStart = offset
  const directoryEnd = offset + view.getUint32(end + 12, true)
  if (
    view.getUint32(end + 4, true) !== 0 ||
    view.getUint16(end + 8, true) !== count ||
    count > MAX_ARCHIVE_ENTRIES ||
    directoryEnd !== end
  )
    throw invalid()
  let expanded = 0
  let compressedRead = 0
  const files: Record<string, Uint8Array> = Object.create(null)
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > directoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw invalid()
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const original = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const next =
      offset +
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    if (
      next > directoryEnd ||
      flags & 1 ||
      (method !== 0 && method !== 8) ||
      original > MAX_ARCHIVE_ENTRY_BYTES ||
      expanded + original > MAX_ARCHIVE_BYTES ||
      compressedRead + compressed > bytes.byteLength ||
      local + 30 > directoryStart ||
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 8, true) !== method
    )
      throw invalid()
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    )
    if (
      !name ||
      Object.hasOwn(files, name) ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("\0") ||
      name.split("/").some((part) => part === "." || part === "..")
    )
      throw invalid()
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true)
    if (start + compressed > directoryStart) throw invalid()
    const data = bytes.subarray(start, start + compressed)
    const file =
      method === 0
        ? data
        : inflateRawSync(data, { maxOutputLength: Math.max(1, original) })
    if (file.byteLength !== original) throw invalid()
    files[name] = file
    expanded += file.byteLength
    compressedRead += compressed
    offset = next
  }
  if (offset !== directoryEnd) throw invalid()
  return zipSync(files, { level: 0 })
}

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }
  )
  return { pieces: sectionPieces(htmlSections(value)), truncated: false }
}

function xmlParagraphs(xml: string): string[] {
  const out: string[] = []
  for (const p of xml.matchAll(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)) {
    const runs = [...p[0].matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)]
    const text = decodeEntities(runs.map((r) => r[1]).join("")).trim()
    if (text) out.push(text)
  }
  return out
}

function placeholderShape(xml: string, types: string[]): string | null {
  for (const sp of xml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)) {
    const type = /<p:ph\b[^>]*\btype="([^"]+)"/.exec(sp[0])?.[1]
    if (type && types.includes(type)) return sp[0]
  }
  return null
}

function relationships(xml: string, baseDir: string) {
  const rels = new Map<string, { type: string; target: string }>()
  for (const tag of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(tag[0])?.[1] ?? ""
    const target = attr("Target")
    rels.set(attr("Id"), {
      type: attr("Type"),
      target: target.startsWith("/")
        ? target.slice(1)
        : posix.normalize(posix.join(baseDir, target)),
    })
  }
  return rels
}

// Only the presentation, slide, and notes XML is decompressed, so embedded
// video and images are never read.
async function extractPptx(
  bytes: Uint8Array,
  transcribe?: Transcriber
): Promise<Extracted> {
  const files = unzipSync(bytes, {
    filter: (f) =>
      /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(f.name) ||
      /^ppt\/(_rels\/presentation|slides\/_rels\/[^/]+)\.xml\.rels$/.test(
        f.name
      ) ||
      f.name === "ppt/presentation.xml",
  })
  const read = (name: string) => {
    const file = files[name]
    return file ? strFromU8(file) : ""
  }
  const presentationRels = relationships(
    read("ppt/_rels/presentation.xml.rels"),
    "ppt"
  )
  const slideIds = [
    ...read("ppt/presentation.xml").matchAll(
      /<p:sldId\b[^>]*\br:id="([^"]+)"/g
    ),
  ].map((m) => m[1] ?? "")

  const pieces: Piece[] = []
  const imageSlides: { position: number; images: string[] }[] = []
  slideIds.forEach((relId, i) => {
    const path = presentationRels.get(relId)?.target
    if (!path) return
    let xml = read(path)
    const titleShape = placeholderShape(xml, ["title", "ctrTitle"])
    const title = titleShape ? xmlParagraphs(titleShape).join(" ") : ""
    if (titleShape) xml = xml.replace(titleShape, "")
    const slideRels = relationships(
      read(`${posix.dirname(path)}/_rels/${posix.basename(path)}.rels`),
      posix.dirname(path)
    )
    const notesPath = [...slideRels.values()].find((r) =>
      r.type.endsWith("/notesSlide")
    )?.target
    const notesShape = notesPath
      ? placeholderShape(read(notesPath), ["body"])
      : null
    const notes = notesShape ? xmlParagraphs(notesShape).join("\n") : ""
    const body = xmlParagraphs(xml).join("\n")
    const position = i + 1
    if (!title && !body && !notes) {
      const images = [...slideRels.values()]
        .filter((r) => r.type.endsWith("/image"))
        .map((r) => r.target)
        .filter(
          (t) => SLIDE_IMAGE_TYPES[posix.extname(t).slice(1).toLowerCase()]
        )
      if (images.length > 0) imageSlides.push({ position, images })
      return
    }
    pieces.push({
      position,
      text: [
        title ? `Slide ${position}: ${title}` : `Slide ${position}`,
        body,
        notes && `Notes: ${notes}`,
      ]
        .filter(Boolean)
        .join("\n"),
    })
  })
  if (!transcribe || imageSlides.length === 0) {
    return { pieces, truncated: false }
  }

  // A text-free slide is usually one screenshot or scan: read its largest
  // image. Only those media files are decompressed.
  const wanted = new Set(
    imageSlides.slice(0, MAX_TRANSCRIBED_PAGES).flatMap((s) => s.images)
  )
  const media = unzipSync(bytes, {
    filter: (f) =>
      wanted.has(f.name) && f.originalSize <= MAX_SLIDE_IMAGE_BYTES,
  })
  const pending: PendingImage[] = []
  for (const slide of imageSlides.slice(0, MAX_TRANSCRIBED_PAGES)) {
    let largest: { name: string; bytes: Uint8Array } | null = null
    for (const name of slide.images) {
      const file = media[name]
      if (file && file.byteLength > (largest?.bytes.byteLength ?? 0)) {
        largest = { name, bytes: file }
      }
    }
    const mediaType =
      largest &&
      SLIDE_IMAGE_TYPES[posix.extname(largest.name).slice(1).toLowerCase()]
    if (!largest || !mediaType) continue
    pending.push({
      position: slide.position,
      image: { bytes: largest.bytes, mediaType },
      prefix: `Slide ${slide.position}`,
    })
  }
  pieces.push(...(await transcribePages(pending, transcribe)))
  pieces.sort((a, b) => a.position - b.position)
  return {
    pieces,
    truncated: imageSlides.length > MAX_TRANSCRIBED_PAGES,
  }
}

async function extractByKind(
  bytes: Uint8Array,
  kind: DocumentKind,
  transcribe?: Transcriber
): Promise<Extracted> {
  const text = () => new TextDecoder().decode(bytes)
  switch (kind) {
    case "pdf":
      return extractPdf(bytes, transcribe)
    case "docx":
      return extractDocx(bytes)
    case "pptx":
      return extractPptx(bytes, transcribe)
    case "xlsx":
      return extractXlsx(bytes)
    case "csv":
      return extractCsv(text())
    case "markdown":
      return {
        pieces: sectionPieces(markdownSections(text())),
        truncated: false,
      }
    case "text":
      return {
        pieces: sectionPieces([{ path: [], body: text() }]),
        truncated: false,
      }
  }
}

export async function extractDocument(
  bytes: Uint8Array,
  kind: DocumentKind,
  transcribe?: Transcriber
): Promise<Extracted> {
  const input =
    kind === "docx" || kind === "pptx" || kind === "xlsx"
      ? boundedOfficeArchive(bytes)
      : bytes
  const extracted = await extractByKind(input, kind, transcribe)
  const max = kind === "pdf" ? MAX_PDF_PAGES : MAX_PIECES
  const maxChars =
    kind === "xlsx" || kind === "csv" ? MAX_TABLE_PIECE_CHARS : MAX_PIECE_CHARS
  let truncated = extracted.truncated || extracted.pieces.length > max
  const pieces = extracted.pieces.slice(0, max).map((piece) => {
    if (piece.text.length <= maxChars) return piece
    truncated = true
    return { ...piece, text: piece.text.slice(0, maxChars) }
  })
  return { pieces, truncated }
}
