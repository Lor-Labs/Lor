import { createRootRoute, Outlet } from "@tanstack/react-router"
import { DesktopWindowFrame } from "@/components/desktop-window-frame"
import { DesktopZoomHud } from "@/components/desktop-zoom"
import { DesktopZoomProvider } from "@/context/desktop-zoom-context"

export const Route = createRootRoute({
  component: () => (
    <DesktopZoomProvider>
      <DesktopWindowFrame>
        <Outlet />
      </DesktopWindowFrame>
      <DesktopZoomHud />
    </DesktopZoomProvider>
  ),
})
