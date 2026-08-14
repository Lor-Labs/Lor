import {
  File01Icon,
  File02Icon,
  FileScriptIcon,
  FileZipIcon,
  Presentation01Icon,
  Xls01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import type { AttachmentMeta } from "@repo/ui/components/nexus-ui/attachments"
import type { ComponentType } from "react"

function glyph(icon: IconSvgElement): ComponentType<{ className?: string }> {
  return (props: { className?: string }) => (
    <HugeiconsIcon icon={icon} strokeWidth={2} {...props} />
  )
}

const FileGlyph = glyph(File01Icon)
const FileTextGlyph = glyph(File02Icon)
const FileScriptGlyph = glyph(FileScriptIcon)
const FileZipGlyph = glyph(FileZipIcon)
const PresentationGlyph = glyph(Presentation01Icon)
const SpreadsheetGlyph = glyph(Xls01Icon)

// Single mapper to Nexus's AttachmentMeta, so a PDF (or any file) renders the
// same tile in the composer and in message history. Only image/video types use
// `url` for a built-in preview; everything else keeps the type icon.
export function toAttachmentMeta(input: {
  filename: string
  contentType: string
  size?: number
  url?: string
  width?: number | null
  height?: number | null
}): AttachmentMeta {
  const mime = input.contentType.toLowerCase()
  const type: AttachmentMeta["type"] = mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
        ? "audio"
        : "file"

  return {
    type,
    name: input.filename,
    url: input.url,
    mimeType: input.contentType || undefined,
    size: input.size,
    width: input.width ?? undefined,
    height: input.height ?? undefined,
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type FileKind = {
  Icon: ComponentType<{ className?: string }>
  tint: string
  label: string
}

type KindDef = FileKind & { contentTypes: string[]; extensions: string[] }

const FILE_KINDS: KindDef[] = [
  {
    Icon: FileTextGlyph,
    tint: "bg-destructive/10 text-destructive",
    label: "PDF",
    contentTypes: ["application/pdf"],
    extensions: ["pdf"],
  },
  {
    Icon: SpreadsheetGlyph,
    tint: "bg-success/10 text-success",
    label: "Sheet",
    contentTypes: [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    extensions: ["csv", "xls", "xlsx"],
  },
  {
    Icon: FileTextGlyph,
    tint: "bg-chart-2/10 text-chart-2",
    label: "Doc",
    contentTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: ["doc", "docx"],
  },
  {
    Icon: PresentationGlyph,
    tint: "bg-chart-4/10 text-chart-4",
    label: "Slides",
    contentTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    extensions: ["ppt", "pptx"],
  },
  {
    Icon: FileScriptGlyph,
    tint: "bg-chart-3/10 text-chart-3",
    label: "JSON",
    contentTypes: ["application/json"],
    extensions: ["json"],
  },
  {
    Icon: FileZipGlyph,
    tint: "bg-chart-1/10 text-chart-1",
    label: "Archive",
    contentTypes: ["application/zip", "application/x-tar"],
    extensions: ["zip", "tar", "gz"],
  },
  {
    Icon: FileTextGlyph,
    tint: "bg-muted text-muted-foreground",
    label: "Text",
    contentTypes: [
      "text/plain",
      "text/markdown",
      "text/rtf",
      "application/rtf",
    ],
    extensions: ["txt", "md", "rtf"],
  },
]

const FALLBACK: FileKind = {
  Icon: FileGlyph,
  tint: "bg-muted text-muted-foreground",
  label: "File",
}

export function getFileKind(contentType: string, filename: string): FileKind {
  const ext = filename.includes(".")
    ? (filename.split(".").pop()?.toLowerCase() ?? "")
    : ""
  const match = FILE_KINDS.find(
    (k) => k.contentTypes.includes(contentType) || k.extensions.includes(ext)
  )
  if (!match) return FALLBACK
  // Prefer the concrete extension as the label, but only when it belongs to
  // the matched kind — otherwise fall back to the category label so the icon
  // and label can never diverge (e.g. a PDF with no/odd extension).
  const label = match.extensions.includes(ext) ? ext.toUpperCase() : match.label
  return { Icon: match.Icon, tint: match.tint, label }
}
