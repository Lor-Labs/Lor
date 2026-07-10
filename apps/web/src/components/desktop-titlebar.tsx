import { ArrowLeft02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { useSidebar } from "@repo/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { cn } from "@repo/ui/lib/utils"
import { useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { LeftSidebarToggle } from "@/components/sidebar/sidebar-toggle"

function HistoryNavButtons() {
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.history.back()}
            disabled={!canGoBack}
            aria-label="Go back"
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={16} strokeWidth={2} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Back</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.history.forward()}
            disabled={!canGoForward}
            aria-label="Go forward"
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={ArrowRight02Icon} size={16} strokeWidth={2} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Forward</TooltipContent>
      </Tooltip>
    </>
  )
}

/**
 * macOS-only window-chrome strip over the expanded sidebar's reserved top
 * row: native traffic lights in the left inset, then the sidebar toggle and
 * history nav. When the sidebar collapses these controls move into the
 * content header (HeaderNavControls) so the main card keeps its full height.
 * In fullscreen macOS hides the lights and the inset collapses.
 */
export function DesktopTitlebar() {
  const { isMacDesktop, isFullscreen } = useDesktopChrome()
  const { open, isMobile } = useSidebar()

  if (!isMacDesktop || isMobile || !open) return null

  return (
    <div
      className={cn(
        "absolute top-2 left-0 z-20 flex h-12 items-center gap-1",
        isFullscreen ? "pl-1" : "pl-22"
      )}
    >
      <LeftSidebarToggle />
      <HistoryNavButtons />
    </div>
  )
}

/**
 * Sidebar-toggle slot for content headers. On the web (and mobile) it's just
 * the toggle, as before. On macOS desktop the titlebar strip owns the
 * controls while the sidebar is expanded, so this renders nothing; when the
 * sidebar collapses, the toggle and history nav render here beside the
 * title — shifted right of the traffic lights outside fullscreen.
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
  const inDesktopHeader = isMacDesktop && !isMobile

  if (inDesktopHeader && open) return null

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1",
          className,
          inDesktopHeader && !isFullscreen && "ml-16"
        )}
      >
        <LeftSidebarToggle />
        {inDesktopHeader && <HistoryNavButtons />}
      </div>
      {withDivider && <div className="h-4 w-px bg-border" aria-hidden="true" />}
    </>
  )
}
