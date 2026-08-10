import {
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { motion } from "framer-motion"
import { useEffect, useMemo, useState } from "react"
import { ArtifactBody } from "@/components/artifacts/artifact-body"
import { CsvGrid } from "@/components/artifacts/csv-grid"
import {
  MAX_INLINE_BYTES,
  useArtifact,
  useArtifactContent,
} from "@/hooks/use-artifact"
import { formatFileSize } from "@/lib/attachments"
import { csvDelimiterForMime, isCsvMime, parseCsvData } from "@/lib/csv"

const toolbarButton =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title="Copy contents"
      className={toolbarButton}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
    </button>
  )
}

// Artifact viewer over the channel panel — NOT fullscreen: the workspace
// sidebar and the right thread panel stay, so opening a task's CSV gives
// file-wide-center with the conversation still beside it. Addressed by
// ?artifactId= — the URL is the share link today and the multiplayer room
// key when live editing lands. Opens by morphing out of the in-chat CSV
// preview card (shared layoutId). Read-only: edits go through Merlin or
// Download, by decision.
export function ArtifactOverlay({
  artifactId,
  onClose,
}: {
  artifactId: string
  onClose: () => void
}) {
  const { data, isPending, isError } = useArtifact(artifactId)
  const artifact = data?.artifact ?? null
  const csv = artifact !== null && isCsvMime(artifact.mime)
  // Mirrors useArtifactContent's enabled guard — a CSV it refuses to fetch
  // must show the fallback, not wait on a query that never runs.
  const csvPreviewable = csv && (artifact.size ?? 0) <= MAX_INLINE_BYTES
  const content = useArtifactContent({
    url: artifact?.url ?? null,
    mime: artifact?.mime ?? null,
    size: artifact?.size ?? null,
  })

  const parsed = useMemo(
    () =>
      csv && content.data !== undefined
        ? parseCsvData(content.data, csvDelimiterForMime(artifact.mime))
        : null,
    [csv, content.data, artifact?.mime]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return (
    <motion.div
      role="dialog"
      aria-label={artifact?.path ?? "Artifact"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-30 bg-background"
    >
      <motion.div
        layoutId={`artifact:${artifactId}`}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="flex h-full flex-col bg-background"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={toolbarButton}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
          <div className="flex min-w-0 flex-col">
            <span className="min-w-0 truncate font-medium text-sm leading-4">
              {artifact ? artifact.path : "Artifact"}
            </span>
            {artifact && (
              <span className="text-muted-foreground text-xs leading-4">
                {parsed
                  ? `${parsed.rows.length.toLocaleString()} rows · ${parsed.columns.length.toLocaleString()} columns`
                  : `v${artifact.currentVersion}${
                      artifact.size !== null
                        ? ` · ${formatFileSize(artifact.size)}`
                        : ""
                    }`}
              </span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {content.data !== undefined && <CopyButton text={content.data} />}
            {artifact?.url && (
              <a
                href={artifact.url}
                download={artifact.path}
                title="Download"
                className={toolbarButton}
              >
                <HugeiconsIcon icon={Download01Icon} size={16} />
              </a>
            )}
          </div>
        </div>

        {/* min-h-0 / min-w-0 are load-bearing: without them the flex child
              refuses to shrink and the grid blows out of the viewport. */}
        <div className="min-h-0 min-w-0 flex-1">
          {parsed ? (
            <CsvGrid columns={parsed.columns} rows={parsed.rows} />
          ) : (
            <div className="flex h-full flex-col overflow-auto p-6">
              {(isPending || (csvPreviewable && content.isPending)) && (
                <p className="text-muted-foreground text-sm">Loading…</p>
              )}
              {(isError || (csvPreviewable && content.isError)) && (
                <p className="text-muted-foreground text-sm">
                  Couldn't load this artifact.
                </p>
              )}
              {csv && !csvPreviewable && (
                <p className="text-muted-foreground text-sm">
                  Too large to preview — use Download.
                </p>
              )}
              {artifact && !csv && (
                <div className="mx-auto w-full max-w-3xl">
                  <ArtifactBody
                    path={artifact.path}
                    mime={artifact.mime}
                    url={artifact.url}
                    size={artifact.size}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
