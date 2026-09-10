import {
  channelRoom,
  type JoinLeaveAck,
  threadRoom,
} from "@repo/realtime-types"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import type { AppSocket } from "@/lib/socket"

type Subscription = { owners: number; dispose: () => void }
const subscriptions = new WeakMap<AppSocket, Map<string, Subscription>>()

// The route and sidebar can share a room; one unmount must not evict the other.
export function useRealtimeRoom(
  socket: AppSocket | null,
  kind: "channel" | "thread",
  id: string | undefined
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket || !id) return
    const room = kind === "channel" ? channelRoom(id) : threadRoom(id)
    let rooms = subscriptions.get(socket)
    if (!rooms) {
      rooms = new Map()
      subscriptions.set(socket, rooms)
    }
    let subscription = rooms.get(room)
    if (!subscription) {
      let disposed = false
      let generation = 0
      let delay = 1_000
      let ackTimer: ReturnType<typeof setTimeout> | undefined
      let retry: ReturnType<typeof setTimeout> | undefined
      const join = () => {
        if (retry) clearTimeout(retry)
        if (ackTimer) clearTimeout(ackTimer)
        if (disposed || !socket.connected) return
        const attempt = ++generation
        const scheduleRetry = () => {
          if (disposed || attempt !== generation) return
          generation += 1
          retry = setTimeout(join, delay)
          delay = Math.min(delay * 2, 30_000)
        }
        ackTimer = setTimeout(scheduleRetry, 10_000)
        const ack: JoinLeaveAck = (result) => {
          if (disposed || attempt !== generation || !socket.connected) return
          if (ackTimer) clearTimeout(ackTimer)
          if (!result.ok) {
            scheduleRetry()
            return
          }
          delay = 1_000
          // Cancel pre-join fetches: an initial query cannot otherwise be refetched
          // until it completes, potentially installing a snapshot from before join.
          const queryKey =
            kind === "channel" ? ["messages", id] : ["thread", id]
          void queryClient.cancelQueries({ queryKey }).then(() => {
            if (disposed || attempt !== generation || !socket.connected) return
            return queryClient.invalidateQueries({ queryKey })
          })
        }
        if (kind === "channel") {
          socket.emit("channel:join", { channelId: id }, ack)
        } else {
          socket.emit("thread:join", { threadRootId: id }, ack)
        }
      }
      socket.on("connect", join)
      join()
      subscription = {
        owners: 0,
        dispose: () => {
          disposed = true
          if (ackTimer) clearTimeout(ackTimer)
          if (retry) clearTimeout(retry)
          socket.off("connect", join)
          if (!socket.connected) return
          if (kind === "channel")
            socket.emit("channel:leave", { channelId: id })
          else socket.emit("thread:leave", { threadRootId: id })
        },
      }
      rooms.set(room, subscription)
    }
    subscription.owners += 1
    return () => {
      subscription.owners -= 1
      if (subscription.owners > 0) return
      subscription.dispose()
      rooms.delete(room)
    }
  }, [socket, kind, id, queryClient])
}
