import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { api } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"

export function channelDetailQueryOptions(
  workspaceSlug: string,
  channelId: string
) {
  return queryOptions({
    queryKey: ["channel", workspaceSlug, channelId],
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$get({
        param: { workspaceSlug, channelId },
      })
      if (!response.ok) throw new Error("Could not load this channel")
      return response.json()
    },
  })
}

export function useChannelDetail({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const queryClient = useQueryClient()
  const enabled = Boolean(workspaceSlug && channelId)
  const query = useQuery({
    ...channelDetailQueryOptions(workspaceSlug, channelId),
    enabled,
  })
  const { refetch } = query

  const reload = useCallback(async () => {
    await refetch()
  }, [refetch])

  const replaceChannel = useCallback(
    (nextChannel: ChannelDetail) => {
      if (nextChannel.id !== channelId) return
      queryClient.setQueryData(
        ["channel", workspaceSlug, channelId],
        nextChannel
      )
    },
    [channelId, queryClient, workspaceSlug]
  )

  return {
    channel: query.data ?? null,
    isLoading: enabled && query.isPending,
    error: query.data ? null : (query.error?.message ?? null),
    reload,
    replaceChannel,
  }
}
