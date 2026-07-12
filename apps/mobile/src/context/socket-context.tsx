import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { type AppSocket, getSocket } from "@/lib/socket"

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
  const [socket, setSocket] = useState<AppSocket | null>(null)

  useEffect(() => {
    if (isPending || !session) return

    const s = getSocket()

    const onConnect = () => {
      if (__DEV__) console.log("[socket] connected:", s.id)
    }
    const onDisconnect = (reason: string) => {
      if (__DEV__) console.log("[socket] disconnected:", reason)
    }
    const onConnectError = (err: Error) => {
      if (__DEV__) console.error("[socket] connection error:", err.message)
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
          cb(token ? { token } : {})
        })
        .catch(() => cb({}))
    }

    setSocket(s)
    s.connect()

    return () => {
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      s.disconnect()
      setSocket(null)
    }
  }, [isPending, session])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}
