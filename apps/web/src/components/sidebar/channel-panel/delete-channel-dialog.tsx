import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { apiClient } from "@/lib/api-client"
import type { Channel } from "@/lib/api-types"
import {
  patchChannelList,
  removeChannel,
  restoreChannelList,
} from "@/lib/channel-list-cache"

export function DeleteChannelDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: Channel
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug, channelId: activeChannelId } = useParams({
    strict: false,
  })
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$delete({
        param: {
          workspaceSlug: workspaceSlug as string,
          channelId: channel.id,
        },
      })
      if (!res.ok) {
        throw new Error(
          `Failed to delete ${channel.type === "category" ? "category" : "channel"}`
        )
      }
      return res.json()
    },
    // The channel leaves the sidebar, the dialog closes and you leave the
    // channel at once; a failure puts it back with a toast.
    onMutate: async () => {
      if (!workspaceSlug) return undefined
      const previous = await patchChannelList(
        queryClient,
        workspaceSlug,
        (list) => removeChannel(list, channel.id)
      )
      onOpenChange(false)
      if (activeChannelId === channel.id) {
        void navigate({
          to: "/$workspaceSlug",
          params: { workspaceSlug },
        })
      }
      return { workspaceSlug, previous }
    },
    onError: (error, _vars, context) => {
      if (context) {
        restoreChannelList(queryClient, context.workspaceSlug, context.previous)
      }
      toast.error(error.message)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
        exact: true,
      })
    },
  })

  const isCategory = channel.type === "category"

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isCategory ? "Delete Category" : "Delete Channel"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isCategory ? (
              <>
                Are you sure you want to delete the{" "}
                <span className="font-semibold">{channel.name}</span> category?
                Channels inside it will become uncategorized. This action cannot
                be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete{" "}
                <span className="font-semibold">#{channel.name}</span>? This
                will permanently delete all messages in this channel. This
                action cannot be undone.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            {isCategory ? "Delete Category" : "Delete Channel"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
