import { AlertCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert, AlertDescription } from "@repo/ui/components/alert"
import { cn } from "@repo/ui/lib/utils"
import { ARRIVE_IN } from "@/hooks/use-appended-ids"

// A failed Lor reply reads as an alert, not an answer: its text is the
// worker's failure message (error, out of credits, sandbox capacity).
// `arrived` eases it in when it replaces a reply that was in flight.
export function LorFailureNotice({
  text,
  arrived = false,
}: {
  text: string
  arrived?: boolean
}) {
  return (
    <Alert
      variant="error"
      className={cn("w-fit max-w-full", arrived && ARRIVE_IN)}
    >
      <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
