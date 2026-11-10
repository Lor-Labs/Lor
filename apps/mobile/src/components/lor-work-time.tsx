import { formatWorkTime } from "@repo/utils/date"
import { useEffect, useState } from "react"
import { Text } from "react-native"
import { Shimmer } from "@/components/shimmer"
import type { Message } from "@/lib/api-types"

// Web lor-work-time.tsx port. A Lor reply's work time runs from its run's
// start (the reply's creation until a worker claims it) to its finish.
export function lorWorkStart(message: Message): string {
  return message.lorRun?.startedAt ?? message.createdAt
}

export function lorWorkedMs(message: Message): number | null {
  const finishedAt = message.lorRun?.finishedAt
  if (!finishedAt) return null
  return Date.parse(finishedAt) - Date.parse(lorWorkStart(message))
}

// "Working for 1m 12s" under an in-flight Lor reply, ticking each second.
export function LorWorkingFor({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Shimmer>
      <Text
        className="mt-one text-xs text-muted"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        Working for {formatWorkTime(now - Date.parse(since))}
      </Text>
    </Shimmer>
  )
}
