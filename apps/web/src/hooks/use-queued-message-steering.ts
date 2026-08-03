import { useMutation } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"

export function useQueuedMessageSteering({
  messages,
  currentUserId,
  pendingNonces,
}: {
  messages: Message[]
  currentUserId: string | undefined
  pendingNonces?: { current: Set<string> }
}) {
  const [steerWhenReady, setSteerWhenReady] = useState(false)
  const steerWhenReadyRef = useRef(false)
  const steerWhenReadyScopeRef = useRef<string | null>(null)
  steerWhenReadyRef.current = steerWhenReady

  const latestOwnMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.authorId === currentUserId) ?? null,
    [currentUserId, messages]
  )

  const steer = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiClient.v1.runs["queued-messages"][
        ":messageId"
      ].steer.$post({ param: { messageId } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't steer this message")
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const steerMessage = useCallback(
    (message: Message) => {
      if (steer.isPending || pendingNonces?.current.has(message.id)) return
      steer.mutate(message.id)
    },
    [pendingNonces, steer]
  )

  const steerLatestOwnMessage = useCallback(() => {
    if (!latestOwnMessage || steer.isPending || steerWhenReadyRef.current) {
      return
    }
    if (pendingNonces?.current.has(latestOwnMessage.id)) {
      steerWhenReadyRef.current = true
      steerWhenReadyScopeRef.current = `${latestOwnMessage.channelId}:${latestOwnMessage.threadRootId ?? "channel"}`
      setSteerWhenReady(true)
      return
    }
    steer.mutate(latestOwnMessage.id)
  }, [latestOwnMessage, pendingNonces, steer])

  // A thread send appears in the queue immediately under its optimistic
  // nonce. If Enter is pressed again before the server echo swaps in the real
  // id, remember the intent and steer as soon as that id is actionable.
  useEffect(() => {
    if (!steerWhenReady) return
    const latestScope = latestOwnMessage
      ? `${latestOwnMessage.channelId}:${latestOwnMessage.threadRootId ?? "channel"}`
      : null
    if (
      latestScope &&
      steerWhenReadyScopeRef.current &&
      latestScope !== steerWhenReadyScopeRef.current
    ) {
      steerWhenReadyRef.current = false
      steerWhenReadyScopeRef.current = null
      setSteerWhenReady(false)
      return
    }
    if (latestOwnMessage && !pendingNonces?.current.has(latestOwnMessage.id)) {
      steerWhenReadyRef.current = false
      steerWhenReadyScopeRef.current = null
      setSteerWhenReady(false)
      steer.mutate(latestOwnMessage.id)
      return
    }
    if (!latestOwnMessage && (pendingNonces?.current.size ?? 0) === 0) {
      steerWhenReadyRef.current = false
      steerWhenReadyScopeRef.current = null
      setSteerWhenReady(false)
    }
  }, [latestOwnMessage, pendingNonces, steer, steerWhenReady])

  return {
    canSteerLatestOwnMessage: Boolean(latestOwnMessage),
    isSteering: steer.isPending || steerWhenReady,
    steerLatestOwnMessage,
    steerMessage,
    steeringMessageId: steer.isPending
      ? (steer.variables ?? null)
      : steerWhenReady
        ? (latestOwnMessage?.id ?? null)
        : null,
  }
}
