import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"

// Channels created outside this client (a teammate's dialog, a change-proposal
// apply) arrive on the workspace room; refetch the sidebar tree so the new
// channel shows up without a reload.
export function useChannelCreated(workspaceSlug: string | undefined) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!socket || !workspaceSlug) return
    const onCreated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
    }
    socket.on("channel:created", onCreated)
    return () => {
      socket.off("channel:created", onCreated)
    }
  }, [socket, queryClient, workspaceSlug])
}
