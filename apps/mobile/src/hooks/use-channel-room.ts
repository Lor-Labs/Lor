import { useEffect } from "react"
import type { AppSocket } from "@/lib/socket"

const memberships = new WeakMap<
  AppSocket,
  Map<string, { count: number; leave: () => void }>
>()

// Channel and directly opened thread screens share one room subscription.
export function useChannelRoom(socket: AppSocket | null, channelId: string) {
  useEffect(() => {
    if (!socket || !channelId) return
    let rooms = memberships.get(socket)
    if (!rooms) {
      rooms = new Map()
      memberships.set(socket, rooms)
    }
    let entry = rooms.get(channelId)
    if (!entry) {
      const join = () => socket.emit("channel:join", { channelId })
      socket.on("connect", join)
      if (socket.connected) join()
      entry = {
        count: 0,
        leave: () => {
          socket.off("connect", join)
          if (socket.connected) socket.emit("channel:leave", { channelId })
        },
      }
      rooms.set(channelId, entry)
    }
    const membership = entry
    const channelRooms = rooms
    membership.count += 1
    return () => {
      membership.count -= 1
      if (membership.count === 0) {
        membership.leave()
        channelRooms.delete(channelId)
      }
    }
  }, [socket, channelId])
}
