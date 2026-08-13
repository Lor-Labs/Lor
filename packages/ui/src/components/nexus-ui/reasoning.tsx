"use client"

import { AiBrain01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import { TextShimmer } from "@repo/ui/components/nexus-ui/text-shimmer"
import { useOnChange } from "@repo/ui/hooks/use-on-change"
import { cn } from "@repo/ui/lib/utils"
import * as React from "react"
import { Streamdown } from "streamdown"

type ReasoningContextValue = {
  isStreaming: boolean
  label: string
}

const ReasoningContext = React.createContext<ReasoningContextValue | null>(null)

function useReasoningContext(component: string): ReasoningContextValue {
  const ctx = React.useContext(ReasoningContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <Reasoning>`)
  }
  return ctx
}

type ReasoningProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "defaultOpen" | "onOpenChange"
> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

function Reasoning({
  className,
  isStreaming = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ReasoningProps) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = React.useState(
    defaultOpen || isStreaming
  )
  const open = isControlled ? openProp : internalOpen
  const [durationLabel, setDurationLabel] = React.useState<string | null>(null)
  const [hasStreamed, setHasStreamed] = React.useState(isStreaming)
  const startedAtRef = React.useRef<number | null>(null)

  // Only needed for a stream that is already running on mount: useOnChange sees
  // no transition in that case. Deliberately not dependent on `isStreaming` or
  // `onOpenChange` — an inline onOpenChange would re-run this on every parent
  // render and keep resetting the start time, so the duration always read "1
  // second". Every later transition is useOnChange's job.
  const notifiedInitialStream = React.useRef(false)
  React.useEffect(() => {
    if (notifiedInitialStream.current || !isStreaming) return
    notifiedInitialStream.current = true
    startedAtRef.current = Date.now()
    onOpenChange?.(true)
  })

  useOnChange(isStreaming, (current, previous) => {
    if (!previous && current) {
      setHasStreamed(true)
      startedAtRef.current = Date.now()
      setDurationLabel(null)
      if (!isControlled) {
        setInternalOpen(true)
      }
      onOpenChange?.(true)
    }

    if (previous && !current) {
      const startedAt = startedAtRef.current
      const elapsedSeconds =
        startedAt != null
          ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
          : null
      setDurationLabel(
        elapsedSeconds != null ? String(elapsedSeconds) : "a few"
      )
      startedAtRef.current = null
      if (!isControlled) {
        setInternalOpen(false)
      }
      onOpenChange?.(false)
    }
  })

  const label = React.useMemo(() => {
    if (!hasStreamed || isStreaming) return "Thinking..."
    if (durationLabel != null) {
      const unit = durationLabel === "1" ? "second" : "seconds"
      return `Thought for ${durationLabel} ${unit}`
    }
    return "Thought for a few seconds"
  }, [durationLabel, hasStreamed, isStreaming])

  const contextValue = React.useMemo(
    () => ({ isStreaming, label }),
    [isStreaming, label]
  )

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      const resolvedOpen = isStreaming ? true : nextOpen
      if (!isControlled) {
        setInternalOpen(resolvedOpen)
      }
      onOpenChange?.(resolvedOpen)
    },
    [isControlled, isStreaming, onOpenChange]
  )

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        data-slot="reasoning"
        className={cn("not-prose w-full", className)}
        data-streaming={isStreaming ? "true" : "false"}
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  )
}

type ReasoningTriggerProps = React.ComponentProps<typeof CollapsibleTrigger>

function ReasoningTrigger({
  className,
  children,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, label } = useReasoningContext("ReasoningTrigger")

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      data-streaming={isStreaming ? "true" : "false"}
      className={cn(
        "group flex cursor-pointer items-center gap-1.25 text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      <HugeiconsIcon
        icon={AiBrain01Icon}
        strokeWidth={1.75}
        className="size-4"
      />
      <TextShimmer
        className="text-sm leading-6"
        spread={10}
        invertLight
        // Default beam is `max(0.8, l + 0.4)` off currentColor, which peaks near
        // white and pulls the label well above the surrounding muted text. A
        // gentle lift off --muted-foreground keeps the shimmer readable as
        // motion while the label still sits at muted weight.
        color="color-mix(in oklab, var(--foreground) 40%, var(--muted-foreground))"
        disableShimmer={!isStreaming}
      >
        {children ?? label}
      </TextShimmer>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2.0}
        // Base UI marks the trigger with data-panel-open, not data-state.
        className="ml-0.5 size-4 opacity-0 transition-all group-hover:opacity-100 group-data-panel-open:rotate-180 group-data-panel-open:opacity-100"
      />
    </CollapsibleTrigger>
  )
}

type ReasoningContentProps = Omit<
  React.ComponentProps<typeof CollapsibleContent>,
  "children"
> & {
  children: string
}

function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        // No animate-collapsible-* here: CollapsiblePanel already animates
        // height off --collapsible-panel-height in both directions.
        "mt-2 ml-2 overflow-hidden border-l pl-3",
        className
      )}
      {...props}
    >
      <Streamdown
        className={cn(
          "prose max-w-none text-sm leading-6 font-normal text-muted-foreground",
          // body text
          "[&_p]:mb-2.5",
          // strong
          "prose-strong:font-medium prose-strong:text-foreground",
          // lists
          "**:data-[streamdown=list-item]:py-0.25 **:data-[streamdown=list-item]:pl-4 **:data-[streamdown=list-item]:marker:text-muted-foreground/50 prose-ol:my-0 prose-ol:pl-3 prose-ul:my-0 prose-li:my-[-0.5px]",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        )}
      >
        {children}
      </Streamdown>
    </CollapsibleContent>
  )
}

export { Reasoning, ReasoningTrigger, ReasoningContent }
