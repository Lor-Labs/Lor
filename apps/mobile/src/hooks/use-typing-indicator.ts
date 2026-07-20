import type { TypingIndicatorEvent } from "@repo/realtime-types"
import { useCallback, useEffect, useRef, useState } from "react"
import type { AppSocket } from "@/lib/socket"

export type TypingUser = {
  userId: string
  name: string
  expiresAt: number
}

const TYPING_THROTTLE_MS = 3000
const TYPING_EXPIRE_MS = 5000

export function useTypingIndicator({
  socket,
  channelId,
  currentUserId,
  threadRootId,
}: {
  socket: AppSocket | null
  channelId: string
  currentUserId: string | undefined
  // When set, the hook scopes to a thread: it emits + only listens for typing
  // in that thread, ignoring channel-level typing (and vice-versa).
  threadRootId?: string
}) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const lastEmitRef = useRef(0)

  const emitTyping = useCallback(() => {
    if (!socket?.connected || !channelId) return
    const now = Date.now()
    if (now - lastEmitRef.current < TYPING_THROTTLE_MS) return
    lastEmitRef.current = now
    socket.emit("typing:start", { channelId, threadRootId })
  }, [socket, channelId, threadRootId])

  useEffect(() => {
    if (!socket) return

    const onTypingUpdate = (payload: TypingIndicatorEvent) => {
      if (payload.channelId !== channelId) return
      if ((payload.threadRootId ?? undefined) !== threadRootId) return
      if (payload.userId === currentUserId) return

      setTypingUsers((prev) => {
        const expiresAt = Date.now() + TYPING_EXPIRE_MS
        const existing = prev.find((user) => user.userId === payload.userId)
        if (existing) {
          return prev.map((user) =>
            user.userId === payload.userId ? { ...user, expiresAt } : user
          )
        }
        return [
          ...prev,
          { userId: payload.userId, name: payload.name, expiresAt },
        ]
      })
    }

    socket.on("typing:update", onTypingUpdate)

    return () => {
      socket.off("typing:update", onTypingUpdate)
    }
  }, [socket, channelId, currentUserId, threadRootId])

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setTypingUsers((prev) => {
        const active = prev.filter((user) => user.expiresAt > now)
        return active.length === prev.length ? prev : active
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setTypingUsers([])
    lastEmitRef.current = 0
  }, [channelId, threadRootId])

  return { typingUsers, emitTyping }
}
