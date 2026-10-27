import { visibleChannels } from "@repo/utils/features"
import { queryOptions } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { ChannelList } from "@/lib/api-types"

export function workspaceChannelsQueryOptions(workspaceSlug: string) {
  return queryOptions({
    queryKey: ["channels", workspaceSlug],
    select: (data) => visibleChannels(data),
    enabled: Boolean(workspaceSlug),
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].channels.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load channels")
      return response.json()
    },
  })
}

// Channels a session can start in: text, not archived.
export function openTextChannels(channels: ChannelList) {
  return [
    ...channels.uncategorized,
    ...channels.categories.flatMap((category) => category.channels),
  ].filter((channel) => channel.type === "text" && !channel.archivedAt)
}
