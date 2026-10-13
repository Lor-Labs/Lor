import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download01Icon,
  Message01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button, buttonVariants } from "@repo/ui/components/button"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { Spinner } from "@repo/ui/components/spinner"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { ArtifactBody } from "@/components/artifacts/artifact-body"
import { CsvGrid } from "@/components/artifacts/csv-grid"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import {
  MAX_INLINE_BYTES,
  useArtifact,
  useArtifactContent,
} from "@/hooks/use-artifact"
import { useCloseFile } from "@/hooks/use-file-panel"
import { formatFileSize } from "@/lib/attachments"
import { csvDelimiterForMime, isCsvMime, parseCsvData } from "@/lib/csv"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Copy contents"
      title="Copy contents"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
    </Button>
  )
}

// A file in the right panel, opened by ?artifactId on any page. It covers the
// panel's current view and closing returns to it. Read-only: edits go
// through Lor or Download.
export function FilePanel({ artifactId }: { artifactId: string }) {
  const navigate = useNavigate()
  const { workspaceSlug, sessionId: routeSessionId } = useParams({
    strict: false,
  })
  const { view } = useRightSidebar()
  const close = useCloseFile()
  const { data, isPending, isError, refetch } = useArtifact(artifactId)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const version = data?.versions.find((v) => v.version === selectedVersion)
  const artifact = data
    ? {
        ...data.artifact,
        ...(version
          ? {
              url: version.url,
              mime: version.contentType,
              size: version.size,
              currentVersion: version.version,
            }
          : {}),
      }
    : null
  const csv = artifact !== null && isCsvMime(artifact.mime)
  // Mirrors useArtifactContent's enabled guard: a CSV it won't fetch shows
  // the fallback instead of waiting forever.
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
  // Hidden on the file's own session page: that is its conversation.
  const sessionId =
    data?.conversation?.sessionId !== routeSessionId
      ? (data?.conversation?.sessionId ?? null)
      : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-border/70 border-b px-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={view ? "Back" : "Close file"}
          title={view ? "Back" : "Close file"}
          onClick={close}
        >
          <HugeiconsIcon icon={view ? ArrowLeft01Icon : Cancel01Icon} />
        </Button>
        <FileTypeIcon filename={artifact?.path ?? ""} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-sm leading-4">
            {artifact?.path ?? "File"}
          </span>
          {artifact && (
            <span className="truncate text-muted-foreground text-xs tabular-nums leading-4">
              {parsed
                ? `${parsed.rows.length.toLocaleString()} rows · ${parsed.columns.length.toLocaleString()} columns`
                : `v${artifact.currentVersion}${artifact.size !== null ? ` · ${formatFileSize(artifact.size)}` : ""}`}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {data && data.versions.length > 1 && (
            <select
              aria-label="File version"
              value={artifact?.currentVersion}
              onChange={(event) => {
                const next = Number(event.target.value)
                setSelectedVersion(
                  next === data.artifact.currentVersion ? null : next
                )
              }}
              className="mr-1 h-7 max-w-24 rounded-md border bg-background px-1 text-xs"
            >
              {data.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}
                  {v.version === data.artifact.currentVersion
                    ? " · Latest"
                    : ""}
                </option>
              ))}
            </select>
          )}
          {sessionId && workspaceSlug && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open session"
              title="Open session"
              onClick={() =>
                void navigate({
                  to: "/$workspaceSlug/session/$sessionId",
                  params: { workspaceSlug, sessionId },
                  search: { artifactId },
                })
              }
            >
              <HugeiconsIcon icon={Message01Icon} />
            </Button>
          )}
          {content.data !== undefined && <CopyButton text={content.data} />}
          {artifact?.url && (
            <a
              href={artifact.url}
              download={artifact.path}
              aria-label="Download"
              title="Download"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            >
              <HugeiconsIcon icon={Download01Icon} />
            </a>
          )}
        </div>
      </div>

      {/* min-h-0 / min-w-0 keep the grid from blowing out of the panel. */}
      <div className="min-h-0 min-w-0 flex-1">
        {parsed ? (
          <CsvGrid columns={parsed.columns} rows={parsed.rows} />
        ) : (
          <div className="h-full overflow-auto p-4">
            {(isPending || (csvPreviewable && content.isPending)) && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}
            {(isError || (csvPreviewable && content.isError)) && (
              <div className="space-y-2 text-muted-foreground text-sm">
                <p role="alert">Couldn't load this file.</p>
                <button
                  type="button"
                  className="cursor-pointer underline underline-offset-4 hover:text-foreground"
                  onClick={() => void (isError ? refetch() : content.refetch())}
                >
                  Try again
                </button>
              </div>
            )}
            {csv && !csvPreviewable && (
              <p className="text-muted-foreground text-sm">
                Too large to preview. Download it to open.
              </p>
            )}
            {artifact && !csv && (
              <ArtifactBody
                path={artifact.path}
                mime={artifact.mime}
                url={artifact.url}
                size={artifact.size}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
