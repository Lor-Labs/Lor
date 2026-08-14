import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Attachment,
  AttachmentList,
} from "@repo/ui/components/nexus-ui/attachments"
import { cn } from "@repo/ui/lib/utils"
import { useState } from "react"
import { createPortal } from "react-dom"
import type { PendingAttachment } from "@/hooks/use-file-upload"
import { toAttachmentMeta } from "@/lib/attachments"

interface AttachmentPreviewProps {
  attachments: PendingAttachment[]
  onRemove: (id: string) => void
}

// Pending composer attachments, rendered with the Nexus attachment tiles so
// they match message history. Only the presentational primitives are used —
// not the `Attachments` root — because useFileUpload already owns the picker,
// the MIME/size/count validation, the object-URL lifecycle and the presigned
// upload, and the routes already own drag-and-drop. Mounting the root would
// duplicate all of it (two file inputs, two document drop listeners).
export function AttachmentPreview({
  attachments,
  onRemove,
}: AttachmentPreviewProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <AttachmentList className="justify-start px-4 pt-3 pb-2">
        {attachments.map((attachment) => {
          const isImage = attachment.contentType.startsWith("image/")
          const previewable = isImage ? attachment.previewUrl : undefined
          const meta = toAttachmentMeta({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            // Blob preview while uploading, then the stored URL once it lands.
            url: attachment.previewUrl ?? attachment.url,
            width: attachment.width,
            height: attachment.height,
          })

          return (
            <Attachment
              key={attachment.id}
              // Images speak for themselves as a square thumbnail; everything
              // else needs its name and size. Both variants are 60px tall, so
              // a mixed row still lines up.
              variant={isImage ? "compact" : "detailed"}
              attachment={meta}
              progress={attachment.progress}
              onRemove={() => onRemove(attachment.id)}
              className={cn(
                attachment.status === "error" &&
                  "border-destructive/50 opacity-60",
                // Dim the thumbnail while bytes are still going out, so an
                // image tile reads as in-flight even at a glance.
                attachment.status === "uploading" && "[&_img]:opacity-65",
                previewable &&
                  "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              )}
              // Inside AttachmentList (role="list"), so tiles carry listitem —
              // except previewable images, where an actionable button is the
              // more useful semantic for the lightbox.
              role={previewable ? "button" : "listitem"}
              tabIndex={previewable ? 0 : undefined}
              onClick={
                previewable ? () => setLightboxUrl(previewable) : undefined
              }
              onKeyDown={
                previewable
                  ? (event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      setLightboxUrl(previewable)
                    }
                  : undefined
              }
            />
          )
        })}
      </AttachmentList>

      {lightboxUrl &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            tabIndex={-1}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLightboxUrl(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setLightboxUrl(null)
            }}
          >
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: focus the dismiss control when the modal opens
              autoFocus
              onClick={() => setLightboxUrl(null)}
              className="absolute right-4 top-4 rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <HugeiconsIcon
                icon={Cancel01Icon}
                className="size-5"
                strokeWidth={2}
              />
            </button>
            <img
              src={lightboxUrl}
              alt=""
              className="max-h-[calc(100vh-100px)] max-w-[calc(100vw-120px)] rounded object-contain"
            />
          </div>,
          document.body
        )}
    </>
  )
}
