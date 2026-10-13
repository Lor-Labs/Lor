import { Button } from "@repo/ui/components/button"
import { useSidebar } from "@repo/ui/components/sidebar"
import {
  type TooltipPrimitive,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { cn } from "@repo/ui/lib/utils"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { RightSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"

/**
 * Left-sidebar toggle. Anchored to shadcn's `useSidebar` open state so the
 * SidebarToggleIcon morphs between open/closed states whenever the sidebar
 * is opened or collapsed. Content headers should render it via
 * HeaderNavControls, which handles macOS desktop placement.
 */
export function LeftSidebarToggle({
  tooltipHandle,
  className,
}: {
  tooltipHandle: TooltipPrimitive.Handle<string>
  className?: string
}) {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar()
  const isOpen = isMobile ? openMobile : open
  const label = isOpen ? "Collapse sidebar" : "Expand sidebar"

  return (
    <TooltipTrigger
      handle={tooltipHandle}
      payload={label}
      render={
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
            className
          )}
          aria-label={label}
        />
      }
    >
      <SidebarToggleIcon isOpen={isOpen} className="size-4" strokeWidth={1.5} />
    </TooltipTrigger>
  )
}

/**
 * Right-panel "open" affordance for the chat header. Renders only when the
 * right panel is currently CLOSED — when it's open, the panel header carries
 * its own collapse/close control, so showing this here would duplicate it.
 */
export function RightPanelToggle({
  workspaceSlug,
  channelId,
  openView,
  tooltipHandle,
  className,
}: {
  workspaceSlug: string
  channelId: string
  // The page's own panel view; defaults to the channel overview (members).
  openView?: RightSidebarView
  tooltipHandle: TooltipPrimitive.Handle<string>
  className?: string
}) {
  const { view, setView, isCollapsed, toggleCollapsed } = useRightSidebar()
  const isMobileSidebar = useSidebar().isMobile

  const isOpen = !!view && (isMobileSidebar || !isCollapsed)
  if (isOpen) return null

  const handleClick = () => {
    if (view && isCollapsed && !isMobileSidebar) {
      toggleCollapsed()
      return
    }
    setView(openView ?? { type: "workspace-members", workspaceSlug, channelId })
  }

  return (
    <TooltipTrigger
      handle={tooltipHandle}
      payload="Show panel"
      render={
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClick}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
            className
          )}
          aria-label="Open side panel"
        />
      }
    >
      <SidebarToggleIcon
        isOpen={false}
        className="size-4 -scale-x-100"
        strokeWidth={1.5}
      />
    </TooltipTrigger>
  )
}
