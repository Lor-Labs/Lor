import { MessageMarkdown } from "@/components/chat/message-markdown"
import {
  isTextRenderable,
  MAX_INLINE_BYTES,
  useArtifactContent,
} from "@/hooks/use-artifact"

const CODE_LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  json: "json",
  html: "html",
  sql: "sql",
  sh: "bash",
  diff: "diff",
  patch: "diff",
}

function codeLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return CODE_LANGUAGES[ext] ?? ext
}

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
  const content = useArtifactContent({ url, mime, size })

  if (mime.startsWith("image/") && mime !== "image/svg+xml" && url) {
    return (
      <img src={url} alt={path} className="max-h-full max-w-full self-start" />
    )
  }

  // Must mirror useArtifactContent's enabled guard: a file it refuses to
  // fetch (too big, wrong type) would otherwise sit in isPending forever.
  if (!url || !isTextRenderable(mime) || (size ?? 0) > MAX_INLINE_BYTES) {
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

  if (mime === "text/markdown") {
    return <MessageMarkdown content={content.data} mentions={[]} />
  }
  // Fence longer than any backtick run in the content, so embedded ``` can't
  // close the block early.
  const longestRun =
    content.data
      .match(/`+/g)
      ?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const fence = "`".repeat(Math.max(3, longestRun + 1))
  return (
    <MessageMarkdown
      content={`${fence}${codeLanguage(path)}\n${content.data}\n${fence}`}
      mentions={[]}
    />
  )
}
