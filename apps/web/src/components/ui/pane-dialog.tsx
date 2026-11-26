import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { cn } from "@repo/ui/lib/utils"
import { Fragment, type ReactNode, useRef } from "react"

export type PaneTab<T extends string> = {
  id: T
  label: string
  icon: IconSvgElement
  // A small heading over the first section that names it: sections that
  // share a group sit under one heading.
  group?: string
}

// A settings dialog with its sections down the left and one section on the
// right: the agent dialog and the channel dialog. The size is fixed, so
// switching sections never moves the dialog or its edges.
export function PaneDialog<T extends string>({
  open,
  onOpenChange,
  title,
  description,
  identity,
  tabs,
  tab,
  onTabChange,
  aside,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Read by screen readers; the visible heading is `identity`.
  title: string
  description: string
  // What the dialog is about, above the sections: a face and a name.
  identity: ReactNode
  tabs: PaneTab<T>[]
  tab: T
  onTabChange: (tab: T) => void
  // Under the sections, at the bottom of the left pane.
  aside?: ReactNode
  children: ReactNode
}) {
  // Focus opens on the section shown, not on the first one in the list.
  const current = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        initialFocus={current}
        className="h-[min(40rem,calc(100dvh-4rem))] gap-0 overflow-hidden p-0 sm:max-w-[52rem]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <div className="flex shrink-0 flex-col gap-3 border-border bg-sidebar p-3 max-sm:border-b sm:w-52 sm:border-r">
            <div className="px-2 pt-2 pr-8 sm:pr-2">{identity}</div>
            <nav
              aria-label={title}
              // Room for a focus ring inside the strip that scrolls sideways.
              className="flex gap-0.5 max-sm:-m-1 max-sm:overflow-x-auto max-sm:p-1 sm:flex-col"
            >
              {tabs.map((item, index) => (
                <Fragment key={item.id}>
                  {item.group && item.group !== tabs[index - 1]?.group && (
                    <p className="truncate px-2 pt-4 pb-1 font-medium text-muted-foreground/70 text-xs max-sm:hidden">
                      {item.group}
                    </p>
                  )}
                  <button
                    ref={tab === item.id ? current : undefined}
                    type="button"
                    onClick={() => onTabChange(item.id)}
                    aria-current={tab === item.id ? "page" : undefined}
                    className={cn(
                      "flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none transition-[background-color,color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
                      tab === item.id
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                  >
                    <HugeiconsIcon
                      icon={item.icon}
                      className="size-4 shrink-0"
                      strokeWidth={2}
                    />
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </nav>
            {aside && <div className="mt-auto max-sm:hidden">{aside}</div>}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// One section's body: its heading, then what scrolls.
export function PaneBody({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    // A stable gutter: a section that scrolls sits where one that doesn't.
    <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
      <div className="mx-auto w-full max-w-xl space-y-5 px-4 pt-6 pb-8">
        <div className="flex items-start gap-3 pr-8">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-base">{title}</h2>
            {description && (
              <p className="mt-1 text-pretty text-muted-foreground text-sm">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  )
}

// A section's Save and Cancel, pinned under what scrolls.
export function PaneFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-border border-t px-6 py-3">
      {children}
    </div>
  )
}
