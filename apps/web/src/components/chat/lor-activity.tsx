import {
  ArrowRight01Icon,
  BrainIcon,
  Loading03Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { type ReactNode, useRef, useState } from "react"

export function LorActivity({
  active,
  failed,
  toolCount,
  errorCount,
  children,
}: {
  active: boolean
  failed: boolean
  toolCount: number
  errorCount: number
  children: ReactNode
}) {
  const [wasActive, setWasActive] = useState(active)
  const [open, setOpen] = useState(active)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Reset at run boundaries; manual toggles still work while a run is active.
  if (wasActive !== active) {
    setWasActive(active)
    setOpen(active)
  }

  const label = active
    ? "Working…"
    : failed
      ? "Work interrupted"
      : toolCount > 0
        ? "Worked"
        : "Thought process"

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1 min-w-0">
      <CollapsibleTrigger
        ref={triggerRef}
        className="group/activity flex max-w-full cursor-pointer items-center gap-2 rounded-sm py-1 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-out group-data-panel-open/activity:rotate-90 motion-reduce:transition-none"
          strokeWidth={1.75}
        />
        {active && (
          <HugeiconsIcon
            icon={Loading03Icon}
            className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            strokeWidth={2}
          />
        )}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span>{label}</span>
          {toolCount > 0 && (
            <span className="text-xs text-muted-foreground/70">
              · {toolCount} tool {toolCount === 1 ? "call" : "calls"}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-xs text-destructive">
              · {errorCount} failed
            </span>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="transition-none">
        <div className="relative mt-3 mb-5 min-w-0 pl-5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-2.5 left-1.5 w-px bg-foreground/10"
          />
          <div className="min-w-0 space-y-3">{children}</div>
          <div className="relative mt-4 flex items-center">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 -left-3.5 h-px w-2 bg-foreground/10"
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                triggerRef.current?.focus({ preventScroll: true })
              }}
              className="cursor-pointer rounded-sm py-0.5 text-xs text-muted-foreground/70 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Hide activity
            </button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function LorActivityGroup({
  active,
  toolCount,
  errorCount,
  children,
}: {
  active: boolean
  toolCount: number
  errorCount: number
  children: ReactNode
}) {
  const [wasActive, setWasActive] = useState(active)
  const [open, setOpen] = useState(active)
  if (wasActive !== active) {
    setWasActive(active)
    setOpen(active)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger className="group/work flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm py-0.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <HugeiconsIcon
          icon={toolCount > 0 ? Wrench01Icon : BrainIcon}
          className="size-3.5 shrink-0"
          strokeWidth={1.75}
        />
        <span>
          {toolCount > 0
            ? `${active ? "Using" : "Used"} ${toolCount} tool${toolCount === 1 ? "" : "s"}`
            : active
              ? "Thinking…"
              : "Thought process"}
        </span>
        {errorCount > 0 && (
          <span className="text-destructive">· {errorCount} failed</span>
        )}
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-3 shrink-0 transition-transform duration-150 ease-out group-data-panel-open/work:rotate-90 motion-reduce:transition-none"
          strokeWidth={2}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="transition-none">
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto overscroll-contain pr-2 pl-5 text-muted-foreground [&_[data-slot=chain-of-thought-step-title]]:text-xs [&_[data-slot=chain-of-thought-step-title]_[data-nx-text-shimmer]]:text-xs">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
