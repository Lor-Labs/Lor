import { cn } from "@repo/ui/lib/utils"
import type { ReactNode } from "react"

// A composer row (reply bar, attachments) that eases its height open and shut
// through grid rows 0fr/1fr, so the editor slides rather than jumps. Callers
// keep the last content rendered while it closes.
export function ComposerCollapse({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}
