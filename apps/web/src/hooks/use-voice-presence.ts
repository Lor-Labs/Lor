import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

const COALESCE_MS = 100
// Recovery only: workspace:voice:updated drives updates.
const POLL_MS = 60_000

export function voicePresenceQueryKey(workspaceSlug: string | undefined) {
  return ["voice-presence", workspaceSlug] as const
}

// Who is connected to each voice channel's live call, for the sidebar. Never
// includes people who only view a channel.
export function useVoicePresence(
  workspaceSlug: string | undefined,
  workspaceId: string | undefined
) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: voicePresenceQueryKey(workspaceSlug),
    enabled: Boolean(workspaceSlug),
    refetchInterval: POLL_MS,
    queryFn: async () => {
      if (!workspaceSlug) return []
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].voice.presence.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load voice presence")
      return (await res.json()).channels
    },
  })

  useEffect(() => {
    if (!socket || !workspaceSlug) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: voicePresenceQueryKey(workspaceSlug),
      })
    }
    const onUpdated = (payload: { workspaceId: string }) => {
      if (timer || (workspaceId && payload.workspaceId !== workspaceId)) return
      timer = setTimeout(() => {
        timer = undefined
        refresh()
      }, COALESCE_MS)
    }
    socket.on("workspace:voice:updated", onUpdated)
    socket.on("connect", refresh)
    return () => {
      if (timer) clearTimeout(timer)
      socket.off("workspace:voice:updated", onUpdated)
      socket.off("connect", refresh)
    }
  }, [socket, workspaceSlug, workspaceId, queryClient])

  return query.data
}

export type VoicePresenceChannel = NonNullable<
  ReturnType<typeof useVoicePresence>
>[number]
