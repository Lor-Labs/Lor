import { Spinner } from "@repo/ui/components/spinner"
import { useState } from "react"

// Only a file the CDN serves as application/pdf can be framed: an older file
// stored as octet-stream would download instead, so it keeps the fallback.
export function servesAsPdf(mime: string): boolean {
  return mime.split(";")[0]?.trim().toLowerCase() === "application/pdf"
}

// PDF preview in the browser's built-in viewer (zoom, search, print). The
// desktop app allows the CDN (*.lor.chat) in its CSP frame-src.
export function PdfPreview({ url, name }: { url: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative size-full">
      {/* Under the frame, so a viewer that never fires load still covers it. */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner aria-label="Loading PDF" className="size-5" />
        </div>
      )}
      <iframe
        src={url}
        title={name}
        onLoad={() => setLoaded(true)}
        className="relative block size-full border-0"
      />
    </div>
  )
}
