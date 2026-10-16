import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { cn } from "@repo/ui/lib/utils"
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

// Shared settings surfaces (Connectors, Agent profiles, LOR.md, Tools): filled,
// borderless groups with inset dividers under a small heading.

export const PILL_BUTTON = "rounded-full px-4 before:rounded-full"

// The filled surface behind every settings group and standalone card.
export const SETTINGS_SURFACE = "rounded-xl bg-muted dark:bg-muted/60"

// Height + fade for CollapsiblePanel disclosures. Keyboard toggles skip it.
export const DISCLOSURE_MOTION =
  "transition-[height,opacity] duration-200 ease-out starting:h-0 starting:opacity-0 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-opacity"

export function SettingsSection({
  title,
  count,
  action,
  description,
  caption,
  children,
}: {
  title: string
  count?: number
  action?: ReactNode
  description?: ReactNode
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
      {description && (
        <p className="px-4 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
      {caption && (
        <p className="px-4 text-xs text-muted-foreground">{caption}</p>
      )}
    </section>
  )
}

// Small text button in a section heading's action slot ("View all", "Format").
export function SettingsAction({
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
      className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
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
    <div className={cn(SETTINGS_SURFACE, "divide-y divide-border px-4")}>
      {children}
    </div>
  )
}

// A standalone filled card for form fields or content.
export function SettingsCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn(SETTINGS_SURFACE, "space-y-4 p-4", className)}>
      {children}
    </div>
  )
}

// A whole filled card that opens something (a profile, a tool).
export function SettingsCardButton({
  className,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        SETTINGS_SURFACE,
        "flex w-full cursor-pointer items-center gap-3 p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted",
        className
      )}
      {...props}
    />
  )
}

// Form actions (Save, Cancel) that stay pinned to the bottom of the settings
// scroll area while their form is on screen.
export function SettingsFooter({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center gap-2 border-t border-border bg-background py-4",
        className
      )}
    >
      {children}
    </div>
  )
}

// A row that opens to show more (a service's tools): icon, title, summary and
// an arrow, plus an optional control (e.g. a switch) outside the trigger.
// Disabled rows stay closed and show no arrow.
export function SettingsDisclosureRow({
  icon,
  title,
  summary,
  control,
  disabled = false,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  summary: ReactNode
  control?: (labelId: string) => ReactNode
  disabled?: boolean
  children: ReactNode
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <Collapsible
      open={open && !disabled}
      onOpenChange={setOpen}
      disabled={disabled}
    >
      <div className="flex items-center gap-3">
        <CollapsibleTrigger
          onClick={(event) => setInstant(event.detail === 0)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        >
          <IconTile size="sm">{icon}</IconTile>
          <span className="min-w-0 flex-1">
            <span id={id} className="block text-sm break-words">
              {title}
            </span>
            <span className="block text-xs text-muted-foreground">
              {summary}
            </span>
          </span>
          {!disabled && (
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                open && "rotate-90",
                instant && "transition-none"
              )}
              strokeWidth={2}
            />
          )}
        </CollapsibleTrigger>
        {control?.(id)}
      </div>
      <CollapsiblePanel
        className={cn(
          DISCLOSURE_MOTION,
          instant && "transition-none motion-reduce:transition-none"
        )}
      >
        <div className="ml-11 border-t border-border">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

// Back from a detail or editor view to its list. Takes focus on mount so
// keyboard users land inside the new view.
export function SettingsBackButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className="-ml-2 text-muted-foreground"
      onClick={onClick}
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
      {label}
    </Button>
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
