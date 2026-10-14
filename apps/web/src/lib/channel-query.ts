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

// One page of a channel's feed: the latest, or around/before/after a message.
export async function fetchChannelMessagesPage(
  workspaceSlug: string,
  channelId: string,
  params: { around?: string; before?: string; after?: string; limit: number }
) {
  const query: Record<string, string> = { limit: String(params.limit) }
  if (params.around) query.around = params.around
  if (params.before) query.before = params.before
  if (params.after) query.after = params.after
  const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
    ":channelId"
  ].messages.$get({
    param: { workspaceSlug, channelId },
    query,
  })
  if (!res.ok) throw new Error("Failed to fetch messages")
  return res.json()
}
