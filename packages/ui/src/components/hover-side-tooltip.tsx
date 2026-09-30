"use client"

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

const transforms: Record<HoverSideTooltipSide, string> = {
  top: "translate(-50%, -100%)",
  "top-right": "translate(0, -75%)",
  right: "translate(0, -50%)",
  "bottom-right": "translate(0, 0)",
  bottom: "translate(-50%, 0)",
  "bottom-left": "translate(-100%, 0)",
  left: "translate(-100%, -50%)",
  "top-left": "translate(-100%, -75%)",
}

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

// Hover-only side tooltip for select/menu items. Portaled to body so it can
// sit beside the popup instead of being clipped by its overflow.
export function HoverSideTooltip({
  tooltip,
  side = "right",
  children,
}: {
  tooltip?: React.ReactNode
  side?: HoverSideTooltipSide
  children: React.ReactNode
}) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null
  )

  if (!tooltip) return <>{children}</>

  return (
    <>
      <div
        onMouseEnter={(e) =>
          setAnchor(anchorPoint(e.currentTarget.getBoundingClientRect(), side))
        }
        onMouseLeave={() => setAnchor(null)}
      >
        {children}
      </div>
      {anchor &&
        createPortal(
          <div
            className="animate-in fade-in-0 zoom-in-95 pointer-events-none fixed z-50 max-w-xs overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md"
            style={{
              top: anchor.top,
              left: anchor.left,
              transform: transforms[side],
            }}
          >
            {tooltip}
          </div>,
          document.body
        )}
    </>
  )
}
