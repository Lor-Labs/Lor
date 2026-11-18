import { StopCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { ARRIVE_IN } from "@/hooks/use-appended-ids"

// A reply someone stopped on purpose (LOR-142): a quiet note, not an error.
export function LorStoppedNote({
  by,
  arrived = false,
}: {
  by: string | null
  arrived?: boolean
}) {
  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1.5 text-xs text-muted-foreground",
        arrived && ARRIVE_IN
      )}
    >
      <HugeiconsIcon
        icon={StopCircleIcon}
        className="size-3.5 shrink-0"
        strokeWidth={1.75}
      />
      <span>{by ? `Stopped by ${by}` : "Stopped"}</span>
    </div>
  )
}
