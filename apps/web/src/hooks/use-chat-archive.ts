import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { chatsKey } from "@/hooks/use-chats"
import { apiClient } from "@/lib/api-client"
import { channelQueryOptions } from "@/lib/channel-query"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

const chatRoute = apiClient.v1.workspaces[":workspaceSlug"].chats[":channelId"]

async function failure(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

// Archiving a chat for everyone, and undoing it (reference/agents-and-chats.md,
// decision 52). Archiving offers Undo in its toast; an archived chat is
// unarchived from its own page, its settings or its row in the sidebar.
export function useChatArchive(workspaceSlug: string) {
  const queryClient = useQueryClient()
  const refresh = (channelId: string) =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: channelQueryOptions(workspaceSlug, channelId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: workspaceChannelsQueryOptions(workspaceSlug).queryKey,
      }),
      // The sidebar's list and its archived chats.
      queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
    ])

  const unarchive = useMutation({
    mutationFn: async (input: { channelId: string }) => {
      const res = await chatRoute.unarchive.$post({
        param: { workspaceSlug, channelId: input.channelId },
      })
      if (!res.ok) throw await failure(res, "Failed to unarchive the chat")
    },
    onSuccess: (_data, input) => refresh(input.channelId),
    onError: (error) => toast.error(error.message),
  })

  const archive = useMutation({
    mutationFn: async (input: { channelId: string; name: string | null }) => {
      const res = await chatRoute.archive.$post({
        param: { workspaceSlug, channelId: input.channelId },
      })
      if (!res.ok) throw await failure(res, "Failed to archive the chat")
    },
    onSuccess: async (_data, input) => {
      toast(`Archived ${input.name ?? "the chat"}`, {
        timeout: 10_000,
        action: {
          label: "Undo",
          onClick: () => unarchive.mutate({ channelId: input.channelId }),
        },
      })
      await refresh(input.channelId)
    },
    onError: (error) => toast.error(error.message),
  })

  return { archive, unarchive }
}
