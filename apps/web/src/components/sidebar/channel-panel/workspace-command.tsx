import {
  BubbleChatIcon,
  ComputerIcon,
  Moon02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  Sun01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
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
import { Spinner } from "@repo/ui/components/spinner"
import { Kbd } from "@repo/ui/components/unlumen-ui/kbd"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useRef, useState } from "react"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { ChatAvatar } from "@/components/sidebar/chat-panel/chat-avatar"
import { useAgentsById } from "@/hooks/use-agents"
import { useChats } from "@/hooks/use-chats"
import { useMessageSearchNavigation } from "@/hooks/use-message-search-navigation"
import { useOpenNewSession } from "@/hooks/use-open-new-session"
import { apiClient } from "@/lib/api-client"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

type SearchResult = {
  id: string
  content: string
  channelId: string
  channelName: string
  threadRootId: string | null
  sessionId: string | null
  sessionTitle: string | null
  author: {
    name: string
  }
  mentions: Array<{
    id: string
    name: string
    image: string | null
  }>
}

type SessionResult = {
  id: string
  title: string
  channelName: string
  archived: boolean
}

type SearchResponse = {
  itemsTotal: number
  data: SearchResult[]
  sessions: SessionResult[]
}

// How many chats the person is not in the search lists at once.
const OTHER_CHATS_SHOWN = 8

export function WorkspaceCommand() {
  const { workspaceSlug } = useParams({ strict: false })
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const navigate = useNavigate()
  const navigateToWorkspaceMessage = useMessageSearchNavigation()
  const openNewSession = useOpenNewSession()
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
      // A composer with a selection takes Cmd+K for links (composer-keymap.ts).
      if (e.defaultPrevented) return
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
        sessionId: message.sessionId,
      })
    },
    [navigateToWorkspaceMessage]
  )

  const goToSession = useCallback(
    (sessionId: string) => {
      if (!workspaceSlug) return
      setOpen(false)
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId },
      })
    },
    [navigate, workspaceSlug]
  )

  const runTheme = useCallback(
    (value: "light" | "dark" | "system") => {
      setOpen(false)
      setTheme(value)
    },
    [setTheme]
  )

  // Chats are matched here, by name, as the person types: the ones in
  // their list, and every other chat they can see, which they find and join
  // from here (reference/agents-and-chats.md, decision 35).
  const agentsById = useAgentsById(workspaceSlug)
  const { data: channelList } = useQuery({
    ...workspaceChannelsQueryOptions(workspaceSlug ?? ""),
    enabled: open && !!workspaceSlug,
  })
  const { data: myChats } = useChats(open ? workspaceSlug : undefined)
  const mine = new Map((myChats ?? []).map((chat) => [chat.id, chat]))
  const needle = query.trim().toLowerCase()
  const allChats = (channelList ? openTextChannels(channelList) : []).filter(
    (chat) => !needle || (chat.name ?? "").toLowerCase().includes(needle)
  )
  const yourChats = needle ? allChats.filter((chat) => mine.has(chat.id)) : []
  const otherChats = myChats
    ? allChats.filter((chat) => !mine.has(chat.id)).slice(0, OTHER_CHATS_SHOWN)
    : []
  const goToChat = (channelId: string) => {
    if (!workspaceSlug) return
    setOpen(false)
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId },
    })
  }
  const chatItem = (chat: (typeof allChats)[number]) => {
    const agents = chat.agentIds.flatMap((id) => agentsById.get(id) ?? [])
    const people = (mine.get(chat.id)?.people ?? []).filter(
      (person) => person.id !== me
    )
    return (
      <CommandItem
        key={chat.id}
        value={`chat-${chat.id}`}
        className="gap-2.5"
        onClick={() => goToChat(chat.id)}
      >
        {agents.length + people.length > 0 ? (
          <ChatAvatar
            agents={agents}
            people={people}
            total={agents.length + people.length}
            size={24}
          />
        ) : (
          // A chat with no agent, whose people aren't known from here.
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-muted-foreground">
            <HugeiconsIcon
              icon={BubbleChatIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{chat.name}</span>
      </CommandItem>
    )
  }

  const hasQuery = debouncedQuery.length > 0
  const results = data?.data ?? []
  const sessions = data?.sessions ?? []
  const showResults = hasQuery && !isFetching && results.length > 0
  const showSessions = hasQuery && !isFetching && sessions.length > 0
  const showEmpty =
    hasQuery &&
    !isFetching &&
    results.length === 0 &&
    sessions.length === 0 &&
    yourChats.length + otherChats.length === 0
  const showLoader = hasQuery && isFetching

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        <HugeiconsIcon
          icon={Search01Icon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
        <span className="min-w-0 flex-1 truncate text-left">Search...</span>
        <Kbd size="sm" className="shrink-0 px-1.5 font-sans tracking-wide">
          ⌘K
        </Kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup aria-label="Search chats and messages, or run a command">
          <Command mode="none" value={query} onValueChange={setQuery}>
            <CommandInput placeholder="Search chats and messages, run commands…" />
            <CommandPanel>
              <CommandList className="max-h-[420px]">
                {showLoader && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Searching…
                  </div>
                )}

                {showEmpty && (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    No results for “{debouncedQuery}”.
                  </div>
                )}

                {yourChats.length > 0 && (
                  <CommandGroup>
                    <CommandGroupLabel>Your chats</CommandGroupLabel>
                    {yourChats.map(chatItem)}
                  </CommandGroup>
                )}

                {otherChats.length > 0 && (
                  <CommandGroup>
                    <CommandGroupLabel>
                      {needle ? "Other chats" : "Chats you're not in"}
                    </CommandGroupLabel>
                    {otherChats.map(chatItem)}
                  </CommandGroup>
                )}

                {showSessions && (
                  <CommandGroup>
                    <CommandGroupLabel>Sessions</CommandGroupLabel>
                    {sessions.map((session) => (
                      <CommandItem
                        key={session.id}
                        value={`session-${session.id}`}
                        onClick={() => goToSession(session.id)}
                        className="items-start"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm text-foreground">
                            {session.title}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{session.channelName}</span>
                            {session.archived && (
                              <>
                                <span>·</span>
                                <span>Archived</span>
                              </>
                            )}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
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
                            <span className="shrink-0 font-medium text-foreground">
                              {msg.channelName}
                            </span>
                            {msg.sessionTitle && (
                              <>
                                <span className="text-muted-foreground">·</span>
                                <span className="min-w-0 truncate text-foreground">
                                  {msg.sessionTitle}
                                </span>
                              </>
                            )}
                            <span className="text-muted-foreground">·</span>
                            <span className="truncate text-muted-foreground">
                              {msg.author.name}
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

                {!hasQuery && workspaceSlug && (
                  <CommandGroup>
                    <CommandGroupLabel>Lor</CommandGroupLabel>
                    <CommandItem
                      value="new-chat"
                      className="gap-2"
                      onClick={() => {
                        setOpen(false)
                        void navigate({
                          to: "/$workspaceSlug/new",
                          params: { workspaceSlug },
                        })
                      }}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        className="size-4 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="flex-1">New chat</span>
                    </CommandItem>
                    <CommandItem
                      value="new-session"
                      className="gap-2"
                      onClick={() => {
                        setOpen(false)
                        openNewSession()
                      }}
                    >
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        className="size-4 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="flex-1">New session</span>
                    </CommandItem>
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
                      <HugeiconsIcon
                        icon={Sun01Icon}
                        className="size-4 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="flex-1">Light mode</span>
                    </CommandItem>
                    <CommandItem
                      value="theme-dark"
                      className="gap-2"
                      onClick={() => runTheme("dark")}
                    >
                      <HugeiconsIcon
                        icon={Moon02Icon}
                        className="size-4 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="flex-1">Dark mode</span>
                    </CommandItem>
                    <CommandItem
                      value="theme-system"
                      className="gap-2"
                      onClick={() => runTheme("system")}
                    >
                      <HugeiconsIcon
                        icon={ComputerIcon}
                        className="size-4 text-muted-foreground"
                        strokeWidth={2}
                      />
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
