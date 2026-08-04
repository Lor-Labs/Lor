import { cn } from "@repo/ui/lib/utils"
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"

interface MerlinReasoningProps {
  text: string
  // True while reasoning is still streaming and no answer has landed yet —
  // keeps the block open and shows a live "thinking" label. Collapses when done.
  active: boolean
}

// Merlin's summarized extended-thinking, shown live while it thinks and left as
// a collapsible "thought process" once the answer lands.
export function MerlinReasoning({ text, active }: MerlinReasoningProps) {
  const [open, setOpen] = useState(active)

  // Auto-collapse once the answer starts (streaming reasoning ended).
  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground italic hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {active ? (
          <span className="shimmer">Thinking…</span>
        ) : (
          <span>Thought process</span>
        )}
      </button>
      {open && (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  )
}
