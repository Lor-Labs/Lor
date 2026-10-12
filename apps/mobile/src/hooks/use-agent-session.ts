import type { AgentSessionUpdatedEvent } from "@repo/realtime-types"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"
import { api } from "@/lib/api"
import type { AgentSessionDetail } from "@/lib/api-types"

// `pending`: seeded by a session start the server hasn't confirmed yet. The
// server's copy never has it.
export type SessionDetail = AgentSessionDetail & { pending?: boolean }

export function agentSessionKey(sessionId: string) {
  return ["agent-session", sessionId] as const
}

export function useAgentSession(sessionId: string) {
  return useQuery<SessionDetail>({
    queryKey: agentSessionKey(sessionId),
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const response = await api.v1.sessions[":sessionId"].$get({
        param: { sessionId },
      })
      if (!response.ok) throw new Error("Could not load this session")
      return response.json()
    },
  })
}

// Generated titles, renames and archives from anyone land live on the open
// session (the channel room carries them).
export function useAgentSessionUpdates(sessionId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onUpdated = ({ session }: AgentSessionUpdatedEvent) => {
      if (session.id !== sessionId) return
      queryClient.setQueryData<SessionDetail>(
        agentSessionKey(sessionId),
        (detail) => (detail ? { ...detail, session } : detail)
      )
    }
    socket.on("session:updated", onUpdated)
    return () => {
      socket.off("session:updated", onUpdated)
    }
  }, [socket, queryClient, sessionId])
}
