import { useToast } from "heroui-native/toast"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"

const STOP_REQUEST_TIMEOUT_MS = 10_000

export function useStopMerlinRun() {
  const { toast } = useToast()
  const [stoppingMessageId, setStoppingMessageId] = useState<string | null>(
    null
  )
  const activeRequestRef = useRef<{
    controller: AbortController
    messageId: string
    reportFailure: boolean
  } | null>(null)

  const requestStop = useCallback(
    async (messageId: string) => {
      if (activeRequestRef.current) return false

      const controller = new AbortController()
      activeRequestRef.current = {
        controller,
        messageId,
        reportFailure: true,
      }
      setStoppingMessageId(messageId)
      const timeout = setTimeout(
        () => controller.abort(),
        STOP_REQUEST_TIMEOUT_MS
      )

      try {
        const response = await api.v1.runs["by-message"][
          ":messageId"
        ].stop.$post(
          { param: { messageId } },
          { init: { signal: controller.signal } }
        )
        if (!response.ok) throw new Error("Couldn't stop Merlin")
        return true
      } catch {
        if (activeRequestRef.current?.reportFailure) {
          toast.show({ variant: "danger", label: "Couldn't stop Merlin" })
        }
        return false
      } finally {
        clearTimeout(timeout)
        if (activeRequestRef.current?.messageId === messageId) {
          activeRequestRef.current = null
          setStoppingMessageId(null)
        }
      }
    },
    [toast]
  )

  useEffect(
    () => () => {
      if (activeRequestRef.current) {
        activeRequestRef.current.reportFailure = false
        activeRequestRef.current.controller.abort()
      }
      activeRequestRef.current = null
    },
    []
  )

  return { requestStop, stoppingMessageId }
}
