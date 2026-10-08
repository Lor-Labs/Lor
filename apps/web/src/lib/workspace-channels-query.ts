import { queryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { ListChannelsResponse } from "@/lib/api-types"

export function workspaceChannelsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: ["channels", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels.$get(
        { param: { workspaceSlug } }
      )
      if (!res.ok) {
        throw new Error("Failed to fetch channels")
      }
      return res.json()
    },
    enabled: !!workspaceSlug,
  })
}

// Where to land someone who has no remembered channel in this workspace.
export function firstTextChannelId(
  channels: ListChannelsResponse
): string | null {
  const ordered = [
    ...channels.uncategorized,
    ...channels.categories.flatMap((category) => category.channels),
  ]
  return (
    ordered.find((channel) => channel.type === "text" && !channel.archivedAt)
      ?.id ?? null
  )
}
