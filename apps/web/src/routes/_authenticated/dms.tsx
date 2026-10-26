import { features } from "@repo/utils/features"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

export const Route = createFileRoute("/_authenticated/dms")({
  beforeLoad: () => {
    if (!features.directMessages) throw redirect({ to: "/", replace: true })
  },
  component: DMsLayout,
})

function DMsLayout() {
  const { clearView } = useRightSidebar()

  useEffect(() => {
    clearView()
  }, [clearView])

  return <Outlet />
}
