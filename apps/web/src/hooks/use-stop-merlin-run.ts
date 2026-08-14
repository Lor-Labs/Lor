import { toast } from "@repo/ui/components/toast"
import type { InfiniteData } from "@tanstack/react-query"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { messagesCacheKey } from "@/hooks/use-merlin-stream"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"

type StopMerlinTarget = Pick<Message, "id" | "channelId" | "threadRootId">

export function useStopMerlinRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (target: StopMerlinTarget) => {
      const res = await apiClient.v1.runs["by-message"][
        ":messageId"
      ].stop.$post({ param: { messageId: target.id } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't stop Merlin")
      }
    },
    onSuccess: (_data, target) => {
      queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(
        messagesCacheKey(target.channelId, target.threadRootId),
        (old) =>
          old
            ? updateMessagesAcrossPages(old, (messages) =>
                messages.map((message) =>
                  message.id === target.id
                    ? { ...message, stopRequested: true }
                    : message
                )
              )
            : old
      )
    },
    onError: (error) => toast.error(error.message),
  })
}
