export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/rtf",
  "application/rtf",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-tar",
] as const

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_ATTACHMENTS_PER_MESSAGE = 20

// Types a browser runs script in when opened directly. The file CDN is
// same-site with the API (shared lor.chat cookies), so these objects are stored
// with Content-Disposition: attachment. <img> and fetch() ignore the header,
// so previews still work.
function isActiveContentType(contentType: string): boolean {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  return (
    mime === "text/html" ||
    mime === "text/javascript" ||
    mime === "application/javascript" ||
    mime === "application/ecmascript" ||
    mime === "text/xml" ||
    mime === "application/xml" ||
    mime.endsWith("+xml")
  )
}

export function uploadContentDisposition(
  contentType: string
): "attachment" | undefined {
  return isActiveContentType(contentType) ? "attachment" : undefined
}

// Exact headers for a presigned PUT. Content-Type (and Content-Disposition for
// active types) are signed, so any other value fails the upload.
export function presignedUploadHeaders(
  contentType: string
): Record<string, string> {
  const disposition = uploadContentDisposition(contentType)
  return disposition
    ? { "Content-Type": contentType, "Content-Disposition": disposition }
    : { "Content-Type": contentType }
}
