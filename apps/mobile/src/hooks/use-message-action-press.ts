import { useCallback, useEffect, useRef, useState } from "react"
import { triggerHaptic } from "@/components/ui/haptics"
import type { Message } from "@/lib/api-types"

const MENU_OPEN_DELAY_MS = 110
const HIGHLIGHT_DURATION_MS = 360

export function useMessageActionPress(onOpen: (message: Message) => void) {
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    openTimer.current = null
    highlightTimer.current = null
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const handleLongPress = useCallback(
    (message: Message) => {
      clearTimers()
      setHighlightedMessageId(message.id)
      triggerHaptic("medium")

      openTimer.current = setTimeout(() => {
        onOpen(message)
        openTimer.current = null
      }, MENU_OPEN_DELAY_MS)

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
