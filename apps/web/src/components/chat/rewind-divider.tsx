import { Undo02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { cn } from "@repo/ui/lib/utils"
import { useState } from "react"

// "Rewind to here" in the gap under one of Lor's replies (Jacob 2026-10-24:
// between turns, like Cursor's restore point, not a button in the reply's
// row). A line with a pill across the gap while the reply is hovered; it
// asks first, then spins until the server moved Lor back.
export function RewindDivider({
  restoresFiles,
  onRewind,
}: {
  restoresFiles: boolean
  // Settles when the rewind is saved or refused (the hook's toast says why).
  onRewind: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [rewinding, setRewinding] = useState(false)
  const changeOpen = (next: boolean) => {
    if (!rewinding) setOpen(next)
  }
  const confirm = async () => {
    setRewinding(true)
    try {
      await onRewind()
      setOpen(false)
    } catch {
      // The rewind hook's toast says why.
    } finally {
      setRewinding(false)
    }
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-4 -bottom-2.5 z-10 flex h-5 items-center gap-2 opacity-0 transition-opacity duration-100 group-hover:opacity-100",
        open && "opacity-100"
      )}
    >
      <div className="h-px flex-1 bg-border" />
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "flex cursor-pointer items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground group-hover:pointer-events-auto",
                open && "pointer-events-auto"
              )}
            />
          }
        >
          <HugeiconsIcon icon={Undo02Icon} size={12} strokeWidth={2} />
          Rewind to here
        </PopoverTrigger>
        <PopoverContent side="bottom" align="center" className="w-64">
          <PopoverTitle className="text-sm">Rewind to here?</PopoverTitle>
          <PopoverDescription className="mt-1.5 text-xs">
            {restoresFiles
              ? "Lor and the files go back to this reply for everyone. Later messages fold away."
              : "Lor goes back to this reply for everyone. Later messages fold away."}
          </PopoverDescription>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="xs"
              variant="ghost"
              disabled={rewinding}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              loading={rewinding}
              onClick={() => void confirm()}
            >
              Rewind
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
