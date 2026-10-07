import { cn } from "@repo/ui/lib/utils"
import { TextMorph } from "torph/react"

// torph pins `will-change` on every segment; idle segments drop it so labels
// don't each hold compositor layers. WAAPI promotes them only mid-morph.
const IDLE_LAYERS =
  "[&_[torph-item]]:will-change-auto [&_[torph-slot]>span]:will-change-auto"

// Text that morphs between values (shared characters glide, digits roll).
// torph forces layout reads on mount, so pass `live={false}` for text that
// can't change while mounted (settled history rows) to render a plain span.
export function MorphText({
  children,
  className,
  live = true,
}: {
  children: string
  className?: string
  live?: boolean
}) {
  if (!live) return <span className={className}>{children}</span>
  return (
    <TextMorph className={cn(IDLE_LAYERS, className)}>{children}</TextMorph>
  )
}
