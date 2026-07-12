import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { type AppSocket, getSocket } from "@/lib/socket"

const SocketContext = createContext<AppSocket | null>(null)

export function useSocket() {
  return useContext(SocketContext)
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<AppSocket | null>(null)

  useEffect(() => {
    const s = getSocket()

    const onConnect = () => {
      console.log("[socket] connected:", s.id)
    }
    const onDisconnect = (reason: string) => {
      console.log("[socket] disconnected:", reason)
    }
    const onConnectError = (err: Error) => {
      console.error("[socket] connection error:", err.message)
    }

    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    s.on("connect_error", onConnectError)

    setSocket(s)

    // The native WS handshake carries no cookie jar, so pass the session token
    // in the handshake auth payload — the realtime server validates it as a
    // fallback to the session cookie (same path the desktop app uses).
    let cancelled = false
    s.auth = {}
    authClient
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        const token = data?.session?.token
        s.auth = token ? { token } : {}
      })
      .catch(() => {
        if (cancelled) return
        s.auth = {}
      })
      .finally(() => {
        if (!cancelled) s.connect()
      })

    return () => {
      cancelled = true
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      s.disconnect()
      setSocket(null)
    }
  }, [])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}
