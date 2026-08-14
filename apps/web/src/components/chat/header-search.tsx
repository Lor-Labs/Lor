import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { ExpandingSearch } from "@repo/ui/components/interior/expanding-search"
import { Spinner } from "@repo/ui/components/spinner"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { formatTime } from "@repo/utils/date"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
import { apiClient } from "@/lib/api-client"
import { toSearchPreviewText } from "@/lib/search-preview"

type SearchResult = {
  id: string
  content: string
  createdAt: string
  channelId: string
  channelName: string
  threadRootId?: string | null
  author: {
    id: string
    name: string
    username: string | null
    displayUsername: string | null
    image: string | null
  }
  mentions?: Array<{
    id: string
    name: string
    username: string | null
    displayUsername: string | null
    image: string | null
  }>
}

type SearchResponse = {
  itemsTotal: number
  data: SearchResult[]
}

export function HeaderSearch({
  mode,
  channelId,
}: {
  mode: "workspace" | "dm"
  channelId: string
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const navigateToWorkspaceMessage = useMessageSearchNavigation()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const { data, isPending } = useQuery({
    queryKey: ["header-search", channelId, debouncedQuery],
    queryFn: async (): Promise<SearchResponse> => {
      if (mode === "dm") {
        const res = await apiClient.v1.dms.search.$get({
          query: { query: debouncedQuery, dmId: channelId },
        })
        if (!res.ok) throw new Error("Search failed")
        return res.json()
      }
      const res = await apiClient.v1.workspaces[":workspaceSlug"].search.$get({
        param: { workspaceSlug: workspaceSlug as string },
        query: { query: debouncedQuery, channelId },
      })
      if (!res.ok) throw new Error("Search failed")
      return res.json()
    },
    enabled: debouncedQuery.length > 0,
  })

  const handleResultClick = (msg: SearchResult) => {
    setIsOpen(false)
    setQuery("")
    setDebouncedQuery("")
    if (mode === "dm") {
      void navigate({
        to: "/dms/$dmId",
        params: { dmId: channelId },
        search: { msgId: msg.id },
      })
    } else {
      navigateToWorkspaceMessage({
        id: msg.id,
        channelId: msg.channelId,
        threadRootId: msg.threadRootId ?? null,
      })
    }
  }

  return (
    <div ref={containerRef} className="relative h-10 w-7 shrink-0">
      <ExpandingSearch
        value={query}
        onChange={(value) => {
          setQuery(value)
          if (!value.trim()) setDebouncedQuery("")
        }}
        onSearch={(value) => {
          // A debounce pending from a previous keystroke still fires after the
          // field is cleared or reset by handleResultClick; applying it would
          // resurrect stale results, so only accept values that still match the
          // current input.
          const next = value.trim()
          if (next !== query.trim()) return
          setDebouncedQuery(next)
        }}
        open={isOpen}
        onOpenChange={setIsOpen}
        debounce={300}
        placeholder={
          mode === "dm"
            ? "Search this conversation..."
            : "Search this channel..."
        }
        resultCount={debouncedQuery ? data?.itemsTotal : undefined}
        showCollapsedFrame={false}
        collapsedSize={28}
        triggerClassName="rounded-sm"
        className="pointer-events-none absolute right-0 w-56"
      />

      {isOpen && debouncedQuery.length > 0 && (
        <div className="absolute top-full right-0 z-50 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {isPending && (
            <div className="flex items-center justify-center py-6">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          )}
          {data && data.data.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No results found
            </div>
          )}
          {data?.data.map((msg) => (
            <button
              key={msg.id}
              type="button"
              className="w-full border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent last:border-b-0"
              onClick={() => handleResultClick(msg)}
            >
              <div className="flex items-center gap-1.5">
                <Avatar size="sm">
                  {msg.author.image && (
                    <AvatarImage src={msg.author.image} alt={msg.author.name} />
                  )}
                  <AvatarFallback
                    avatarColor={
                      "avatarColor" in msg.author
                        ? typeof msg.author.avatarColor === "string"
                          ? msg.author.avatarColor
                          : null
                        : null
                    }
                    className="text-[8px] font-semibold"
                    fallbackSeed={msg.author.name}
                  >
                    {getAvatarInitials(msg.author.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] font-semibold">
                  {msg.author.displayUsername ?? msg.author.name}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {formatTime(msg.createdAt)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {toSearchPreviewText(msg.content, msg.mentions ?? [])}
              </div>
            </button>
          ))}
          {data && data.itemsTotal > data.data.length && (
            <div className="py-1.5 text-center text-[10px] text-muted-foreground">
              {data.itemsTotal} results — showing first {data.data.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
