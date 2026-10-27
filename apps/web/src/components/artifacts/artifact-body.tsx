import {
  filePreviewMime,
  isTextPreviewable,
  MAX_PREVIEW_BYTES,
  previewMarkdown,
} from "@repo/utils/file-preview"
import { ImagePreview } from "@/components/artifacts/image-preview"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { useArtifactContent } from "@/hooks/use-artifact"

// Per-MIME artifact renderer. Registry-shaped on purpose: each type maps to
// one view, and future types (pptx download cards, live HTML apps, editable
// docs) register here without touching the viewer shell.
export function ArtifactBody({
  path,
  mime,
  url,
  size,
}: {
  path: string
  mime: string
  url: string | null
  size: number | null
}) {
  const previewMime = filePreviewMime(path, mime)
  if (previewMime.startsWith("image/") && url) {
    return (
      <ImagePreview
        path={path}
        url={url}
        source={
          previewMime === "image/svg+xml" ? (
            <ArtifactText
              path={path}
              mime={previewMime}
              url={url}
              size={size}
            />
          ) : undefined
        }
      />
    )
  }
  return <ArtifactText path={path} mime={previewMime} url={url} size={size} />
}

function ArtifactText({
  path,
  mime,
  url,
  size,
}: {
  path: string
  mime: string
  url: string | null
  size: number | null
}) {
  const content = useArtifactContent({ url, mime, size })

  // Must mirror useArtifactContent's enabled guard: a file it refuses to
  // fetch (too big, wrong type) would otherwise sit in isPending forever.
  if (!url || !isTextPreviewable(mime) || (size ?? 0) > MAX_PREVIEW_BYTES) {
    return (
      <p className="text-muted-foreground text-sm">
        No preview for this file — use Download.
      </p>
    )
  }
  if (content.isPending) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }
  if (content.isError || content.data === undefined) {
    return (
      <p className="text-muted-foreground text-sm">
        Couldn't load the file — use Download.
      </p>
    )
  }

  return (
    <MessageMarkdown
      content={previewMarkdown(path, mime, content.data)}
      mentions={[]}
    />
  )
}
