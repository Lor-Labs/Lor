import { createRootRoute, Outlet } from "@tanstack/react-router"
import { DesktopWindowFrame } from "@/components/desktop-window-frame"

export const Route = createRootRoute({
  component: () => (
    <DesktopWindowFrame>
      <Outlet />
    </DesktopWindowFrame>
  ),
})
