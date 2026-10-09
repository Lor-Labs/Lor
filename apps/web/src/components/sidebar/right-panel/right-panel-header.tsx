import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { cn } from "@repo/ui/lib/utils"
import type { ReactNode } from "react"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"

export function RightPanelHeader({
  title,
  workspaceSlug,
  channelId,
  titleAdornment,
  actions,
  className,
  hideCollapse = false,
  hideBack = false,
  compact = false,
}: {
  title: ReactNode
  workspaceSlug: string
  channelId: string
  titleAdornment?: ReactNode
  actions?: ReactNode
  className?: string
  // Detail views whose X already exits (loop panel) drop the collapse
  // toggle — closing the whole panel happens from the overview.
  hideCollapse?: boolean
  // A page's own panel (a session's work) has no channel overview to go
  // back to.
  hideBack?: boolean
  compact?: boolean
}) {
  const { setView, toggleCollapsed, clearView } = useRightSidebar()
  const isMobile = useIsMobile()

  const goBack = () => {
    setView({ type: "workspace-members", workspaceSlug, channelId })
  }

  return (
    <div
      className={cn(
        "flex h-16 shrink-0 items-center gap-3 border-border/70 border-b px-4",
        compact && "h-12 gap-2 px-3",
        className
      )}
    >
      {!hideBack && (
        <button
          type="button"
          aria-label="Back to channel overview"
          onClick={goBack}
          className={cn(
            "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background/40 text-muted-foreground transition-[background-color,border-color,color,transform] duration-200 hover:border-foreground/20 hover:bg-accent hover:text-foreground active:scale-[0.97]",
            compact && "size-7 rounded-md border-0 bg-transparent"
          )}
        >
          <HugeiconsIcon
            icon={compact ? ArrowLeft01Icon : Cancel01Icon}
            size={16}
            strokeWidth={1.75}
          />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "min-w-0 truncate font-semibold text-base tracking-tight text-foreground",
            compact && "font-medium text-sm"
          )}
        >
          {title}
        </div>
        {titleAdornment}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        {!hideCollapse && (
          <button
            type="button"
            onClick={isMobile ? clearView : toggleCollapsed}
            aria-label={isMobile ? "Close side panel" : "Collapse side panel"}
            className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <SidebarToggleIcon
              isOpen={true}
              className="size-4 -scale-x-100"
              strokeWidth={1.5}
            />
          </button>
        )}
      </div>
    </div>
  )
}
