import type { LorToolEventPayload } from "@repo/realtime-types"
import { browserStep } from "@repo/utils/browser-step"
import { useEffect, useRef } from "react"
import { useSocket } from "@/context/socket-context"

// Lor's `lor-browser show` (LOR-134), live: calls onShow once for each show
// in this thread that finished. Stored messages never call it.
export function useLorBrowserShow(
  threadRootId: string,
  enabled: boolean,
  onShow: () => void
) {
  const socket = useSocket()
  const latest = useRef(onShow)
  useEffect(() => {
    latest.current = onShow
  })

  useEffect(() => {
    if (!socket || !enabled) return
    const seen = new Set<string>()
    const onTool = (payload: LorToolEventPayload) => {
      const { toolCall } = payload
      if (payload.threadRootId !== threadRootId) return
      if (toolCall.toolName !== "bash" || toolCall.status !== "ok") return
      if (!toolCall.label.startsWith("Ran ")) return
      if (!browserStep(toolCall.label.slice(4))?.show) return
      if (seen.has(toolCall.toolCallId)) return
      seen.add(toolCall.toolCallId)
      latest.current()
    }
    socket.on("lor:tool", onTool)
    return () => {
      socket.off("lor:tool", onTool)
    }
  }, [socket, enabled, threadRootId])
}
