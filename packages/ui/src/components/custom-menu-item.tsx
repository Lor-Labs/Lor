"use client"

import {
  HoverSideTooltip,
  type HoverSideTooltipSide,
} from "@repo/ui/components/hover-side-tooltip"
import { MenuItem } from "@repo/ui/components/menu"
import type React from "react"

export function CustomMenuItem({
  tooltip,
  side = "right",
  ...props
}: React.ComponentProps<typeof MenuItem> & {
  tooltip?: React.ReactNode
  side?: HoverSideTooltipSide
}) {
  return (
    <HoverSideTooltip tooltip={tooltip} side={side}>
      <MenuItem {...props} />
    </HoverSideTooltip>
  )
}
