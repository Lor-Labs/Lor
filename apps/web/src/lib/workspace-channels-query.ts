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

function openTextChannels(channels: ListChannelsResponse) {
  return [
    ...channels.uncategorized,
    ...channels.categories.flatMap((category) => category.channels),
  ].filter((channel) => channel.type === "text" && !channel.archivedAt)
}

// Where to land someone who has no remembered channel in this workspace.
export function firstTextChannelId(
  channels: ListChannelsResponse
): string | null {
  return openTextChannels(channels)[0]?.id ?? null
}

export function textChannelIdNamed(
  channels: ListChannelsResponse,
  name: string
): string | null {
  return (
    openTextChannels(channels).find((channel) => channel.name === name)?.id ??
    null
  )
}
