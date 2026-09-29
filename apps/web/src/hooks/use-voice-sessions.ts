import { useInfiniteQuery } from "@tanstack/react-query"
import { useInvalidateOnVoiceUpdate } from "@/hooks/use-voice-presence"
import { apiClient } from "@/lib/api-client"

export function voiceSessionsQueryKey(channelId: string) {
  return ["voice-sessions", channelId] as const
}

// Session history for a voice channel, newest first, including the live
// session. Joins, leaves, and session ends refetch it.
export function useVoiceSessions(
  channelId: string,
  workspaceId: string | undefined
) {
  useInvalidateOnVoiceUpdate("voice-sessions", channelId, workspaceId)
  return useInfiniteQuery({
    queryKey: voiceSessionsQueryKey(channelId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.v1.channels[":channelId"].voice.sessions.$get(
        {
          param: { channelId },
          query: pageParam ? { before: pageParam } : {},
        }
      )
      if (!res.ok) throw new Error("Failed to load sessions")
      return res.json()
    },
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
  })
}

export type VoiceSessionSummary = NonNullable<
  ReturnType<typeof useVoiceSessions>["data"]
>["pages"][number]["sessions"][number]
