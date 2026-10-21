import { AlertCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert, AlertDescription } from "@repo/ui/components/alert"

// A failed Lor reply reads as an alert, not an answer: its text is the
// worker's failure message (error, out of credits, sandbox capacity).
export function LorFailureNotice({ text }: { text: string }) {
  return (
    <Alert variant="error" className="w-fit max-w-full">
      <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
