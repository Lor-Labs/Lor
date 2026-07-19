import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import { api } from "@/lib/api"
import type { Message } from "@/lib/api-types"

export function usePinnedMessages({
  channelId,
  enabled,
  workspaceSlug,
}: {
  channelId: string
  enabled: boolean
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const active = Boolean(enabled && workspaceSlug && channelId)
  const query = useQuery({
    queryKey: ["pinned-messages", workspaceSlug, channelId],
    enabled: active,
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].pins.$get({ param: { workspaceSlug, channelId } })
      if (!response.ok) throw new Error("Could not load pinned messages")
      const payload = await response.json()
      return payload.data
    },
  })
  const { refetch } = query

  const reload = useCallback(async () => {
    await refetch()
  }, [refetch])

  const remove = useCallback(
    (messageId: string) => {
      queryClient.setQueryData<Message[]>(
        ["pinned-messages", workspaceSlug, channelId],
        (current) => current?.filter((message) => message.id !== messageId)
      )
    },
    [channelId, queryClient, workspaceSlug]
  )

  return {
    messages: query.data ?? [],
    isLoading: active && query.isPending,
    error: query.error?.message ?? null,
    reload,
    remove,
  }
}
