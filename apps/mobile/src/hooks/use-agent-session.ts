import { useQuery } from "@tanstack/react-query"
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
