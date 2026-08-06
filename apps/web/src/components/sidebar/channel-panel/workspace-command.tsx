import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@repo/ui/components/command"
import { Kbd } from "@repo/ui/components/unlumen-ui/kbd"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { Loader2, Monitor, Moon, Search, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useRef, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
import { apiClient } from "@/lib/api-client"

type SearchResult = {
  id: string
  content: string
  channelId: string
  channelName: string
  threadRootId: string | null
  author: {
    displayUsername: string | null
    name: string
  }
  mentions: Array<{
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

export function WorkspaceCommand() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigateToWorkspaceMessage = useMessageSearchNavigation()
  const { setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    if (!query.trim()) {
      setDebouncedQuery("")
      return
    }
    debounceTimer.current = setTimeout(
      () => setDebouncedQuery(query.trim()),
      250
    )
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [query])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
    }
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const { data, isFetching } = useQuery({
    queryKey: ["workspace-search", workspaceSlug, debouncedQuery],
    queryFn: async (): Promise<SearchResponse> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].search.$get({
        param: { workspaceSlug: workspaceSlug as string },
        query: { query: debouncedQuery },
      })
      if (!res.ok) throw new Error("Search failed")
      return res.json()
    },
    enabled: open && debouncedQuery.length > 0 && !!workspaceSlug,
  })

  const goToMessage = useCallback(
    (message: SearchResult) => {
      setOpen(false)
      navigateToWorkspaceMessage({
        id: message.id,
        channelId: message.channelId,
        threadRootId: message.threadRootId,
      })
    },
    [navigateToWorkspaceMessage]
  )

  const runTheme = useCallback(
    (value: "light" | "dark" | "system") => {
      setOpen(false)
      setTheme(value)
    },
    [setTheme]
  )

  const hasQuery = debouncedQuery.length > 0
  const results = data?.data ?? []
  const showResults = hasQuery && !isFetching && results.length > 0
  const showEmpty = hasQuery && !isFetching && results.length === 0
  const showLoader = hasQuery && isFetching

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">Search...</span>
        <Kbd size="sm" className="shrink-0 px-1.5 font-sans tracking-wide">
          ⌘K
        </Kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup aria-label="Search messages or run a command">
          <Command mode="none" value={query} onValueChange={setQuery}>
            <CommandInput placeholder="Search messages, run commands…" />
            <CommandPanel>
              <CommandList className="max-h-[420px]">
                {showLoader && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Searching…
                  </div>
                )}

                {showEmpty && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No messages found for “{debouncedQuery}”.
                  </div>
                )}

                {showResults && (
                  <CommandGroup>
                    <CommandGroupLabel>Messages</CommandGroupLabel>
                    {results.map((msg) => (
                      <CommandItem
                        key={msg.id}
                        value={msg.id}
                        onClick={() => goToMessage(msg)}
                        className="items-start"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-medium text-foreground">
                              #{msg.channelName}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="truncate text-muted-foreground">
                              {msg.author.displayUsername ?? msg.author.name}
                            </span>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            <MessageMarkdown
                              content={msg.content}
                              mentions={msg.mentions}
                            />
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {!hasQuery && (
                  <CommandGroup>
                    <CommandGroupLabel>Theme</CommandGroupLabel>
                    <CommandItem
                      value="theme-light"
                      className="gap-2"
                      onClick={() => runTheme("light")}
                    >
                      <Sun className="size-4 text-muted-foreground" />
                      <span className="flex-1">Light mode</span>
                    </CommandItem>
                    <CommandItem
                      value="theme-dark"
                      className="gap-2"
                      onClick={() => runTheme("dark")}
                    >
                      <Moon className="size-4 text-muted-foreground" />
                      <span className="flex-1">Dark mode</span>
                    </CommandItem>
                    <CommandItem
                      value="theme-system"
                      className="gap-2"
                      onClick={() => runTheme("system")}
                    >
                      <Monitor className="size-4 text-muted-foreground" />
                      <span className="flex-1">System theme</span>
                    </CommandItem>
                  </CommandGroup>
                )}

                {showResults && (
                  <>
                    <CommandSeparator />
                    <div className="py-1.5 text-center text-[10px] text-muted-foreground">
                      {data?.itemsTotal && data.itemsTotal > results.length
                        ? `${data.itemsTotal} results — showing first ${results.length}`
                        : `${results.length} result${results.length === 1 ? "" : "s"}`}
                    </div>
                  </>
                )}
              </CommandList>
            </CommandPanel>
            <CommandFooter>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5">
                    <Kbd
                      size="sm"
                      className="border-foreground/15 bg-background text-[11px] text-foreground shadow-xs"
                    >
                      ↑
                    </Kbd>
                    <Kbd
                      size="sm"
                      className="border-foreground/15 bg-background text-[11px] text-foreground shadow-xs"
                    >
                      ↓
                    </Kbd>
                  </span>
                  <span>Navigate</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd
                    size="sm"
                    className="border-foreground/15 bg-background text-[11px] text-foreground shadow-xs"
                  >
                    ↵
                  </Kbd>
                  <span>Open</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Kbd
                  size="sm"
                  className="border-foreground/15 bg-background text-[11px] text-foreground shadow-xs"
                >
                  Esc
                </Kbd>
                <span>Close</span>
              </div>
            </CommandFooter>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  )
}
