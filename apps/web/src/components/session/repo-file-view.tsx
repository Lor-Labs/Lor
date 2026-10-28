import { File as CodeFile } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { ImagePreview } from "@/components/artifacts/image-preview"
import {
  DIFF_CSS,
  FolderGapNote,
  PanelNote,
} from "@/components/sidebar/right-panel/session-changes-panel"
import { useDiffHighlighter } from "@/hooks/use-diff-highlighter"
import { useRepoFile, useRepoImage } from "@/hooks/use-session-changes"

function FileSource({ path, content }: { path: string; content: string }) {
  const { resolvedTheme } = useTheme()
  const { ready, language } = useDiffHighlighter(path)
  if (!ready)
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card py-1.5">
      <CodeFile
        file={{ name: path, contents: content, lang: language }}
        options={{
          themeType: resolvedTheme === "dark" ? "dark" : "light",
          overflow: "scroll",
          disableFileHeader: true,
          unsafeCSS: DIFF_CSS,
        }}
      />
    </div>
  )
}

function RepoImageView({
  sessionId,
  path,
}: {
  sessionId: string
  path: string
}) {
  const image = useRepoImage(sessionId, path)
  const blob = image.data?.blob
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null
  )
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setPreview({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])

  if (image.isError) {
    return (
      <PanelNote>
        Couldn't load the image.
        <Button
          size="xs"
          variant="outline"
          onClick={() => void image.refetch()}
        >
          Try again
        </Button>
      </PanelNote>
    )
  }
  if (!image.data || !preview || preview.blob !== blob) {
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  }
  return (
    <ImagePreview
      path={path}
      url={preview.url}
      source={
        blob?.type === "image/svg+xml" ? (
          image.data.source !== null ? (
            <FileSource path={path} content={image.data.source} />
          ) : (
            <PanelNote>This SVG is too large to show its source.</PanelNote>
          )
        ) : undefined
      }
    />
  )
}

export function RepoFileView({
  sessionId,
  path,
}: {
  sessionId: string
  path: string
}) {
  const file = useRepoFile(sessionId, path)
  if (file.isPending)
    return (
      <PanelNote>
        <Spinner className="size-4" />
      </PanelNote>
    )
  if (file.isError) return <PanelNote>Couldn't load the file.</PanelNote>
  if (file.data.kind === "binary")
    return <PanelNote>No preview for this file type.</PanelNote>
  if (file.data.kind === "too_large")
    return <PanelNote>This file is too large to preview.</PanelNote>
  if (file.data.kind === "missing")
    return <PanelNote>This file no longer exists.</PanelNote>
  if (
    file.data.kind === "gone" ||
    file.data.kind === "preparing" ||
    file.data.kind === "restoring" ||
    file.data.kind === "restore_failed"
  ) {
    return (
      <FolderGapNote gap={file.data.kind} onRetry={() => void file.refetch()} />
    )
  }
  return (
    <div className="m-3">
      {file.data.kind === "image" ? (
        <RepoImageView
          key={`${sessionId}:${path}`}
          sessionId={sessionId}
          path={path}
        />
      ) : (
        <FileSource path={path} content={file.data.content} />
      )}
    </div>
  )
}
