import { useInfiniteQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import type { ChannelSearchResult } from "@/lib/api-types"
import { mergeChannelSearchResults } from "@/lib/channel-search"

const SEARCH_DEBOUNCE_MS = 280
const SEARCH_PAGE_SIZE = 30

export function useMessageSearch({
  channelId,
  query,
  workspaceSlug,
}: {
  channelId?: string
  query: string
  workspaceSlug: string
}) {
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [isDebouncing, setIsDebouncing] = useState(false)

  useEffect(() => {
    const normalized = query.trim()
    if (!normalized) {
      setDebouncedQuery("")
      setIsDebouncing(false)
      return
    }

    setIsDebouncing(true)
    const timeout = setTimeout(() => {
      setDebouncedQuery(normalized)
      setIsDebouncing(false)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [query])

  const enabled = Boolean(workspaceSlug && debouncedQuery)
  const search = useInfiniteQuery({
    queryKey: [
      "message-search",
      workspaceSlug,
      channelId ?? null,
      debouncedQuery,
    ],
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const response = await api.v1.workspaces[":workspaceSlug"].search.$get({
        param: { workspaceSlug },
        query: {
          ...(channelId ? { channelId } : {}),
          page: String(pageParam),
          perPage: String(SEARCH_PAGE_SIZE),
          query: debouncedQuery,
        },
      })
      if (!response.ok) throw new Error("Could not search messages")
      return response.json()
    },
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  })
  const { fetchNextPage, hasNextPage, isFetching, refetch } = search

  const results = useMemo(() => {
    const pages = search.data?.pages ?? []
    return pages.reduce<ChannelSearchResult[]>(
      (merged, page) => mergeChannelSearchResults(merged, page.data),
      []
    )
  }, [search.data])

  const lastPage = search.data?.pages.at(-1)
  const itemsTotal = lastPage?.itemsTotal ?? 0
  const nextPage = lastPage?.nextPage ?? null

  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetching) return
    void fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetching])

  const retry = useCallback(() => {
    if (!enabled) return
    if (results.length > 0 && hasNextPage) {
      void fetchNextPage()
      return
    }
    void refetch()
  }, [enabled, fetchNextPage, hasNextPage, refetch, results.length])

  return {
    debouncedQuery,
    error: search.error?.message ?? null,
    isDebouncing,
    isLoading: enabled && search.isPending,
    isLoadingMore: search.isFetchingNextPage,
    itemsTotal,
    loadMore,
    nextPage,
    results,
    retry,
  }
}
