import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"

// Project lifecycle changes (archive start/finish) arrive on the user room;
// refetch rather than patch caches — the channel list, project list, and the
// open channel's archived state all derive from these queries.
export function useProjectUpdates(workspaceSlug: string | undefined) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!socket || !workspaceSlug) return
    const onUpdated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", workspaceSlug],
      })
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      // Locks any open composer in the project's channels (archivedAt).
      void queryClient.invalidateQueries({
        queryKey: ["channel", workspaceSlug],
      })
    }
    // Channels created outside this client (a teammate, a change-proposal
    // apply) arrive on the workspace room; refetch the channel list.
    const onChannelCreated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
    }
    socket.on("project:updated", onUpdated)
    socket.on("channel:created", onChannelCreated)
    return () => {
      socket.off("project:updated", onUpdated)
      socket.off("channel:created", onChannelCreated)
    }
  }, [socket, queryClient, workspaceSlug])
}
