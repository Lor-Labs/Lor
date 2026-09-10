import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import {
  resetMerlinReplayState,
  useMerlinStream,
} from "@/hooks/use-merlin-stream"
import { type AppSocket, getSocket } from "@/lib/socket"

const SocketContext = createContext<AppSocket | null>(null)

export function useSocket() {
  return useContext(SocketContext)
}

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

// Message/thread queries reconcile after room joins; these caches use other events.
const RECONNECT_QUERY_KEYS = new Set<unknown>([
  "channel-tasks",
  "task",
  "task-artifacts",
  "channel-approvals",
  "channel-proposals",
  "channel-loops",
  "loop-runs",
  "thread-context",
  "thread-activity",
  "pinned-messages",
  "workspace-instructions",
  "channels",
  "channel",
  "projects",
  "project",
  "billing",
  "channel-mutes",
])

export function SocketProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [socket, setSocket] = useState<AppSocket | null>(null)
  const queryClient = useQueryClient()
  useMerlinStream({ socket, queryClient })

  useEffect(() => {
    if (!enabled) return

    const s = getSocket()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = RECONNECT_BASE_DELAY_MS
    let needsRecovery = false
    let disconnectingForWake = false

    // Socket.IO invokes auth on automatic reconnects too; desktop tokens rotate.
    let authGeneration = 0
    let authTimer: ReturnType<typeof setTimeout> | undefined
    s.auth = isTauri
      ? (callback) => {
          if (authTimer) clearTimeout(authTimer)
          const generation = ++authGeneration
          let finished = false
          const finish = (token?: string) => {
            if (finished || cancelled || generation !== authGeneration) return
            finished = true
            if (authTimer) clearTimeout(authTimer)
            callback(token ? { token } : {})
          }
          authTimer = setTimeout(() => finish(), 10_000)
          void authClient.getSession().then(
            ({ data }) => finish(data?.session?.token),
            () => finish()
          )
        }
      : {}

    const connect = () => {
      if (!cancelled && !s.connected) s.connect()
    }

    // socket.io stops reconnecting entirely when the server rejects the
    // handshake in middleware (rate limit, auth hiccup) or force-disconnects
    // the socket — socket.active goes false and no retry is scheduled. Without
    // a manual retry the app stays disconnected (and the user shows offline)
    // until relaunch.
    const scheduleRetry = () => {
      if (cancelled || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_DELAY_MS)
        connect()
      }, retryDelay)
    }

    const onConnect = () => {
      retryDelay = RECONNECT_BASE_DELAY_MS
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      console.log("[socket] connected:", s.id)
      resetMerlinReplayState()
      if (needsRecovery) {
        void queryClient.invalidateQueries()
      } else {
        void queryClient.invalidateQueries({
          predicate: (query) => RECONNECT_QUERY_KEYS.has(query.queryKey[0]),
        })
      }
      needsRecovery = false
    }
    const onDisconnect = (reason: string) => {
      console.log("[socket] disconnected:", reason)
      if (!disconnectingForWake) needsRecovery = true
      if (!s.active) scheduleRetry()
    }
    const onConnectError = (err: Error) => {
      console.error("[socket] connection error:", err.message)
      needsRecovery = true
      if (!s.active) scheduleRetry()
    }

    // A suspended webview can still report connected after its server socket died.
    let lastWake = 0
    let wasHidden = document.visibilityState === "hidden"
    const onWake = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true
        return
      }
      const resumedFromHidden = wasHidden
      wasHidden = false
      // Hidden resumes need recovery even inside an ordinary focus cooldown.
      if (!resumedFromHidden && Date.now() - lastWake < 5_000) return
      lastWake = Date.now()
      authGeneration += 1
      if (authTimer) clearTimeout(authTimer)
      if (resumedFromHidden || !s.connected) needsRecovery = true
      // The synchronous client disconnect is intentional, not connection loss.
      disconnectingForWake = true
      s.disconnect()
      disconnectingForWake = false
      connect()
    }

    const onInstructionsUpdated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-instructions"],
      })
    }
    s.on("instructions:updated", onInstructionsUpdated)
    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    s.on("connect_error", onConnectError)
    document.addEventListener("visibilitychange", onWake)
    window.addEventListener("focus", onWake)
    window.addEventListener("online", onWake)

    setSocket(s)
    connect()

    return () => {
      cancelled = true
      if (authTimer) clearTimeout(authTimer)
      if (retryTimer) clearTimeout(retryTimer)
      s.off("instructions:updated", onInstructionsUpdated)
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      document.removeEventListener("visibilitychange", onWake)
      window.removeEventListener("focus", onWake)
      window.removeEventListener("online", onWake)
      s.disconnect()
      setSocket(null)
    }
  }, [enabled, queryClient])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}
