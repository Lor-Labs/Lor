import { Button } from "@repo/ui/components/button"
import { Popover, PopoverPopup } from "@repo/ui/components/popover"
import { type ReactNode, type RefObject, useEffect, useState } from "react"

// Lets the anchor settle (route change, sidebar animation) before pointing.
const SHOW_DELAY_MS = 600

// One-sentence hint anchored to the thing it explains. Non-modal, never takes
// focus, and only Got it or doing the thing closes it: an outside click would
// lose the hint for good.
export function HintPopover({
  open,
  anchor,
  side = "top",
  align = "center",
  onDismiss,
  children,
}: {
  open: boolean
  anchor: RefObject<HTMLElement | null>
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  onDismiss: () => void
  children: ReactNode
}) {
  const [delayed, setDelayed] = useState(false)

  useEffect(() => {
    if (!open) {
      setDelayed(false)
      return
    }
    const id = setTimeout(() => setDelayed(true), SHOW_DELAY_MS)
    return () => clearTimeout(id)
  }, [open])

  return (
    <Popover open={open && delayed} modal={false}>
      <PopoverPopup
        anchor={anchor}
        side={side}
        align={align}
        sideOffset={12}
        arrow
        initialFocus={false}
        finalFocus={false}
        className="max-w-80 motion-reduce:transition-none"
        viewportClassName="py-3"
      >
        <div className="flex items-start gap-3">
          <p className="text-sm text-pretty">{children}</p>
          <Button
            size="xs"
            variant="secondary"
            className="shrink-0"
            onClick={onDismiss}
          >
            Got it
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  )
}
