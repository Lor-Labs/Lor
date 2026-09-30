"use client"

import {
  HoverSideTooltip,
  type HoverSideTooltipSide,
} from "@repo/ui/components/hover-side-tooltip"
import { SelectItem } from "@repo/ui/components/select"
import type React from "react"

export function CustomSelectItem({
  tooltip,
  side = "right",
  ...props
}: React.ComponentProps<typeof SelectItem> & {
  tooltip?: React.ReactNode
  side?: HoverSideTooltipSide
}) {
  return (
    <HoverSideTooltip tooltip={tooltip} side={side}>
      <SelectItem {...props} />
    </HoverSideTooltip>
  )
}
