import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

// Files open in the right panel on the current page via ?artifactId, over
// whatever the panel showed; closing returns to it.
export function useOpenFile() {
  const navigate = useNavigate()
  const { isCollapsed, toggleCollapsed } = useRightSidebar()
  return useCallback(
    (artifactId: string) => {
      if (isCollapsed) toggleCollapsed()
      void navigate({ to: ".", search: (prev) => ({ ...prev, artifactId }) })
    },
    [navigate, isCollapsed, toggleCollapsed]
  )
}

export function useCloseFile() {
  const navigate = useNavigate()
  return useCallback(() => {
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, artifactId: undefined }),
    })
  }, [navigate])
}
