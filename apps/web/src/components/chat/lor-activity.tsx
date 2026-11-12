import {
  ArrowRight01Icon,
  BrainIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { cn } from "@repo/ui/lib/utils"
import { formatWorkTime } from "@repo/utils/date"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import { MorphText } from "@/components/ui/morph-text"

export function LorActivity({
  active,
  failed,
  toolCount,
  errorCount,
  workedMs = null,
  children,
}: {
  active: boolean
  failed: boolean
  toolCount: number
  errorCount: number
  // The run's wall-clock time once it settled; null for older replies.
  workedMs?: number | null
  children: ReactNode
}) {
  const [wasActive, setWasActive] = useState(active)
  const [open, setOpen] = useState(active || failed)
  // Labels morph only for runs seen live; settled history rows stay plain text.
  const [live, setLive] = useState(active)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Reset at run boundaries; manual toggles still work while a run is active.
  if (wasActive !== active) {
    setWasActive(active)
    setOpen(active || failed)
  }
  if (active && !live) setLive(true)

  // Taught on a reply the viewer watched finish, where the work is fresh.
  const workHint = useHint("lor_reply", live && !active && toolCount > 0)
  const dismissWorkHint = workHint.dismiss

  // While the run is live, "Working for …" sits at the bottom of the reply
  // (LorWorkingFor); once it settles, the time moves up here.
  const took = workedMs !== null ? formatWorkTime(workedMs) : null
  const label = active
    ? "Activity"
    : failed
      ? took
        ? `Work interrupted after ${took}`
        : "Work interrupted"
      : toolCount > 0
        ? took
          ? `Worked for ${took}`
          : "Worked"
        : took
          ? `Thought for ${took}`
          : "Thought process"

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) dismissWorkHint()
      }}
      className="my-1 min-w-0"
    >
      <HintPopover
        open={workHint.show}
        anchor={triggerRef}
        align="start"
        onDismiss={dismissWorkHint}
      >
        Lor shows its work. Open this to see what it checked.
      </HintPopover>
      <CollapsibleTrigger
        ref={triggerRef}
        className="group/activity flex max-w-full cursor-pointer items-center gap-2 rounded-sm py-1 text-left text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-out group-data-panel-open/activity:rotate-90 motion-reduce:transition-none"
          strokeWidth={1.75}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <MorphText live={live}>{label}</MorphText>
          {toolCount > 0 && (
            <MorphText live={live} className="text-xs text-muted-foreground/70">
              {`· ${toolCount} tool ${toolCount === 1 ? "call" : "calls"}`}
            </MorphText>
          )}
          {errorCount > 0 && (
            <span className="text-xs text-destructive">
              · {errorCount} failed
            </span>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
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

// Pixels from the end that still count as the bottom (fractional offsets).
const AT_BOTTOM_PX = 2

// A streaming group's scroll box follows new reasoning and tool steps while
// the reader is at the bottom, like the main thread. Scrolling up hands it to
// the reader until they scroll back to the end. Mounts with the open panel,
// so reopening a live group starts at its latest step.
function FollowingScrollBox({
  startFollowing,
  className,
  children,
}: {
  startFollowing: boolean
  className: string
  children: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(startFollowing)
  const lastTopRef = useRef(0)

  useEffect(() => {
    const viewport = scrollRef.current
    const content = contentRef.current
    if (!(viewport && content)) return
    const observer = new ResizeObserver(() => {
      if (followRef.current) viewport.scrollTop = viewport.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const handleScroll = () => {
    const viewport = scrollRef.current
    if (!viewport) return
    const top = viewport.scrollTop
    const distance = viewport.scrollHeight - top - viewport.clientHeight
    // Checked first: content shrinking also lowers scrollTop, but leaves the
    // box at its end.
    if (distance <= AT_BOTTOM_PX) followRef.current = true
    else if (top < lastTopRef.current) followRef.current = false
    lastTopRef.current = top
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className={className}>
      <div ref={contentRef} className="space-y-2">
        {children}
      </div>
    </div>
  )
}

export function LorActivityGroup({
  active,
  runActive,
  bare = false,
  toolCount,
  errorCount,
  children,
}: {
  active: boolean
  runActive: boolean
  bare?: boolean
  toolCount: number
  errorCount: number
  children: ReactNode
}) {
  // Settled runs open every group, so one click on the activity panel shows
  // the whole log. While a run streams, only the current group stays open.
  const defaultOpen = !runActive || active
  const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen)
  const [open, setOpen] = useState(defaultOpen)
  if (prevDefaultOpen !== defaultOpen) {
    setPrevDefaultOpen(defaultOpen)
    setOpen(defaultOpen)
  }

  const content = (
    // Settled groups open at the top, to be read from the start.
    <FollowingScrollBox
      startFollowing={active}
      className={cn(
        "max-h-80 overflow-y-auto overscroll-contain pr-2 text-muted-foreground [&_[data-slot=chain-of-thought-step-title]]:text-xs [&_[data-slot=chain-of-thought-step-title]_[data-nx-text-shimmer]]:text-xs",
        !bare && "mt-2 pl-5"
      )}
    >
      {children}
    </FollowingScrollBox>
  )

  // A lone group repeats the panel's own label, so it renders without a header.
  if (bare) return content

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
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  )
}
