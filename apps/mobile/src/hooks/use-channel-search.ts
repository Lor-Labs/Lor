import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import type { ChannelSearchResult } from "@/lib/api-types"
import { mergeChannelSearchResults } from "@/lib/channel-search"

const SEARCH_DEBOUNCE_MS = 280
const SEARCH_PAGE_SIZE = 30

export function useChannelSearch({
  channelId,
  query,
  workspaceSlug,
}: {
  channelId: string
  query: string
  workspaceSlug: string
}) {
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [results, setResults] = useState<ChannelSearchResult[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [isDebouncing, setIsDebouncing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    const normalized = query.trim()
    requestRef.current += 1

    if (!normalized) {
      setDebouncedQuery("")
      setResults([])
      setItemsTotal(0)
      setNextPage(null)
      setError(null)
      setIsDebouncing(false)
      setIsLoading(false)
      setIsLoadingMore(false)
      return
    }

    setIsDebouncing(true)
    const timeout = setTimeout(() => {
      setDebouncedQuery(normalized)
      setIsDebouncing(false)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [query])

  const fetchPage = useCallback(
    async (page: number, replace: boolean) => {
      if (!workspaceSlug || !channelId || !debouncedQuery) return

      const requestId = replace ? ++requestRef.current : requestRef.current
      if (replace) {
        setIsLoading(true)
        setError(null)
      } else {
        setIsLoadingMore(true)
      }

      try {
        const response = await api.v1.workspaces[":workspaceSlug"].search.$get({
          param: { workspaceSlug },
          query: {
            channelId,
            page: String(page),
            perPage: String(SEARCH_PAGE_SIZE),
            query: debouncedQuery,
          },
        })
        if (!response.ok) throw new Error("Could not search this channel")
        const payload = await response.json()
        if (requestId !== requestRef.current) return

        setResults((current) =>
          mergeChannelSearchResults(replace ? [] : current, payload.data)
        )
        setItemsTotal(payload.itemsTotal)
        setNextPage(payload.nextPage)
        setError(null)
      } catch (cause) {
        if (requestId !== requestRef.current) return
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not search this channel"
        )
      } finally {
        if (requestId === requestRef.current) {
          setIsLoading(false)
          setIsLoadingMore(false)
        }
      }
    },
    [channelId, debouncedQuery, workspaceSlug]
  )

  useEffect(() => {
    if (!debouncedQuery) return
    setResults([])
    setItemsTotal(0)
    setNextPage(null)
    void fetchPage(1, true)
  }, [debouncedQuery, fetchPage])

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || nextPage == null) return
    void fetchPage(nextPage, false)
  }, [fetchPage, isLoading, isLoadingMore, nextPage])

  const retry = useCallback(() => {
    if (!debouncedQuery) return
    if (results.length > 0 && nextPage != null) {
      void fetchPage(nextPage, false)
      return
    }
    void fetchPage(1, true)
  }, [debouncedQuery, fetchPage, nextPage, results.length])

  return {
    debouncedQuery,
    error,
    isDebouncing,
    isLoading,
    isLoadingMore,
    itemsTotal,
    loadMore,
    results,
    retry,
  }
}
