import { useQuery } from "@tanstack/react-query"
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
