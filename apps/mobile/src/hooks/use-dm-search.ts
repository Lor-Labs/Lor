import { useInfiniteQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import type { DMSearchResult } from "@/lib/api-types"

const SEARCH_DEBOUNCE_MS = 280
const SEARCH_PAGE_SIZE = 30

export function useDMSearch({ query }: { query: string }) {
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

  const enabled = Boolean(debouncedQuery)
  const search = useInfiniteQuery({
    queryKey: ["dm-search", debouncedQuery],
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const response = await api.v1.dms.search.$get({
        query: {
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
    const seen = new Set<string>()
    const merged: DMSearchResult[] = []
    for (const page of search.data?.pages ?? []) {
      for (const result of page.data) {
        if (seen.has(result.id)) continue
        seen.add(result.id)
        merged.push(result)
      }
    }
    return merged
  }, [search.data])

  const lastPage = search.data?.pages.at(-1)
  const itemsTotal = lastPage?.itemsTotal ?? 0

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
    error: search.error?.message ?? null,
    isDebouncing,
    isLoading: enabled && search.isPending,
    isLoadingMore: search.isFetchingNextPage,
    itemsTotal,
    loadMore,
    results,
    retry,
  }
}
