import {
  ArrowDown01Icon,
  MoreHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { Spinner } from "@repo/ui/components/spinner"
import { cn } from "@repo/ui/lib/utils"
import { useEffect, useRef, useState } from "react"
import type { ChannelTask } from "@/hooks/use-channel-tasks"

type PlanItem = ChannelTask["plan"][number]

// Long plans collapse behind a "N more" row so a 20-step breakdown doesn't push
// the delivered files off the card.
const INITIAL_VISIBLE_STEPS = 4

// Plan items have no id — set_plan replaces the whole list, so the text is the
// only stable identity we get. The occurrence index is folded in so two steps
// with the same label stay distinct as React keys and as separate entries in the
// seen/fresh sets.
function stepKey(item: PlanItem, index: number) {
  return `${index}:${item.text}`
}

const MARKER_BASE =
  "flex size-6 shrink-0 items-center justify-center rounded-full border"

// Rendered with `key={status}` at the call site, so a status flip remounts the
// marker and its enter animation actually replays.
function StepMarker({ status }: { status: PlanItem["status"] }) {
  if (status === "done") {
    return (
      <span
        className={cn(
          MARKER_BASE,
          "border-primary bg-primary shadow-sm",
          "motion-safe:zoom-in-75 motion-safe:fade-in motion-safe:animate-in motion-safe:duration-300 motion-safe:ease-out"
        )}
      >
        <HugeiconsIcon
          icon={Tick02Icon}
          size={16}
          strokeWidth={3}
          className="motion-safe:zoom-in-75 motion-safe:fade-in text-primary-foreground motion-safe:animate-in motion-safe:fill-mode-both motion-safe:delay-75 motion-safe:duration-200"
        />
      </span>
    )
  }
  if (status === "active") {
    return (
      <span
        className={cn(
          MARKER_BASE,
          "border-primary/25 bg-background shadow-[0_0_0_4px_--theme(--color-primary/8%)]",
          "motion-safe:transition-all motion-safe:duration-300"
        )}
      >
        <Spinner className="size-5 text-primary motion-reduce:animate-none" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        MARKER_BASE,
        "border-border bg-background",
        "motion-safe:transition-all motion-safe:duration-200"
      )}
    />
  )
}

function StepLabel({ item }: { item: PlanItem }) {
  return (
    <span
      className={cn(
        "break-words font-medium text-sm leading-6",
        item.status === "active" && "shimmer text-foreground",
        item.status !== "active" && "text-muted-foreground"
      )}
    >
      {item.text}
    </span>
  )
}

// left-5 lands on the marker's centre: the row's px-2 padding plus half of the
// size-6 marker.
function StepConnector() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-6 left-5 w-px bg-border"
      style={{ height: "calc(100% + 0.25rem)" }}
    />
  )
}

function Step({
  item,
  showConnector,
  isFresh,
  index,
}: {
  item: PlanItem
  showConnector: boolean
  isFresh: boolean
  index: number
}) {
  const [open, setOpen] = useState(false)

  const enterClasses =
    "motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:animate-in motion-safe:duration-300 motion-safe:ease-out"
  // `backwards` matters: without it a delayed item paints at its final position
  // for the length of the delay, then jumps back to animate — the flash that
  // made the stagger look broken.
  const enterStyle = isFresh
    ? {
        animationDelay: `${index * 50}ms`,
        animationFillMode: "backwards" as const,
      }
    : undefined

  if (!item.description) {
    return (
      <li
        className={cn(
          "relative -mx-2 flex min-w-0 items-start gap-3 rounded-md px-2 py-1.5",
          isFresh && enterClasses
        )}
        style={enterStyle}
      >
        {showConnector && <StepConnector />}
        <span className="relative z-10">
          <StepMarker key={item.status} status={item.status} />
        </span>
        <div className="min-w-0 flex-1">
          <StepLabel item={item} />
        </div>
      </li>
    )
  }

  return (
    <li
      className={cn(
        "relative -mx-2 min-w-0 rounded-md",
        isFresh && enterClasses
      )}
      style={enterStyle}
    >
      {showConnector && <StepConnector />}
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            "min-w-0 rounded-md motion-safe:transition-all motion-safe:duration-200",
            open && "bg-foreground/5"
          )}
        >
          {/* z-20 clears the card's stretched "open thread" overlay, so the row
              toggles its detail instead of opening the thread. */}
          <CollapsibleTrigger className="group/step relative z-20 flex w-full cursor-pointer items-start gap-3 px-2 py-1.5 text-left">
            <span className="relative z-10">
              <StepMarker key={item.status} status={item.status} />
            </span>
            <span className="min-w-0 flex-1">
              <StepLabel item={item} />
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={16}
              className={cn(
                "mt-1 shrink-0 text-muted-foreground/50 group-hover/step:text-muted-foreground",
                "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                open && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          {/* Base UI drives the height both ways off --collapsible-panel-height
              and holds the panel mounted through data-ending-style, so this
              collapses smoothly instead of snapping shut on unmount. */}
          <CollapsibleContent className="transition-[height,opacity] duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0">
            <p className="min-w-0 break-words pr-2 pb-1.5 pl-11 text-pretty text-muted-foreground text-sm">
              {item.description}
            </p>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  )
}

export function TaskPlanProgress({
  items,
  className,
}: {
  items: PlanItem[]
  className?: string
}) {
  const total = items.length
  const done = items.filter((item) => item.status === "done").length
  const activeIndex = items.findIndex((item) => item.status === "active")

  // The label tracks whichever reading is true right now: the step being worked,
  // the finished count, or a stall between steps.
  const label =
    activeIndex >= 0
      ? `Step ${activeIndex + 1} of ${total}`
      : `${done} of ${total} complete`

  return (
    <div className={className}>
      <div className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </div>
      <div
        aria-label={label}
        aria-valuemax={total}
        aria-valuemin={0}
        aria-valuenow={done}
        className="flex gap-1.5"
        role="progressbar"
      >
        {items.map((item, idx) => (
          <span
            key={stepKey(item, idx)}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/8"
          >
            <span
              className={cn(
                "block h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none",
                item.status === "done" && "w-full bg-primary",
                item.status === "active" && "w-1/3 bg-primary",
                item.status === "pending" && "w-0 bg-transparent"
              )}
            />
          </span>
        ))}
      </div>
    </div>
  )
}

export function TaskPlanList({
  items,
  className,
}: {
  items: PlanItem[]
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  // Steps that arrive after mount animate in; everything already on screen (or
  // restored from history on scrollback) must not.
  const seenSteps = useRef(new Set<string>())
  const hasMounted = useRef(false)
  const [freshSteps, setFreshSteps] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      for (const [idx, item] of items.entries())
        seenSteps.current.add(stepKey(item, idx))
      return
    }
    const added = new Set<string>()
    for (const [idx, item] of items.entries()) {
      const key = stepKey(item, idx)
      if (!seenSteps.current.has(key)) {
        seenSteps.current.add(key)
        added.add(key)
      }
    }
    if (added.size === 0) return
    setFreshSteps(added)
    const timer = setTimeout(() => setFreshSteps(new Set()), 500)
    return () => clearTimeout(timer)
  }, [items])

  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE_STEPS)
  const hiddenCount = items.length - visible.length

  return (
    <ul className={cn("min-w-0 space-y-1", className)}>
      {visible.map((item, idx) => (
        <Step
          index={idx}
          isFresh={freshSteps.has(stepKey(item, idx))}
          item={item}
          key={stepKey(item, idx)}
          showConnector={idx < visible.length - 1 || hiddenCount > 0}
        />
      ))}

      {(hiddenCount > 0 || expanded) && (
        <li className="mt-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="relative z-20 flex cursor-pointer items-start gap-2 py-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              size={16}
              className="mt-1 shrink-0 text-muted-foreground/70"
            />
            <span>
              {hiddenCount > 0 ? `${hiddenCount} more` : "Show fewer"}
            </span>
          </button>
        </li>
      )}
    </ul>
  )
}
