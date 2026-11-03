import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { type RefObject, useEffect, useRef, useState } from "react"
import { LinearStatusIcon } from "@/components/voice/linear-issue-icons"
import { apiClient } from "@/lib/api-client"
import { connectorLogo } from "@/lib/connector-ui"
import { formatLinearIssueBlock } from "@/lib/linear-issue-block"

const SEARCH_DEBOUNCE_MS = 200
const ISSUES_STALE_MS = 30 * 1000
// Fetch the next page this close to the bottom, so scrolling rarely waits.
const LOAD_MORE_THRESHOLD_PX = 120
const LISTBOX_ID = "linear-issue-listbox"
const optionId = (index: number) => `${LISTBOX_ID}-option-${index}`
const LinearLogo = connectorLogo("linear")

type Scope = "mine" | "all"

const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: "mine", label: "My issues" },
  { id: "all", label: "All" },
]

interface LinearIssuePickerProps {
  workspaceSlug: string
  channelId: string
  inputRef: RefObject<HTMLInputElement | null>
  onBack: () => void
  // The issue as a Copy as prompt block (linear-issue-block.ts).
  onPick: (block: string) => void
}

// Composer Linear issue picker: browse my open issues or all of them, search,
// and scroll for more. A pick is inserted as the same issue card as a paste.
export function LinearIssuePicker({
  workspaceSlug,
  channelId,
  inputRef,
  onBack,
  onPick,
}: LinearIssuePickerProps) {
  const [scope, setScope] = useState<Scope>("mine")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pickingId, setPickingId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // A pick that resolves after the menu closed must not insert anything.
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [inputRef])

  const param = { workspaceSlug, channelId }
  const {
    data,
    error,
    isFetching,
    isFetchingNextPage,
    isPlaceholderData,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "linear-picker-issues",
      workspaceSlug,
      channelId,
      scope,
      debouncedQuery,
    ],
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors.linear.issues.$get({
        param,
        query: {
          scope,
          q: debouncedQuery || undefined,
          cursor: pageParam ?? undefined,
        },
      })
      if (!res.ok) throw new Error("Couldn't reach Linear")
      return res.json()
    },
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: ISSUES_STALE_MS,
    placeholderData: keepPreviousData,
    retry: 1,
  })
  const issues = data?.pages.flatMap((page) => page.issues) ?? []

  const listKey = `${scope}:${debouncedQuery}`
  useEffect(() => {
    setSelectedIndex(0)
    listRef.current?.scrollTo({ top: 0 })
  }, [listKey])

  const loadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage({ cancelRefetch: false })
    }
  }

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight
    if (remaining < LOAD_MORE_THRESHOLD_PX) loadMore()
  }

  const moveSelection = (index: number) => {
    setSelectedIndex(index)
    if (index >= issues.length - 3) loadMore()
    requestAnimationFrame(() =>
      document
        .getElementById(optionId(index))
        ?.scrollIntoView({ block: "nearest" })
    )
  }

  const pick = async (issueId: string) => {
    if (pickingId) return
    setPickingId(issueId)
    try {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].connectors.linear.issues[":issueId"].$get({
        param: { ...param, issueId },
      })
      if (!res.ok) throw new Error("Couldn't load the issue")
      const issue = await res.json()
      if (mountedRef.current) onPick(formatLinearIssueBlock(issue))
    } catch {
      if (!mountedRef.current) return
      toast.error("Couldn't load that issue from Linear")
      setPickingId(null)
    }
  }

  const changeScope = (next: Scope) => {
    setScope(next)
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter and arrows belong to the IME while it composes.
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown" && issues.length > 0) {
      event.preventDefault()
      const next = selectedIndex + 1
      // At the end with more to load, wait for the next page instead of wrapping.
      moveSelection(
        next < issues.length ? next : hasNextPage ? selectedIndex : 0
      )
      return
    }
    if (event.key === "ArrowUp" && issues.length > 0) {
      event.preventDefault()
      moveSelection((selectedIndex + issues.length - 1) % issues.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      // The rows still belong to the previous search until this one lands.
      if (query !== debouncedQuery || isPlaceholderData) return
      const issue = issues[selectedIndex]
      if (issue) void pick(issue.id)
      return
    }
    if (event.key === "Backspace" && query.length === 0) {
      event.preventDefault()
      onBack()
    }
  }

  const emptyState = error ? (
    "Couldn't reach Linear. Check its connection in workspace settings."
  ) : isFetching ? (
    "Loading…"
  ) : scope === "mine" ? (
    <>
      {debouncedQuery
        ? "None of your open issues match."
        : "No open issues assigned to you."}{" "}
      <button
        type="button"
        className="text-foreground underline-offset-2 hover:underline"
        onClick={() => changeScope("all")}
      >
        {debouncedQuery ? "Search all issues" : "Show all issues"}
      </button>
    </>
  ) : (
    "No issues found"
  )

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Back"
        >
          <HugeiconsIcon
            icon={ArrowLeft01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </button>
        <LinearLogo className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">Linear</span>
        {isFetching && <Spinner className="size-3.5 shrink-0" />}
        <div className="ml-auto flex shrink-0 rounded-md bg-muted p-0.5">
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={scope === option.id}
              onClick={() => changeScope(option.id)}
              className={cn(
                "rounded px-2 py-0.5 text-xs",
                scope === option.id
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          scope === "mine" ? "Search my issues…" : "Search all issues…"
        }
        role="combobox"
        aria-expanded={issues.length > 0}
        aria-controls={LISTBOX_ID}
        aria-activedescendant={
          issues[selectedIndex] ? optionId(selectedIndex) : undefined
        }
        className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <div
        id={LISTBOX_ID}
        ref={listRef}
        role="listbox"
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto"
      >
        {issues.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {emptyState}
          </div>
        ) : (
          issues.map((issue, index) => (
            <button
              key={issue.id}
              id={optionId(index)}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/70"
              )}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => void pick(issue.id)}
            >
              <span
                className="mt-[3px] flex shrink-0"
                title={issue.status ?? undefined}
              >
                {pickingId === issue.id ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <LinearStatusIcon state={issue.state} />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{issue.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    issue.identifier,
                    issue.status,
                    scope === "all" ? (issue.assignee ?? "Unassigned") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </button>
          ))
        )}
        {isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <Spinner className="size-3.5" />
          </div>
        )}
      </div>
    </div>
  )
}
