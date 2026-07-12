import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@repo/realtime-types"
import { io, type Socket } from "socket.io-client"

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export const REALTIME_URL =
  process.env.EXPO_PUBLIC_REALTIME_URL ?? "http://localhost:8000"

let socket: AppSocket | null = null

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(REALTIME_URL, {
      autoConnect: false,
      transports: ["websocket"],
      // RN's WebSocket derives Origin from the connection URL (LAN IP in dev),
      // which the realtime server's CORS check rejects — send the app scheme,
      // which is always allowlisted (same pattern as desktop's tauri origin).
      extraHeaders: { origin: "lor://" },
    })
  }
  return socket
}
