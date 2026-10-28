import { useQuery } from "@tanstack/react-query"
import type { SessionHarness } from "@/components/session/harness-picker"
import { apiClient } from "@/lib/api-client"

// A harness's models for the composer's picker, with each model's effort
// levels and fast mode, read from the harness's own catalog on the server.

export const agentModelsKey = (harness: SessionHarness) =>
  ["agent-models", harness] as const

export function useAgentModels(harness: SessionHarness, enabled = true) {
  return useQuery({
    queryKey: agentModelsKey(harness),
    queryFn: async () => {
      const res = await apiClient.v1["agent-models"].$get({
        query: { harness },
      })
      if (!res.ok) throw new Error("Failed to load models")
      return res.json()
    },
    enabled,
    // The catalog changes with a deploy, or after a turn reports the
    // person's own Claude Code models.
    staleTime: 10 * 60 * 1000,
  })
}

export type AgentModels = NonNullable<ReturnType<typeof useAgentModels>["data"]>
export type AgentModelOption = AgentModels["models"][number]
