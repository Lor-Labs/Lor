import {
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
import {
  csvDelimiterForMime,
  filePreviewMime,
  isCsvMime,
  MAX_PREVIEW_BYTES,
} from "@repo/utils/file-preview"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { type ReactNode, useMemo, useState } from "react"
import { ArtifactBody } from "@/components/artifacts/artifact-body"
import { CsvGrid } from "@/components/artifacts/csv-grid"
import type { OpenFile } from "@/components/sidebar/right-panel/right-sidebar-context"
import { useArtifact, useArtifactContent } from "@/hooks/use-artifact"
import { useCloseFile } from "@/hooks/use-file-panel"
import { locationQuery } from "@/hooks/use-message-search-navigation"
import { formatFileSize } from "@/lib/attachments"
import { parseCsvData } from "@/lib/csv"

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="icon"
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

// A file in the right panel, opened from the URL on any page: one of Lor's
// files or an upload. It covers the panel's current view and closing returns
// to it. Read-only: edits go through Lor or Download.
export function FilePanel({ file }: { file: OpenFile }) {
  return file.kind === "artifact" ? (
    <ArtifactFilePanel key={file.artifactId} artifactId={file.artifactId} />
  ) : (
    <UploadFilePanel messageId={file.messageId} index={file.index} />
  )
}

function ArtifactFilePanel({ artifactId }: { artifactId: string }) {
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

  return (
    <FileView
      file={
        artifact && {
          name: artifact.path,
          url: artifact.url,
          mime: artifact.mime,
          size: artifact.size,
          detail: `v${artifact.currentVersion}${artifact.size !== null ? ` · ${formatFileSize(artifact.size)}` : ""}`,
        }
      }
      sessionId={data?.conversation?.sessionId ?? null}
      isPending={isPending}
      isError={isError}
      onRetry={() => void refetch()}
      versionSelect={
        data &&
        data.versions.length > 1 && (
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
                {v.version === data.artifact.currentVersion ? " · Latest" : ""}
              </option>
            ))}
          </select>
        )
      }
    />
  )
}

// An upload is found through its message, with the message's access check.
function UploadFilePanel({
  messageId,
  index,
}: {
  messageId: string
  index: number
}) {
  const { workspaceSlug = "" } = useParams({ strict: false })
  const { data, isPending, isError, refetch } = useQuery({
    ...locationQuery(workspaceSlug, messageId),
    enabled: Boolean(workspaceSlug),
  })
  const upload = data?.attachments?.[index]

  return (
    <FileView
      file={
        upload && {
          name: upload.filename,
          url: upload.url,
          mime: upload.contentType,
          size: upload.size,
          detail: formatFileSize(upload.size),
        }
      }
      sessionId={data?.sessionId ?? null}
      isPending={isPending}
      isError={isError || (data !== undefined && !upload)}
      onRetry={() => void refetch()}
    />
  )
}

function FileView({
  file,
  sessionId: fileSessionId,
  isPending,
  isError,
  onRetry,
  versionSelect,
}: {
  file:
    | {
        name: string
        url: string | null
        mime: string
        size: number | null
        // Shown under the name when the file isn't a table.
        detail: string
      }
    | null
    | undefined
  sessionId: string | null
  isPending: boolean
  isError: boolean
  onRetry: () => void
  versionSelect?: ReactNode
}) {
  const navigate = useNavigate()
  const { workspaceSlug, sessionId: routeSessionId } = useParams({
    strict: false,
  })
  const close = useCloseFile()
  const mime = file ? filePreviewMime(file.name, file.mime) : null
  const csv = Boolean(mime && isCsvMime(mime))
  // Mirrors useArtifactContent's enabled guard: a CSV it won't fetch shows
  // the fallback instead of waiting forever.
  const csvPreviewable = csv && (file?.size ?? 0) <= MAX_PREVIEW_BYTES
  const content = useArtifactContent({
    url: file?.url ?? null,
    mime,
    size: file?.size ?? null,
  })
  const parsed = useMemo(
    () =>
      csv && mime && content.data !== undefined
        ? parseCsvData(content.data, csvDelimiterForMime(mime))
        : null,
    [csv, mime, content.data]
  )
  // Hidden on the file's own session page: that is its conversation.
  const sessionId = fileSessionId !== routeSessionId ? fileSessionId : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="Close file"
          title="Close file"
          onClick={close}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <FileTypeIcon filename={file?.name ?? ""} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-sm leading-4">
            {file?.name ?? "File"}
          </span>
          {file && (
            <span className="truncate text-muted-foreground text-xs tabular-nums leading-4">
              {parsed
                ? `${parsed.rows.length.toLocaleString()} rows · ${parsed.columns.length.toLocaleString()} columns`
                : file.detail}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {versionSelect}
          {sessionId && workspaceSlug && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Open session"
              title="Open session"
              onClick={() =>
                void navigate({
                  to: "/$workspaceSlug/session/$sessionId",
                  params: { workspaceSlug, sessionId },
                  search: (prev) => ({
                    artifactId: prev.artifactId,
                    upload: prev.upload,
                  }),
                })
              }
            >
              <HugeiconsIcon icon={Message01Icon} />
            </Button>
          )}
          {content.data !== undefined && <CopyButton text={content.data} />}
          {file?.url && (
            <a
              href={file.url}
              download={file.name}
              aria-label="Download"
              title="Download"
              className={buttonVariants({
                variant: "outline",
                size: "icon",
              })}
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
                  onClick={() => {
                    if (isError) onRetry()
                    else void content.refetch()
                  }}
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
            {file && !csv && (
              <ArtifactBody
                path={file.name}
                mime={file.mime}
                url={file.url}
                size={file.size}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
