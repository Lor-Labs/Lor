import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { AppState } from "react-native"
import { authClient } from "@/lib/auth-client"
import { type AppSocket, getSocket } from "@/lib/socket"

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

const SocketContext = createContext<AppSocket | null>(null)

export function useSocket() {
  return useContext(SocketContext)
}

export function useSocketConnected() {
  const socket = useSocket()
  const [isConnected, setIsConnected] = useState(socket?.connected ?? false)

  useEffect(() => {
    if (!socket) {
      setIsConnected(false)
      return
    }

    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)
    setIsConnected(socket.connected)
    socket.on("connect", onConnect)
    socket.on("disconnect", onDisconnect)

    return () => {
      socket.off("connect", onConnect)
      socket.off("disconnect", onDisconnect)
    }
  }, [socket])

  return isConnected
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const queryClient = useQueryClient()
  const [socket, setSocket] = useState<AppSocket | null>(null)

  useEffect(() => {
    if (isPending || !session) return

    const s = getSocket()
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryDelay = RECONNECT_BASE_DELAY_MS
    let hadConnected = false
    let backgrounded = AppState.currentState === "background"
    const connect = () => {
      if (!cancelled && !s.connected) s.connect()
    }
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
      if (hadConnected) void queryClient.invalidateQueries()
      hadConnected = true
      if (__DEV__) console.log("[socket] connected:", s.id)
    }
    const onDisconnect = (reason: string) => {
      if (__DEV__) console.log("[socket] disconnected:", reason)
      if (!s.active) scheduleRetry()
    }
    const onConnectError = (err: Error) => {
      if (__DEV__) console.error("[socket] connection error:", err.message)
      if (!s.active) scheduleRetry()
    }

    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    s.on("connect_error", onConnectError)

    // The native WS handshake carries no cookie jar, so pass the session token
    // in the handshake auth payload — the realtime server validates it as a
    // fallback to the session cookie (same path the desktop app uses). This runs
    // on every (re)connect, so reconnects always send the current token.
    s.auth = (cb: (data: Record<string, unknown>) => void) => {
      authClient
        .getSession()
        .then(({ data }) => {
          const token = data?.session?.token
          if (!cancelled) cb(token ? { token } : {})
        })
        .catch(() => {
          if (!cancelled) cb({})
        })
    }

    const onInstructionsUpdated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-instructions"],
      })
    }
    s.on("instructions:updated", onInstructionsUpdated)
    s.on("instructions:proposal", onInstructionsUpdated)
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "background") backgrounded = true
        if (state !== "active" || cancelled) return
        // Native timers pause in background; discard a deceptively live socket.
        if (backgrounded) {
          backgrounded = false
          s.disconnect()
          void queryClient.invalidateQueries()
        }
        connect()
      }
    )

    setSocket(s)
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      appStateSubscription.remove()
      s.off("instructions:updated", onInstructionsUpdated)
      s.off("instructions:proposal", onInstructionsUpdated)
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      s.disconnect()
      setSocket(null)
    }
  }, [isPending, session, queryClient])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}
