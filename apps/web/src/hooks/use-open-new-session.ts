import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"

// Opens the New session view with the current channel preselected; from a
// session page the view falls back to the session's channel.
export function useOpenNewSession() {
  const navigate = useNavigate()
  const { workspaceSlug, channelId } = useParams({ strict: false })
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar()

  return useCallback(() => {
    if (!workspaceSlug) return
    void navigate({
      to: "/$workspaceSlug/session/new",
      params: { workspaceSlug },
      search: { channelId },
    })
    setMobileSidebarOpen(false)
  }, [navigate, workspaceSlug, channelId, setMobileSidebarOpen])
}
