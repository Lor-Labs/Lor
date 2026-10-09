import type { ChannelActivity } from "@repo/realtime-types"
import { useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { isAppFocused, subscribeAppFocus } from "@/lib/app-focus"

const POLL_MS = 15_000
// Bursty invalidations (run transition + plan update) collapse into one
// snapshot request. Fixed deadline: a constant stream cannot postpone it.
const COALESCE_MS = 100

// Lor channel activity and the user's session rows for the sidebar.
// Push-invalidated: workspace:activity:updated triggers a coalesced refetch;
// the poll is recovery for missed emits, not the update mechanism.
export function useWorkspaceActivity(workspaceId?: string) {
  const socket = useSocket()
  const [snapshot, setSnapshot] = useState<{
    workspaceId: string
    channels: ChannelActivity[]
  } | null>(null)

  useEffect(() => {
    setSnapshot(null)
    if (!socket || !workspaceId) return
    let disposed = false
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let coalesceTimer: ReturnType<typeof setTimeout> | undefined
    let pending = false
    let refreshQueued = false
    let failures = 0
    let previous = ""
    const clear = () => {
      generation += 1
      pending = false
      refreshQueued = false
      failures = 0
      previous = ""
      if (timer) clearTimeout(timer)
      if (coalesceTimer) {
        clearTimeout(coalesceTimer)
        coalesceTimer = undefined
      }
      setSnapshot(null)
    }
    const refresh = () => {
      if (disposed || !socket.connected || !isAppFocused()) return
      if (pending) {
        refreshQueued = true
        return
      }
      if (timer) clearTimeout(timer)
      pending = true
      const attempt = ++generation
      const fail = () => {
        if (disposed || attempt !== generation) return
        // Invalidate the attempt: an ack landing after the timeout must not
        // fail the same attempt twice or clobber the scheduled retry.
        generation += 1
        pending = false
        failures += 1
        // Keep the last healthy snapshot through a transient failure; only
        // repeated failure clears it so stale data can't pose as current.
        if (failures >= 3) {
          previous = ""
          setSnapshot(null)
        }
        timer = setTimeout(refresh, 5_000)
      }
      timer = setTimeout(fail, 10_000)
      socket.emit("workspace:activity", { workspaceId }, (result) => {
        if (disposed || attempt !== generation) return
        if (timer) clearTimeout(timer)
        if (!result.ok) {
          fail()
          return
        }
        pending = false
        failures = 0
        const serialized = JSON.stringify(result.channels)
        if (serialized !== previous) {
          previous = serialized
          setSnapshot({ workspaceId, channels: result.channels })
        }
        if (refreshQueued) {
          refreshQueued = false
          timer = setTimeout(refresh, 0)
        } else {
          timer = setTimeout(refresh, POLL_MS)
        }
      })
    }
    const scheduleRefresh = () => {
      if (coalesceTimer) return
      coalesceTimer = setTimeout(() => {
        coalesceTimer = undefined
        refresh()
      }, COALESCE_MS)
    }
    const onActivityUpdated = (payload: { workspaceId: string }) => {
      if (payload.workspaceId === workspaceId) scheduleRefresh()
    }
    const unsubscribe = subscribeAppFocus((focused) => {
      if (focused) refresh()
      else clear()
    })
    socket.on("connect", refresh)
    socket.on("disconnect", clear)
    socket.on("workspace:activity:updated", onActivityUpdated)
    // Reading a session (on any of the user's devices) clears its unread dot.
    socket.on("thread-read:updated", scheduleRefresh)
    refresh()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (coalesceTimer) clearTimeout(coalesceTimer)
      unsubscribe()
      socket.off("connect", refresh)
      socket.off("disconnect", clear)
      socket.off("workspace:activity:updated", onActivityUpdated)
      socket.off("thread-read:updated", scheduleRefresh)
    }
  }, [socket, workspaceId])

  return snapshot?.workspaceId === workspaceId ? snapshot?.channels : undefined
}
