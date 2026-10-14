import type { AttachmentMeta } from "@repo/ui/components/nexus-ui/attachments"

// Single mapper to Nexus's AttachmentMeta for the composer's pending tiles.
// Only image/video types use `url` for a built-in preview; everything else
// keeps the type icon.
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

// A file chip's detail line, e.g. "CSV · 12.0 KB".
export function describeFile(name: string, size: number | null): string {
  const extension = name.includes(".")
    ? name.split(".").pop()?.toUpperCase()
    : undefined
  const type = extension || "File"
  return size === null ? type : `${type} · ${formatFileSize(size)}`
}
