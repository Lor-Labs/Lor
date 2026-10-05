import type { AppSocket } from "@/lib/socket"

const holders = new WeakMap<AppSocket, Map<string, number>>()

// A thread room several screens can hold at once (the call screen and its
// chat): the socket leaves only when the last holder lets go. Each holder
// rejoins on reconnect itself; a repeated join is harmless.
export function holdThreadRoom(socket: AppSocket, threadRootId: string) {
  let counts = holders.get(socket)
  if (!counts) {
    counts = new Map()
    holders.set(socket, counts)
  }
  const held = counts.get(threadRootId) ?? 0
  counts.set(threadRootId, held + 1)
  if (held === 0 && socket.connected) {
    socket.emit("thread:join", { threadRootId })
  }
  return () => {
    const left = (counts.get(threadRootId) ?? 1) - 1
    if (left > 0) {
      counts.set(threadRootId, left)
      return
    }
    counts.delete(threadRootId)
    if (socket.connected) socket.emit("thread:leave", { threadRootId })
  }
}
