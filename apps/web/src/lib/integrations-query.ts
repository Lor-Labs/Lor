import { queryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export function integrationsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: ["integrations", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load connectors")
      return res.json()
    },
    // Connections change outside this window (OAuth runs in the browser).
    staleTime: 0,
  })
}
