import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { type AppSocket, getSocket } from "@/lib/socket"

const SocketContext = createContext<AppSocket | null>(null)

export function useSocket() {
  return useContext(SocketContext)
}

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

export function SocketProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [socket, setSocket] = useState<AppSocket | null>(null)

  useEffect(() => {
    if (!enabled) return

    const s = getSocket()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = RECONNECT_BASE_DELAY_MS

    // The webview WS handshake can't carry the Rust cookie jar, so desktop
    // (Tauri) passes the session token in the handshake auth payload
    // (in-memory only). Re-resolved before every connect so a reconnect after
    // sleep doesn't reuse a rotated/stale token, and a failed/empty session
    // can't reconnect with a previous user's credentials.
    const resolveAuth = async () => {
      if (!isTauri) return
      s.auth = {}
      try {
        const { data } = await authClient.getSession()
        const token = data?.session?.token
        if (!cancelled) s.auth = token ? { token } : {}
      } catch {
        // leave auth empty; the server rejects and scheduleRetry backs off
      }
    }

    const connect = () => {
      if (cancelled || s.connected) return
      void resolveAuth().then(() => {
        if (!cancelled) s.connect()
      })
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
      console.log("[socket] connected:", s.id)
    }
    const onDisconnect = (reason: string) => {
      console.log("[socket] disconnected:", reason)
      if (!s.active) scheduleRetry()
    }
    const onConnectError = (err: Error) => {
      console.error("[socket] connection error:", err.message)
      if (!s.active) scheduleRetry()
    }

    // After system sleep (laptop lid closed) the socket is usually dead;
    // reconnect on wake/focus instead of waiting out ping timeouts.
    const onWake = () => {
      if (document.visibilityState === "hidden") return
      if (!s.connected && !s.active) connect()
    }

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
      if (retryTimer) clearTimeout(retryTimer)
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      document.removeEventListener("visibilitychange", onWake)
      window.removeEventListener("focus", onWake)
      window.removeEventListener("online", onWake)
      s.disconnect()
      setSocket(null)
    }
  }, [enabled])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}
