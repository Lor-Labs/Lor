import type { ThreadReadUpdated } from "@repo/realtime-types"
import {
  type InfiniteData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { useRealtimeRoom } from "@/hooks/use-realtime-room"
import { useInvalidateOnVoiceUpdate } from "@/hooks/use-voice-presence"
import { apiClient } from "@/lib/api-client"

export function voiceSessionsQueryKey(channelId: string) {
  return ["voice-sessions", channelId] as const
}

async function fetchSessionsPage(
  channelId: string,
  before: string | undefined
) {
  const res = await apiClient.v1.channels[":channelId"].voice.sessions.$get({
    param: { channelId },
    query: before ? { before } : {},
  })
  if (!res.ok) throw new Error("Failed to load sessions")
  return res.json()
}

type SessionsPage = Awaited<ReturnType<typeof fetchSessionsPage>>
export type VoiceSessionSummary = SessionsPage["sessions"][number]

// Session history for a voice channel, newest first, including the live
// session. Joins, leaves, and session ends refetch it; so do replies to past
// session chats, which reach the channel room as thread summaries.
export function useVoiceSessions(
  channelId: string,
  workspaceId: string | undefined
) {
  useInvalidateOnVoiceUpdate("voice-sessions", channelId, workspaceId)
  const socket = useSocket()
  const queryClient = useQueryClient()
  useRealtimeRoom(socket, "channel", channelId)

  useEffect(() => {
    if (!socket) return
    const queryKey = voiceSessionsQueryKey(channelId)
    const onThreadUpdated = (payload: { channelId: string }) => {
      if (payload.channelId === channelId) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }
    // Reading a session chat on any device clears its history badges.
    const onThreadRead = (payload: ThreadReadUpdated) => {
      if (payload.channelId !== channelId) return
      queryClient.setQueryData<InfiniteData<SessionsPage>>(queryKey, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                sessions: page.sessions.map((session) =>
                  session.threadRootId === payload.threadRootId
                    ? { ...session, unreadCount: 0, mentionCount: 0 }
                    : session
                ),
              })),
            }
          : data
      )
    }
    socket.on("message:thread:updated", onThreadUpdated)
    socket.on("thread-read:updated", onThreadRead)
    return () => {
      socket.off("message:thread:updated", onThreadUpdated)
      socket.off("thread-read:updated", onThreadRead)
    }
  }, [socket, channelId, queryClient])

  return useInfiniteQuery({
    queryKey: voiceSessionsQueryKey(channelId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchSessionsPage(channelId, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
  })
}
