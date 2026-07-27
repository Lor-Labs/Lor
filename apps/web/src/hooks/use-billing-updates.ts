import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { toast } from "sonner"
import { useSocket } from "@/context/socket-context"

// Global billing listener: keeps billing queries fresh everywhere and
// surfaces action-needed events as toasts — but only to admins of the ACTIVE
// workspace, since isAdmin is computed for it and the toast copy points at
// the current workspace's settings.
export function useBillingUpdates(
  workspaceId: string | undefined,
  isAdmin: boolean
) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!socket) return
    const onUpdated = (payload: { workspaceId: string; reason: string }) => {
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      if (!isAdmin || !workspaceId || payload.workspaceId !== workspaceId)
        return
      if (payload.reason === "out_of_credits") {
        toast.error("Merlin is out of credits", {
          description: "Top up in Settings → Billing to keep it answering.",
        })
      } else if (payload.reason === "auto_topup_failed") {
        toast.error("Auto top-up failed", {
          description: "Check your payment method in Settings → Billing.",
        })
      }
    }
    socket.on("billing:updated", onUpdated)
    return () => {
      socket.off("billing:updated", onUpdated)
    }
  }, [socket, queryClient, isAdmin, workspaceId])
}
