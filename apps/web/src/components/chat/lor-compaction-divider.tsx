import { ArrowShrink02Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

// Marks where Lor compacted its context mid-run: everything above the line
// was folded into working notes; everything below ran with the reduced
// context. Spinner while the summarizer is still running.
export function LorCompactionDivider({ active }: { active?: boolean }) {
  return (
    <div className="py-3" data-compaction-divider>
      <div className="relative flex items-center">
        <div className="h-px w-full bg-border/70" />
        <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <HugeiconsIcon
            icon={active ? Loading03Icon : ArrowShrink02Icon}
            size={12}
            strokeWidth={2}
            className={active ? "animate-spin" : undefined}
          />
          {active ? "Compacting context…" : "Compaction"}
        </span>
      </div>
    </div>
  )
}
