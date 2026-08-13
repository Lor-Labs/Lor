"use client"

import { Alert02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
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

type ChainOfThoughtRootContextValue = {
  registerStep: (id: string, status: ChainOfThoughtStepStatus) => void
  unregisterStep: (id: string) => void
  allStepsComplete: boolean
  hasAnyError: boolean
}

const ChainOfThoughtRootContext =
  React.createContext<ChainOfThoughtRootContextValue | null>(null)

function useChainOfThoughtRootContext(component: string) {
  const ctx = React.useContext(ChainOfThoughtRootContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <ChainOfThought>`)
  }
  return ctx
}

type ChainOfThoughtStepContextValue = {
  status: ChainOfThoughtStepStatus
  hasContent: boolean
}

const ChainOfThoughtStepContext =
  React.createContext<ChainOfThoughtStepContextValue | null>(null)

function useChainOfThoughtStepContext(component: string) {
  const ctx = React.useContext(ChainOfThoughtStepContext)
  if (!ctx) {
    throw new Error(`${component} must be used within <ChainOfThoughtStep>`)
  }
  return ctx
}

// The default beam is `max(0.8, l + 0.4)` off currentColor, which peaks near
// white. Lifting gently off --muted-foreground instead keeps in-progress labels
// reading as muted text that happens to move.
const SHIMMER_BEAM =
  "color-mix(in oklab, var(--foreground) 40%, var(--muted-foreground))"

type ChainOfThoughtStepStatus = "pending" | "active" | "completed" | "error"

type ChainOfThoughtProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "defaultOpen" | "onOpenChange"
> & {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  autoCloseOnAllComplete?: boolean
}

function ChainOfThought({
  className,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  autoCloseOnAllComplete = true,
  children,
  ...props
}: ChainOfThoughtProps) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const [stepStatuses, setStepStatuses] = React.useState<
    Record<string, ChainOfThoughtStepStatus>
  >({})

  const { allStepsComplete, hasAnyError } = React.useMemo(() => {
    const statuses = Object.values(stepStatuses)
    return {
      allStepsComplete:
        statuses.length > 0 &&
        statuses.every((status) => status === "completed"),
      hasAnyError: statuses.some((status) => status === "error"),
    }
  }, [stepStatuses])

  const open = isControlled ? openProp : internalOpen

  const registerStep = React.useCallback(
    (id: string, status: ChainOfThoughtStepStatus) => {
      setStepStatuses((prev) => {
        if (prev[id] === status) return prev
        return { ...prev, [id]: status }
      })
    },
    []
  )

  const unregisterStep = React.useCallback((id: string) => {
    setStepStatuses((prev) => {
      if (!(id in prev)) return prev
      const { [id]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const contextValue = React.useMemo(
    () => ({ registerStep, unregisterStep, allStepsComplete, hasAnyError }),
    [allStepsComplete, hasAnyError, registerStep, unregisterStep]
  )

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [isControlled, onOpenChange]
  )

  useOnChange(allStepsComplete, (current, previous) => {
    if (!autoCloseOnAllComplete || isControlled) return
    if (!previous && current) {
      setInternalOpen(false)
      onOpenChange?.(false)
    }
  })

  return (
    <ChainOfThoughtRootContext.Provider value={contextValue}>
      <Collapsible
        data-slot="chain-of-thought"
        className={cn("not-prose w-full", className)}
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </Collapsible>
    </ChainOfThoughtRootContext.Provider>
  )
}

type ChainOfThoughtTriggerProps = React.ComponentProps<
  typeof CollapsibleTrigger
> & {
  label?: React.ReactNode
  icon?: React.ReactNode
}

function ChainOfThoughtTrigger({
  className,
  icon,
  label,
  children,
  ...props
}: ChainOfThoughtTriggerProps) {
  const { allStepsComplete, hasAnyError } = useChainOfThoughtRootContext(
    "ChainOfThoughtTrigger"
  )
  const isActive = !allStepsComplete && !hasAnyError

  return (
    <CollapsibleTrigger
      data-slot="chain-of-thought-trigger"
      data-active={String(isActive)}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-1.25 overflow-hidden text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      {icon}
      <div className="flex min-w-0 flex-1 items-start gap-1.25 overflow-hidden">
        <TextShimmer
          className="truncate text-left text-sm leading-4.5 text-ellipsis whitespace-nowrap"
          spread={10}
          invertLight
          color={SHIMMER_BEAM}
          disableShimmer={!isActive}
        >
          {children ?? label}
        </TextShimmer>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="ml-0.5 size-4 shrink-0 opacity-0 transition-all group-hover:opacity-100 group-data-panel-open:rotate-180 group-data-panel-open:opacity-100"
        />
      </div>
    </CollapsibleTrigger>
  )
}

type ChainOfThoughtContentProps = React.ComponentProps<
  typeof CollapsibleContent
>

function ChainOfThoughtContent({
  className,
  children,
  ...props
}: ChainOfThoughtContentProps) {
  return (
    <CollapsibleContent
      data-slot="chain-of-thought-content"
      className={cn(
        // CollapsiblePanel owns the height animation in this repo, so the
        // registry's Radix keyframes are dropped rather than ported.
        "mt-3 space-y-3 overflow-hidden",
        className
      )}
      // Steps report their status from inside this panel, and Base UI unmounts
      // it while collapsed — so without keepMounted a closed timeline registers
      // zero steps, `allStepsComplete` never turns true, and the trigger
      // shimmers forever on finished work.
      keepMounted
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
}

function hasIconInStepTitle(children: React.ReactNode): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      React.isValidElement<{ icon?: React.ReactNode }>(child) &&
      child.props.icon != null
  )
}

type ChainOfThoughtStepProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "defaultOpen" | "onOpenChange"
> & {
  status?: ChainOfThoughtStepStatus
  hasContent?: boolean
  showConnector?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  autoCloseOnComplete?: boolean
}

function ChainOfThoughtStep({
  className,
  status = "pending",
  hasContent = false,
  showConnector,
  open: openProp,
  defaultOpen = true,
  onOpenChange,
  autoCloseOnComplete = true,
  children,
  ...props
}: ChainOfThoughtStepProps) {
  const { registerStep, unregisterStep } =
    useChainOfThoughtRootContext("ChainOfThoughtStep")
  const stepId = React.useId()
  const showConnectorResolved = showConnector ?? hasIconInStepTitle(children)
  const isControlled = openProp !== undefined
  const canAutoManageOpen = !isControlled && hasContent
  const [internalOpen, setInternalOpen] = React.useState(
    () =>
      defaultOpen || (hasContent && (status === "active" || status === "error"))
  )
  const open = isControlled ? openProp : internalOpen

  React.useEffect(() => {
    registerStep(stepId, status)
    // Without this, a step that unmounts (a shorter plan, a re-rendered trail)
    // leaves its last status behind, so a stale pending/active/error entry keeps
    // allStepsComplete false or hasAnyError true forever.
    return () => unregisterStep(stepId)
  }, [registerStep, unregisterStep, status, stepId])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [isControlled, onOpenChange]
  )

  useOnChange(status, (current, previous) => {
    if (
      canAutoManageOpen &&
      (current === "active" || current === "error") &&
      previous !== current
    ) {
      setInternalOpen(true)
      onOpenChange?.(true)
      return
    }

    if (!canAutoManageOpen || !autoCloseOnComplete || previous === undefined) {
      return
    }

    if (previous !== "completed" && current === "completed") {
      setInternalOpen(false)
      onOpenChange?.(false)
    }
  })

  return (
    <ChainOfThoughtStepContext.Provider value={{ status, hasContent }}>
      <Collapsible
        data-slot="chain-of-thought-step"
        className={cn("relative w-full fade-in-0", className)}
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
        {showConnectorResolved ? (
          <div
            className={cn(
              "absolute top-4.75 -bottom-2.75 left-2 -mx-px w-px",
              status === "error" ? "bg-destructive/20" : "bg-border/50"
            )}
          ></div>
        ) : null}
      </Collapsible>
    </ChainOfThoughtStepContext.Provider>
  )
}

type ChainOfThoughtStepTitleSharedProps = {
  label?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
  collapsible?: boolean
}

type ChainOfThoughtStepTitleCollapsibleProps =
  ChainOfThoughtStepTitleSharedProps &
    Omit<React.ComponentProps<typeof CollapsibleTrigger>, "children"> & {
      collapsible: true
    }

type ChainOfThoughtStepTitleStaticProps = ChainOfThoughtStepTitleSharedProps &
  React.HTMLAttributes<HTMLDivElement> & {
    collapsible?: false
  }

type ChainOfThoughtStepTitleProps =
  | ChainOfThoughtStepTitleCollapsibleProps
  | ChainOfThoughtStepTitleStaticProps

function ChainOfThoughtStepTitle({
  className,
  label: labelProp,
  icon,
  collapsible,
  children,
  ...props
}: ChainOfThoughtStepTitleProps) {
  const { hasContent, status } = useChainOfThoughtStepContext(
    "ChainOfThoughtStepTitle"
  )
  const isCollapsible = collapsible ?? hasContent
  const isActive = status === "active"
  const isError = status === "error"
  const resolvedIcon =
    isError && icon ? (
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={1.75} className="size-4" />
    ) : (
      icon
    )
  const label = children ?? labelProp

  if (!isCollapsible) {
    const staticProps = props as React.HTMLAttributes<HTMLDivElement>

    return (
      <div
        data-slot="chain-of-thought-step-title"
        data-active={String(isActive)}
        className={cn(
          "group flex items-center text-sm leading-4.5 text-muted-foreground",
          isError && "text-destructive",
          resolvedIcon ? "gap-2" : "gap-0",
          className
        )}
        {...staticProps}
      >
        {resolvedIcon ? (
          <div className="relative flex size-4 shrink-0 items-center justify-center">
            {resolvedIcon}
          </div>
        ) : null}
        <TextShimmer
          className="truncate text-left text-sm leading-4.5 text-ellipsis whitespace-nowrap"
          spread={10}
          invertLight
          color={SHIMMER_BEAM}
          disableShimmer={!isActive}
        >
          {label}
        </TextShimmer>
      </div>
    )
  }

  return (
    <CollapsibleTrigger
      data-slot="chain-of-thought-step-title"
      data-active={String(isActive)}
      className={cn(
        "group flex w-full cursor-pointer items-center text-sm text-muted-foreground transition-colors hover:text-foreground",
        isError && "text-destructive hover:text-destructive/90",
        resolvedIcon ? "gap-2" : "gap-0",
        className
      )}
      {...(props as Omit<
        React.ComponentProps<typeof CollapsibleTrigger>,
        "children"
      >)}
    >
      {resolvedIcon ? (
        <div className="relative flex size-4 shrink-0 items-center justify-center">
          {resolvedIcon}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 items-start gap-1.25 overflow-hidden">
        <TextShimmer
          className="truncate text-left text-sm leading-4.5 text-ellipsis whitespace-nowrap"
          spread={10}
          invertLight
          color={SHIMMER_BEAM}
          disableShimmer={!isActive}
        >
          {label}
        </TextShimmer>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="ml-0.5 size-4 shrink-0 opacity-0 transition-all group-hover:opacity-100 group-data-panel-open:rotate-180 group-data-panel-open:opacity-100"
        />
      </div>
    </CollapsibleTrigger>
  )
}

type ChainOfThoughtStepContentProps = React.ComponentProps<
  typeof CollapsibleContent
>

function ChainOfThoughtStepContent({
  className,
  children,
  ...props
}: ChainOfThoughtStepContentProps) {
  return (
    <CollapsibleContent
      data-slot="chain-of-thought-step-content"
      className={cn("mt-2 ml-6 overflow-hidden", className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
}

type ChainOfThoughtCompleteProps = React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode
  label: React.ReactNode
}

function ChainOfThoughtComplete({
  className,
  icon,
  label,
  ...props
}: ChainOfThoughtCompleteProps) {
  return (
    <div
      data-slot="chain-of-thought-complete"
      className={cn(
        "mt-0 flex items-center gap-2 text-sm leading-4.5 text-muted-foreground fade-in-0",
        !icon && "gap-0",
        className
      )}
      {...props}
    >
      {icon}
      <span>{label}</span>
    </div>
  )
}

export type { ChainOfThoughtStepStatus }
export {
  ChainOfThought,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
  ChainOfThoughtStepTitle,
  ChainOfThoughtStepContent,
  ChainOfThoughtComplete,
}
