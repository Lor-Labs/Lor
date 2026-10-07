import { queryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export function channelQueryOptions(workspaceSlug: string, channelId: string) {
  return queryOptions({
    queryKey: ["channel", workspaceSlug, channelId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: { workspaceSlug, channelId },
      })
      if (!res.ok) throw new Error("Failed to fetch channel")
      return res.json()
    },
  })
}
