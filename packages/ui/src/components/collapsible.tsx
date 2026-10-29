"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cn } from "@repo/ui/lib/utils"
import type React from "react"
import { useState } from "react"

export function Collapsible({
  ...props
}: CollapsiblePrimitive.Root.Props): React.ReactElement {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

export function CollapsibleTrigger({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props): React.ReactElement {
  return (
    <CollapsiblePrimitive.Trigger
      className={className}
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

export function CollapsiblePanel({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props): React.ReactElement {
  return (
    <CollapsiblePrimitive.Panel
      className={cn(
        "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      data-slot="collapsible-panel"
      {...props}
    />
  )
}

// A fold whose toggle lives elsewhere ("Show more", a row click): animates
// open and closed, and unmounts its content once closed. While closing it
// keeps showing what it last showed open, so callers can pass
// `{open && content}` and skip building content that is folded away.
export function Reveal({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  const [openContent, setOpenContent] = useState(children)
  if (open && openContent !== children) setOpenContent(children)
  return (
    <CollapsiblePrimitive.Root open={open}>
      <CollapsiblePanel className={className}>
        {open ? children : openContent}
      </CollapsiblePanel>
    </CollapsiblePrimitive.Root>
  )
}

export { CollapsiblePrimitive, CollapsiblePanel as CollapsibleContent }
