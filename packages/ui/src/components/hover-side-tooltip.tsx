"use client"

import { cn } from "@repo/ui/lib/utils"
import type React from "react"
import { useState } from "react"
import { createPortal } from "react-dom"

export type HoverSideTooltipSide =
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "top-left"

const OFFSET = 8
const INSTANT_WINDOW_MS = 300

// Placed with `translate`, not `transform`: tw-animate's enter keyframes
// animate `transform` and would overwrite the placement mid-animation.
const placements: Record<HoverSideTooltipSide, [number, number]> = {
  top: [-50, -100],
  "top-right": [0, -75],
  right: [0, -50],
  "bottom-right": [0, 0],
  bottom: [-50, 0],
  "bottom-left": [-100, 0],
  left: [-100, -50],
  "top-left": [-100, -75],
}

// Moving from one item's tooltip to the next shows it without the enter animation.
let lastHiddenAt = 0

function anchorPoint(rect: DOMRect, side: HoverSideTooltipSide) {
  switch (side) {
    case "top":
      return { top: rect.top - OFFSET, left: rect.left + rect.width / 2 }
    case "top-right":
      return { top: rect.top - OFFSET, left: rect.right + OFFSET }
    case "right":
      return { top: rect.top + rect.height / 2, left: rect.right + OFFSET }
    case "bottom-right":
      return { top: rect.bottom + OFFSET, left: rect.right + OFFSET }
    case "bottom":
      return { top: rect.bottom + OFFSET, left: rect.left + rect.width / 2 }
    case "bottom-left":
      return { top: rect.bottom + OFFSET, left: rect.left - OFFSET }
    case "left":
      return { top: rect.top + rect.height / 2, left: rect.left - OFFSET }
    case "top-left":
      return { top: rect.top - OFFSET, left: rect.left - OFFSET }
  }
}

// Side tooltip for select/menu items, on hover or keyboard focus. Portaled to
// body so it can sit beside the popup instead of being clipped by its overflow.
export function HoverSideTooltip({
  tooltip,
  side = "right",
  children,
}: {
  tooltip?: React.ReactNode
  side?: HoverSideTooltipSide
  children: React.ReactNode
}) {
  const [anchor, setAnchor] = useState<{
    top: number
    left: number
    instant: boolean
  } | null>(null)

  if (!tooltip) return <>{children}</>

  const show = (target: HTMLElement) =>
    setAnchor({
      ...anchorPoint(target.getBoundingClientRect(), side),
      instant: performance.now() - lastHiddenAt < INSTANT_WINDOW_MS,
    })

  const hide = () => {
    lastHiddenAt = performance.now()
    setAnchor(null)
  }

  const [x, y] = placements[side]

  return (
    <>
      <div
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
      >
        {children}
      </div>
      {anchor &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-50 max-w-xs overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
              !anchor.instant &&
                "fade-in-0 zoom-in-98 animate-in ease-out motion-reduce:zoom-in-100"
            )}
            style={{
              top: anchor.top,
              left: anchor.left,
              translate: `${x}% ${y}%`,
              transformOrigin: `${-x}% ${-y}%`,
            }}
          >
            {tooltip}
          </div>,
          document.body
        )}
    </>
  )
}
