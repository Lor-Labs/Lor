import type { SessionOverlap } from "@repo/realtime-types/events"
import { toast } from "@repo/ui/components/toast"
import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { useSocket } from "@/context/socket-context"

const MAX_LISTED_FILES = 3

// Live overlap alert: your code session and a teammate's are both editing the
// same files before either commits. Renders nothing; it only toasts.
export function OverlapAlerts({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const socket = useSocket()
  const navigate = useNavigate()

  useEffect(() => {
    if (!socket) return
    const onOverlap = (overlap: SessionOverlap) => {
      if (overlap.workspaceId !== workspaceId) return
      const shown = overlap.paths.slice(0, MAX_LISTED_FILES).join(", ")
      const more = overlap.paths.length - MAX_LISTED_FILES
      const files = more > 0 ? `${shown} and ${more} more` : shown
      const where = overlap.theirs.title ? ` in "${overlap.theirs.title}"` : ""
      const theirSessionId = overlap.theirs.sessionId
      toast.warning(`${overlap.theirs.ownerName} is editing the same files`, {
        description: `${files}${where}. Neither session has committed yet.`,
        timeout: 15_000,
        ...(theirSessionId
          ? {
              action: {
                label: "Open",
                onClick: () =>
                  void navigate({
                    to: "/$workspaceSlug/session/$sessionId",
                    params: { workspaceSlug, sessionId: theirSessionId },
                  }),
              },
            }
          : {}),
      })
    }
    socket.on("session:overlap", onOverlap)
    return () => {
      socket.off("session:overlap", onOverlap)
    }
  }, [socket, navigate, workspaceId, workspaceSlug])

  return null
}
