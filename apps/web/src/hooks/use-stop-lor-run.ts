import { toast } from "@repo/ui/components/toast"
import type { InfiniteData } from "@tanstack/react-query"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { messagesCacheKey } from "@/hooks/use-lor-stream"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"

type StopLorTarget = Pick<Message, "id" | "channelId" | "threadRootId">

// Marks Lor's turn as stopping at once; a failed request clears the mark.
export function useStopLorRun() {
  const queryClient = useQueryClient()
  const markStopping = (target: StopLorTarget, stopRequested: boolean) =>
    queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(
      messagesCacheKey(target.channelId, target.threadRootId),
      (old) =>
        old
          ? updateMessagesAcrossPages(old, (messages) =>
              messages.map((message) =>
                message.id === target.id
                  ? { ...message, stopRequested }
                  : message
              )
            )
          : old
    )

  return useMutation({
    mutationFn: async (target: StopLorTarget) => {
      const res = await apiClient.v1.runs["by-message"][
        ":messageId"
      ].stop.$post({ param: { messageId: target.id } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't stop Lor")
      }
    },
    onMutate: (target) => markStopping(target, true),
    onError: (error, target) => {
      markStopping(target, false)
      toast.error(error.message)
    },
  })
}
