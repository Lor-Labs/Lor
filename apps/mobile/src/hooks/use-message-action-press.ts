import { useCallback, useEffect, useRef, useState } from "react"
import { triggerHaptic } from "@/components/ui/haptics"
import type { Message } from "@/lib/api-types"

const HIGHLIGHT_DURATION_MS = 360

export function useMessageActionPress(onOpen: (message: Message) => void) {
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = null
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const handleLongPress = useCallback(
    (message: Message) => {
      clearTimers()
      setHighlightedMessageId(message.id)
      triggerHaptic("medium")
      onOpen(message)

      highlightTimer.current = setTimeout(() => {
        setHighlightedMessageId((current) =>
          current === message.id ? null : current
        )
        highlightTimer.current = null
      }, HIGHLIGHT_DURATION_MS)
    },
    [clearTimers, onOpen]
  )

  return { handleLongPress, highlightedMessageId }
}
