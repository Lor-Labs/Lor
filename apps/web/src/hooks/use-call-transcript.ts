import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import { apiClient } from "@/lib/api-client"

const PAGE_SIZE = "500"

async function fetchTranscriptPage(
  sessionId: string,
  after: string | undefined
) {
  const res = await apiClient.v1.voice.sessions[":sessionId"].transcript.$get({
    param: { sessionId },
    query: after ? { after, limit: PAGE_SIZE } : { limit: PAGE_SIZE },
  })
  if (!res.ok) throw new Error("Failed to load transcript")
  return res.json()
}

export type TranscriptPage = Awaited<ReturnType<typeof fetchTranscriptPage>>

// The whole saved transcript, loaded page by page. A live call refetches on
// every open: captions only cover what this device heard.
export function useCallTranscript(sessionId: string, live: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["voice-transcript", sessionId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchTranscriptPage(sessionId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextAfter ?? undefined,
    refetchOnMount: live ? "always" : true,
  })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  return query
}
