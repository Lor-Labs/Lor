import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { type MutableRefObject, useCallback, useEffect, useMemo } from "react"
import { useRealtimeRoom } from "@/hooks/use-realtime-room"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { preserveMessageStream } from "@/lib/message-cache-utils"
import { realtimeMessageToMessage } from "@/lib/realtime-adapter"
import type { AppSocket } from "@/lib/socket"

export type ThreadPageParam =
  | { around: string }
  | { before: string }
  | { after: string }
  | null

export type ThreadPage = {
  data: Message[]
  beforeCursor: string | null
  afterCursor: string | null
  reachedOldest: boolean
  reachedNewest: boolean
  // The thread root message, returned on every page so the panel can render it
  // even when it's scrolled out of the channel feed.
  root?: Message | null
  participants?: ThreadParticipant[]
  voiceSessionId?: string | null
  voiceSessionTitle?: string | null
  voiceSessionEnded?: boolean
}

export type ThreadParticipant = Pick<
  Message["author"],
  "id" | "name" | "image" | "avatarColor"
>

export type FetchPageParams = {
  around?: string
  before?: string
  after?: string
  limit: number
}

type ThreadTarget = {
  workspaceSlug: string
  channelId: string
  threadRootId: string
}

export async function fetchThreadPage(
  target: ThreadTarget,
  params: FetchPageParams
): Promise<ThreadPage> {
  const query: Record<string, string> = { limit: String(params.limit) }
  if (params.around) query.around = params.around
  if (params.before) query.before = params.before
  if (params.after) query.after = params.after
  const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
    ":channelId"
  ].messages[":messageId"].thread.$get({
    param: {
      workspaceSlug: target.workspaceSlug,
      channelId: target.channelId,
      messageId: target.threadRootId,
    },
    query,
  })
  if (!res.ok) throw new Error("Failed to fetch thread replies")
  return res.json()
}

// One way to fetch a thread for the panel, the live call (which keeps its
// chat loaded for the whole call), and hover prefetches.
export function threadQueryOptions(
  queryClient: QueryClient,
  threadRootId: string,
  fetchPage: (params: FetchPageParams) => Promise<ThreadPage>,
  perPage = 50
) {
  return infiniteQueryOptions<
    ThreadPage,
    Error,
    InfiniteData<ThreadPage, ThreadPageParam>,
    ["thread", string],
    ThreadPageParam
  >({
    queryKey: ["thread", threadRootId],
    queryFn: async ({ pageParam }) => {
      const params: FetchPageParams = { limit: perPage }
      if (pageParam) {
        if ("around" in pageParam) params.around = pageParam.around
        else if ("before" in pageParam) params.before = pageParam.before
        else if ("after" in pageParam) params.after = pageParam.after
      }
      const page = await fetchPage(params)
      const cached = queryClient.getQueryData<InfiniteData<ThreadPage>>([
        "thread",
        threadRootId,
      ])
      const byId = new Map(
        cached?.pages.flatMap((p) => p.data.map((m) => [m.id, m] as const))
      )
      return {
        ...page,
        data: page.data.map((message) =>
          preserveMessageStream(message, byId.get(message.id))
        ),
        root: page.root
          ? preserveMessageStream(
              page.root,
              cached?.pages[0]?.root ?? undefined
            )
          : page.root,
      }
    },
    initialPageParam: null,
    getNextPageParam: (lastPage) =>
      lastPage.reachedOldest || !lastPage.beforeCursor
        ? undefined
        : { before: lastPage.beforeCursor },
  })
}

// Opening a past call's chat right after hovering its row is instant.
export function prefetchThread(queryClient: QueryClient, target: ThreadTarget) {
  void queryClient.prefetchInfiniteQuery(
    threadQueryOptions(queryClient, target.threadRootId, (params) =>
      fetchThreadPage(target, params)
    )
  )
}

interface UseThreadMessagesOptions {
  channelId: string
  threadRootId: string
  fetchPage: (params: FetchPageParams) => Promise<ThreadPage>
  enabled?: boolean
  socket: AppSocket | null
  pendingNoncesRef?: MutableRefObject<Set<string>>
  perPage?: number
}

/**
 * Fetches + subscribes to a single thread's replies for the right-side panel.
 * Mirrors useChannelMessages but stripped down: no anchored mode, no pending
 * buffer — threads always show their full live tail.
 */
export function useThreadMessages({
  channelId,
  threadRootId,
  fetchPage,
  enabled = true,
  socket,
  pendingNoncesRef,
  perPage = 50,
}: UseThreadMessagesOptions) {
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    ...threadQueryOptions(queryClient, threadRootId, fetchPage, perPage),
    enabled,
  })

  useRealtimeRoom(socket, "channel", enabled ? channelId : undefined)
  useRealtimeRoom(socket, "thread", enabled ? threadRootId : undefined)

  // Subscribe to live replies in this thread.
  useEffect(() => {
    if (!socket) return

    const handleMessageCreated = (
      message: Parameters<typeof realtimeMessageToMessage>[0]
    ) => {
      if (message.channelId !== channelId) return
      if (message.threadRootId !== threadRootId) return
      if (message.nonce && pendingNoncesRef?.current.has(message.nonce)) return

      const adapted = realtimeMessageToMessage(message)
      queryClient.setQueryData<InfiniteData<ThreadPage, ThreadPageParam>>(
        ["thread", threadRootId],
        (old) => {
          if (!old) return old
          // Also skips the echo of a send still shown as its optimistic
          // entry (id = nonce): the sender's hook swaps that in place. The
          // call's copy of this hook has no pending-nonce ref, so it relies
          // on this.
          const exists = old.pages.some((page) =>
            page.data.some(
              (m) =>
                m.id === adapted.id || (message.nonce && m.id === message.nonce)
            )
          )
          if (exists) return old
          return {
            ...old,
            pages: old.pages.map((page, i) =>
              i === 0
                ? {
                    ...page,
                    data: [adapted, ...page.data],
                    afterCursor: adapted.id,
                  }
                : page
            ),
          }
        }
      )
    }

    socket.on("message:created", handleMessageCreated)
    return () => {
      socket.off("message:created", handleMessageCreated)
    }
  }, [socket, channelId, threadRootId, queryClient, pendingNoncesRef])

  // Dedupe by id to guard against the same reply landing in two pages (e.g. a
  // page refetch racing a live insert), mirroring the channel feed.
  const messages = useMemo(() => {
    const seen = new Set<string>()
    const deduped: Message[] = []
    for (const page of query.data?.pages ?? []) {
      for (const m of page.data) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        deduped.push(m)
      }
    }
    return deduped.sort((a, b) => {
      const timeDifference =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return timeDifference || b.id.localeCompare(a.id)
    })
  }, [query.data])

  // pages[0] is the initial (newest) page; older pages append after it.
  const root = query.data?.pages[0]?.root ?? null

  const participants = useMemo(() => {
    const byId = new Map<string, ThreadParticipant>()
    for (const participant of query.data?.pages[0]?.participants ?? []) {
      byId.set(participant.id, participant)
    }
    if (root) byId.set(root.author.id, root.author)
    for (const message of messages) {
      byId.set(message.author.id, message.author)
    }
    return [...byId.values()]
  }, [messages, query.data, root])

  const fetchOlder = useCallback(() => query.fetchNextPage(), [query])

  const ensureMessage = useCallback(
    async (messageId: string) => {
      const cached = queryClient.getQueryData<
        InfiniteData<ThreadPage, ThreadPageParam>
      >(["thread", threadRootId])
      if (
        cached?.pages.some((page) =>
          page.data.some((message) => message.id === messageId)
        )
      ) {
        return true
      }

      const page = await fetchPage({ around: messageId, limit: perPage })
      if (!page.data.some((message) => message.id === messageId)) return false

      queryClient.setQueryData<InfiniteData<ThreadPage, ThreadPageParam>>(
        ["thread", threadRootId],
        (old) => {
          if (!old) return old
          if (
            old.pages.some((existingPage) =>
              existingPage.data.some((message) => message.id === messageId)
            )
          ) {
            return old
          }
          const existingIds = new Set(
            old.pages.flatMap((existingPage) =>
              existingPage.data.map((message) => message.id)
            )
          )
          const contextMessages = page.data.filter(
            (message) => !existingIds.has(message.id)
          )
          if (contextMessages.length === 0) return old
          return {
            ...old,
            pages: old.pages.map((existingPage, index) =>
              index === 0
                ? {
                    ...existingPage,
                    data: [...existingPage.data, ...contextMessages],
                  }
                : existingPage
            ),
          }
        }
      )
      return true
    },
    [fetchPage, perPage, queryClient, threadRootId]
  )

  return {
    messages,
    root,
    participants,
    voiceSessionId: query.data?.pages[0]?.voiceSessionId ?? null,
    voiceSessionTitle: query.data?.pages[0]?.voiceSessionTitle ?? null,
    voiceSessionEnded: query.data?.pages[0]?.voiceSessionEnded ?? false,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    fetchOlder,
    hasOlder: query.hasNextPage,
    isFetchingOlder: query.isFetchingNextPage,
    ensureMessage,
  }
}
