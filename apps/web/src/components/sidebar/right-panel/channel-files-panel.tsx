import { Message01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useState } from "react"
import { AttachmentLightbox } from "@/components/chat/message-attachment"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { AttachmentsSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { useArtifactConversation } from "@/hooks/use-artifact-conversation"
import { type ChannelFile, useChannelFiles } from "@/hooks/use-channel-files"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
import { getFileKind } from "@/lib/attachments"

function FileThumbnail({ file }: { file: ChannelFile }) {
  const kind = getFileKind(file.contentType, file.name)
  const [failed, setFailed] = useState(false)
  const isImage = file.contentType.startsWith("image/")
  return (
    <span
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50",
        kind.tint
      )}
    >
      <kind.Icon className="size-4" />
      {isImage && !failed && (
        <img
          src={file.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  )
}

function FileRow({
  file,
  channelId,
}: {
  file: ChannelFile
  channelId: string
}) {
  const openArtifact = useArtifactConversation()
  const [imageOpen, setImageOpen] = useState(false)
  const { view } = useRightSidebar()
  const goToMessage = useMessageSearchNavigation()
  const source = file.conversation
  const contents = (
    <>
      <FileThumbnail key={file.url} file={file} />
      <span className="min-w-0 flex-1">
        <span
          className="line-clamp-2 break-words text-xs font-medium leading-snug"
          title={file.name}
        >
          {file.name}
        </span>
        <span
          className="block truncate text-[11px] text-muted-foreground"
          title={`Updated ${new Date(file.updatedAt).toLocaleString()}`}
        >
          {file.authorName}
          {file.version !== null ? ` · v${file.version}` : ""}
          {` · ${new Date(file.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </span>
      </span>
    </>
  )
  const rowClass =
    "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-ring"
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {file.artifactId ? (
        <button
          type="button"
          className={rowClass}
          onClick={() => {
            if (file.artifactId)
              openArtifact({
                artifactId: file.artifactId,
                channelId,
                conversation: source,
                from: "files",
                fileSearch:
                  view?.type === "attachments" ? (view.search ?? "") : "",
              })
          }}
        >
          {contents}
        </button>
      ) : file.contentType.startsWith("image/") ? (
        <button
          type="button"
          className={rowClass}
          onClick={() => setImageOpen(true)}
        >
          {contents}
        </button>
      ) : (
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClass}
        >
          {contents}
        </a>
      )}
      {source && (
        <button
          type="button"
          aria-label={`View conversation for ${file.name}`}
          title="View conversation"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() =>
            goToMessage({
              id: source.messageId,
              channelId,
              threadRootId: source.threadRootId,
            })
          }
        >
          <HugeiconsIcon icon={Message01Icon} size={15} />
        </button>
      )}
      {imageOpen && (
        <AttachmentLightbox
          images={[
            {
              url: file.url,
              filename: file.name,
              contentType: file.contentType,
              size: file.size ?? 0,
            },
          ]}
          initialIndex={0}
          open={imageOpen}
          onOpenChange={setImageOpen}
        />
      )}
    </div>
  )
}

function FileList({
  channelId,
  search = "",
  query,
  label = "files",
}: {
  channelId: string
  search?: string
  query: ReturnType<typeof useChannelFiles>
  label?: string
}) {
  // A file updated between pages can move to the front; show its newest entry once.
  const byId = new Map<string, ChannelFile>()
  for (const file of query.data?.pages.flatMap((page) => page.files) ?? []) {
    if (!byId.has(file.id)) byId.set(file.id, file)
  }
  const files = [...byId.values()]
  if (query.isPending)
    return (
      <div className="space-y-2 px-2 py-2" aria-busy="true">
        <span className="sr-only">Loading {label}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    )
  if (query.isError && !query.data)
    return (
      <div className="px-2 py-3 text-xs text-muted-foreground" role="alert">
        Couldn't load {label}.{" "}
        <button
          type="button"
          className="cursor-pointer underline"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </div>
    )
  if (!files.length)
    return (
      <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
        {search ? "No matches." : `No ${label} yet.`}
      </p>
    )
  return (
    <>
      <div className="space-y-0.5">
        {files.map((file) => (
          <FileRow key={file.id} file={file} channelId={channelId} />
        ))}
      </div>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage
            ? "Loading…"
            : query.isFetchNextPageError
              ? "Couldn't load more. Retry"
              : "Load more"}
        </Button>
      )}
    </>
  )
}

export function ChannelFilesPanel({ view }: { view: AttachmentsSidebarView }) {
  const { setView } = useRightSidebar()
  const search = view.search ?? ""
  const kind = view.kind ?? "upload"
  const title = kind === "artifact" ? "Artifacts" : "Attachments"
  const [query, setQuery] = useState(search.trim())
  const files = useChannelFiles(view.channelId, query, kind)
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200)
    return () => clearTimeout(timer)
  }, [search])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <RightPanelHeader
        title={title}
        compact
        workspaceSlug={view.workspaceSlug}
        channelId={view.channelId}
      />
      <div className="px-3 py-3">
        <label className="flex items-center gap-2 rounded-md border px-2.5 py-2 focus-within:ring-1 focus-within:ring-ring">
          <HugeiconsIcon
            icon={Search01Icon}
            size={15}
            className="shrink-0 text-muted-foreground"
          />
          <input
            type="search"
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search…"
            maxLength={200}
            value={search}
            onChange={(event) =>
              setView({ ...view, search: event.target.value })
            }
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <FileList
          channelId={view.channelId}
          search={query}
          query={files}
          label={title.toLowerCase()}
        />
      </div>
    </div>
  )
}
