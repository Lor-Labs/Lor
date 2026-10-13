import { Message01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  FileChip,
  FileChipAction,
  FileChipActions,
  FileChipContent,
  FileChipDescription,
  FileChipLink,
  FileChipMedia,
  FileChipTitle,
  FileChipTrigger,
} from "@repo/ui/components/file-chip"
import { FileTypeIcon } from "@repo/ui/components/file-type-icon"
import { Skeleton } from "@repo/ui/components/skeleton"
import { useEffect, useState } from "react"
import { AttachmentLightbox } from "@/components/chat/message-attachment"
import { RightPanelHeader } from "@/components/sidebar/right-panel/right-panel-header"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { AttachmentsSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { type ChannelFile, useChannelFiles } from "@/hooks/use-channel-files"
import { useOpenFile, useOpenUpload } from "@/hooks/use-file-panel"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"

// Images show a thumbnail; other files, or an image that fails to load,
// show their type icon.
function FileThumbnail({ file }: { file: ChannelFile }) {
  const [failed, setFailed] = useState(false)
  if (!file.contentType.startsWith("image/") || failed) {
    return (
      <FileChipMedia>
        <FileTypeIcon filename={file.name} />
      </FileChipMedia>
    )
  }
  return (
    <FileChipMedia variant="image">
      <img
        src={file.url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </FileChipMedia>
  )
}

function FileRow({
  file,
  channelId,
}: {
  file: ChannelFile
  channelId: string
}) {
  const openFile = useOpenFile()
  const openUpload = useOpenUpload()
  const [imageOpen, setImageOpen] = useState(false)
  const goToMessage = useMessageSearchNavigation()
  const source = file.conversation
  const { artifactId, attachmentIndex } = file
  const title = `${file.name}\nUpdated ${new Date(file.updatedAt).toLocaleString()}`
  return (
    <FileChip className="w-full border-transparent bg-transparent">
      <FileThumbnail key={file.url} file={file} />
      <FileChipContent>
        <FileChipTitle>{file.name}</FileChipTitle>
        <FileChipDescription>
          {file.authorName}
          {file.version !== null ? ` · v${file.version}` : ""}
          {` · ${new Date(file.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </FileChipDescription>
      </FileChipContent>
      {artifactId ? (
        <FileChipTrigger
          aria-label={`Open ${file.name}`}
          title={title}
          onClick={() => openFile(artifactId)}
        />
      ) : file.contentType.startsWith("image/") ? (
        <FileChipTrigger
          aria-label={`View ${file.name}`}
          title={title}
          onClick={() => setImageOpen(true)}
        />
      ) : source && attachmentIndex !== null ? (
        <FileChipTrigger
          aria-label={`Open ${file.name}`}
          title={title}
          onClick={() => openUpload(source.messageId, attachmentIndex)}
        />
      ) : (
        <FileChipLink
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          label={`Open ${file.name}`}
          title={title}
        />
      )}
      {source && (
        <FileChipActions>
          <FileChipAction
            aria-label={`View conversation for ${file.name}`}
            title="View conversation"
            onClick={() =>
              goToMessage({
                id: source.messageId,
                channelId,
                threadRootId: source.threadRootId,
                sessionId: source.sessionId,
              })
            }
          >
            <HugeiconsIcon icon={Message01Icon} />
          </FileChipAction>
        </FileChipActions>
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
    </FileChip>
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
