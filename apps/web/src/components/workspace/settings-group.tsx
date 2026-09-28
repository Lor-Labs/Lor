import { cn } from "@repo/ui/lib/utils"
import type { ReactNode } from "react"

// Shared settings surfaces (Connectors, Agent profiles): filled, borderless
// groups with inset dividers under a small heading.

export const PILL_BUTTON = "rounded-full px-4 before:rounded-full"

export function SettingsSection({
  title,
  count,
  action,
  caption,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  caption?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-4">
        <h3 className="text-sm font-medium">
          {title}
          {count !== undefined && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h3>
        {action}
      </div>
      {children}
      {caption && (
        <p className="px-4 text-xs text-muted-foreground">{caption}</p>
      )}
    </section>
  )
}

// Inline link in a caption that jumps to another settings section.
export function SettingsLink({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer font-medium text-foreground hover:underline"
    >
      {children}
    </button>
  )
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border rounded-xl bg-muted px-4 dark:bg-muted/60">
      {children}
    </div>
  )
}

const TILE_SIZES = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-lg",
  lg: "size-14 rounded-xl",
}

export function IconTile({
  size = "md",
  children,
}: {
  size?: keyof typeof TILE_SIZES
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-border bg-card text-foreground",
        TILE_SIZES[size]
      )}
    >
      {children}
    </span>
  )
}
