import type {
  AgentSessionUpdatedEvent,
  RealtimeAgentSession,
} from "@repo/realtime-types"
import { toast } from "@repo/ui/components/toast"
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

export function agentSessionQueryOptions(sessionId: string) {
  return {
    queryKey: ["agent-session", sessionId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].$get({
        param: { sessionId },
      })
      if (!res.ok) throw new Error("Session not found")
      return res.json()
    },
  }
}

export function useAgentSession(sessionId: string) {
  return useQuery(agentSessionQueryOptions(sessionId))
}

export type AgentSessionDetail = NonNullable<
  ReturnType<typeof useAgentSession>["data"]
>

function patchSessionCache(
  queryClient: QueryClient,
  sessionId: string,
  patch: Partial<RealtimeAgentSession>
) {
  queryClient.setQueryData<AgentSessionDetail>(
    agentSessionQueryOptions(sessionId).queryKey,
    (detail) =>
      detail ? { ...detail, session: { ...detail.session, ...patch } } : detail
  )
}

// Renames and archives from anyone (title, archive notice) land live.
export function useAgentSessionUpdates(sessionId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUpdated = ({ session }: AgentSessionUpdatedEvent) => {
      if (session.id === sessionId) {
        patchSessionCache(queryClient, sessionId, session)
      }
    }
    socket.on("session:updated", onUpdated)
    return () => {
      socket.off("session:updated", onUpdated)
    }
  }, [socket, queryClient, sessionId])
}

export function useUpdateAgentSession(sessionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { title?: string; archived?: boolean }) => {
      const res = await apiClient.v1.sessions[":sessionId"].$patch({
        param: { sessionId },
        json: body,
      })
      if (!res.ok) throw new Error("Couldn't update the session")
      return res.json()
    },
    // A rename shows at once; archive waits for the server.
    onMutate: ({ title }) => {
      const previous = queryClient.getQueryData<AgentSessionDetail>(
        agentSessionQueryOptions(sessionId).queryKey
      )
      if (title !== undefined)
        patchSessionCache(queryClient, sessionId, { title })
      return { previous }
    },
    onSuccess: ({ session }) =>
      patchSessionCache(queryClient, sessionId, session),
    onError: (err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          agentSessionQueryOptions(sessionId).queryKey,
          context.previous
        )
      }
      toast.error(err.message)
    },
  })
}
