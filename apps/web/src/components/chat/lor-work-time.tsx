import { Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { formatWorkTime } from "@repo/utils/date"
import { useEffect, useState } from "react"
import type { Message } from "@/lib/api-types"

// A Lor reply's work time runs from its run's start (the reply's creation
// until a worker claims it) to its finish.
export function lorWorkStart(message: Message): string {
  return message.lorRun?.startedAt ?? message.createdAt
}

export function lorWorkedMs(message: Message): number | null {
  const finishedAt = message.lorRun?.finishedAt
  if (!finishedAt) return null
  const ms = Date.parse(finishedAt) - Date.parse(lorWorkStart(message))
  return Number.isFinite(ms) ? ms : null
}

// "Working for 1m 12s" above an in-flight Lor reply, ticking each second.
export function LorWorkingFor({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
      <HugeiconsIcon
        icon={Loading03Icon}
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        strokeWidth={2}
      />
      <span className="tabular-nums">
        Working for {formatWorkTime(now - Date.parse(since))}
      </span>
    </div>
  )
}
