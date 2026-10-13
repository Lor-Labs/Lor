import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"

// "View Sessions" in the channel menus: opens the channel with its Sessions
// list in the right panel (?panel=sessions, applied by the channel page).
export function useOpenChannelSessions() {
  const navigate = useNavigate()
  const { workspaceSlug } = useParams({ strict: false })
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar()

  return useCallback(
    (channelId: string) => {
      if (!workspaceSlug) return
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId },
        search: { panel: "sessions" },
      })
      setMobileSidebarOpen(false)
    },
    [navigate, workspaceSlug, setMobileSidebarOpen]
  )
}
