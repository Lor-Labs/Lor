import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

// Files open in the right panel on the current page via the URL (?artifactId
// for Lor's files, ?upload=<messageId>.<index> for uploads), over whatever the
// panel showed; closing returns to it.
function useOpenInPanel() {
  const navigate = useNavigate()
  const { isCollapsed, toggleCollapsed } = useRightSidebar()
  return useCallback(
    (file: { artifactId?: string; upload?: string }) => {
      if (isCollapsed) toggleCollapsed()
      void navigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          artifactId: file.artifactId,
          upload: file.upload,
        }),
      })
    },
    [navigate, isCollapsed, toggleCollapsed]
  )
}

export function useOpenFile() {
  const open = useOpenInPanel()
  return useCallback((artifactId: string) => open({ artifactId }), [open])
}

export function useOpenUpload() {
  const open = useOpenInPanel()
  return useCallback(
    (messageId: string, index: number) =>
      open({ upload: `${messageId}.${index}` }),
    [open]
  )
}

export function useCloseFile() {
  const navigate = useNavigate()
  return useCallback(() => {
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, artifactId: undefined, upload: undefined }),
    })
  }, [navigate])
}
