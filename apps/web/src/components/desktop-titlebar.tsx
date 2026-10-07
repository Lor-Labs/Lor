import { ArrowLeft02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { useSidebar } from "@repo/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipCreateHandle,
  type TooltipPrimitive,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router"
import { useState } from "react"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { LeftSidebarToggle } from "@/components/sidebar/sidebar-toggle"
import { useDesktopZoom } from "@/context/desktop-zoom-context"

function HistoryNavButtons({
  tooltipHandle,
}: {
  tooltipHandle: TooltipPrimitive.Handle<string>
}) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  // The router doesn't expose a canGoForward — approximate it from the
  // session history: forward entries exist while the current index sits
  // below the last one. Worst case the button is enabled with nothing
  // ahead and the click is a no-op.
  const historyIndex = useRouterState({
    select: (s) => s.location.state.__TSR_index,
  })
  const canGoForward = historyIndex < window.history.length - 1

  return (
    <>
      {/* aria-disabled (not disabled) so the tooltip stays hoverable —
          native disabled buttons don't receive pointer events. */}
      <TooltipTrigger
        handle={tooltipHandle}
        payload="Back"
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => canGoBack && router.history.back()}
            aria-disabled={!canGoBack}
            aria-label="Go back"
            className="size-7 text-muted-foreground hover:text-foreground aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-1"
          />
        }
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={2} />
      </TooltipTrigger>
      <TooltipTrigger
        handle={tooltipHandle}
        payload="Forward"
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => canGoForward && router.history.forward()}
            aria-disabled={!canGoForward}
            aria-label="Go forward"
            className="size-7 text-muted-foreground hover:text-foreground aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground pointer-fine:after:absolute pointer-fine:after:left-full pointer-fine:after:h-full pointer-fine:after:w-1"
          />
        }
      >
        <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={2} />
      </TooltipTrigger>
    </>
  )
}

/**
 * macOS-only top row of the left sidebar. The native traffic lights overlay
 * its left edge; the history nav pins to the right edge of the panel. It also
 * reserves the vertical space that pushes the workspace switcher below the
 * lights. When the sidebar collapses it slides off-canvas with the panel, so
 * the history nav re-homes into the content header (HeaderNavControls).
 */
export function DesktopSidebarTitlebar() {
  const { isMacDesktop } = useDesktopChrome()
  const { isMobile } = useSidebar()
  const zoom = useDesktopZoom()
  const appScale = (zoom?.levels.app ?? 100) / 100
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  if (!isMacDesktop || isMobile) return null

  return (
    <div
      className="flex h-12 shrink-0 items-center justify-end pr-1"
      style={{ minHeight: 48 / appScale, paddingLeft: 80 / appScale }}
    >
      <HistoryNavButtons tooltipHandle={tooltipHandle} />
      <Tooltip handle={tooltipHandle}>
        {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
      </Tooltip>
    </div>
  )
}

/**
 * Sidebar-toggle slot for content headers — always present, mirroring the web
 * layout where the toggle lives in the center panel. On macOS desktop the
 * history nav lives in the sidebar's own top row while expanded; when the
 * sidebar collapses (and its nav goes off-canvas) the arrows join the toggle
 * here, shifted right to clear the traffic lights outside fullscreen.
 */
export function HeaderNavControls({
  className,
  withDivider = false,
}: {
  className?: string
  withDivider?: boolean
}) {
  const { isMacDesktop, isFullscreen } = useDesktopChrome()
  const { open, isMobile } = useSidebar()
  const zoom = useDesktopZoom()
  const chromeScale = zoom ? (zoom.levels.app * zoom.levels.main) / 10000 : 1
  const collapsedDesktop = isMacDesktop && !isMobile && !open
  const [tooltipHandle] = useState(() => TooltipCreateHandle<string>())

  return (
    <>
      <div
        data-desktop-header-nav=""
        className={cn("flex items-center gap-1", className)}
        style={
          collapsedDesktop && !isFullscreen
            ? { marginLeft: 64 / chromeScale }
            : undefined
        }
      >
        {collapsedDesktop && (
          <HistoryNavButtons tooltipHandle={tooltipHandle} />
        )}
        <LeftSidebarToggle tooltipHandle={tooltipHandle} />
        <Tooltip handle={tooltipHandle}>
          {({ payload }) => <TooltipContent>{payload}</TooltipContent>}
        </Tooltip>
      </div>
      {withDivider && <div className="h-4 w-px bg-border" aria-hidden="true" />}
    </>
  )
}
