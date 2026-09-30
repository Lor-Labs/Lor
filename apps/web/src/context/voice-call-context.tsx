import { RoomAudioRenderer, RoomContext } from "@livekit/components-react"
import { authClient } from "@repo/auth/client"
import type { RealtimeMessage } from "@repo/realtime-types"
import type { VoiceCallState } from "@repo/realtime-types/events"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useBlocker } from "@tanstack/react-router"
import { listen } from "@tauri-apps/api/event"
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
} from "livekit-client"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useSocket } from "@/context/socket-context"
import { useRealtimeRoom } from "@/hooks/use-realtime-room"
import { apiClient } from "@/lib/api-client"

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

export type ActiveVoiceCall = {
  sessionId: string
  // The session chat's thread root.
  threadRootId: string | null
  workspaceSlug: string
  channelId: string
  channelName: string
}

export type JoinTarget = Omit<ActiveVoiceCall, "sessionId" | "threadRootId">

type VoiceCallContextValue = {
  // The call this device is connected to.
  call: ActiveVoiceCall | null
  // The call this user is connected to on another device ("Transfer here").
  remoteCall: VoiceCallState | null
  joining: boolean
  // Call chat messages from others since the chat was last on screen.
  chatUnread: number
  clearChatUnread: () => void
  // Deafen mutes everyone else and the microphone; undeafen restores the
  // microphone to how it was.
  deafened: boolean
  toggleDeafen: () => Promise<void>
  join: (target: JoinTarget) => Promise<void>
  leave: () => Promise<void>
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

const VOICE_CALL_QUERY_KEY = ["voice-call"] as const

function disconnectMessage(reason: DisconnectReason) {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "The call moved to another device."
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "You were disconnected from the call."
    default:
      return `The call ended (${DisconnectReason[reason] ?? "unknown reason"}).`
  }
}

// One Room for the app's lifetime: the call survives navigation, and
// remounting a room disconnects everyone.
export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true })
  )
  const [call, setCall] = useState<ActiveVoiceCall | null>(null)
  const [joining, setJoining] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const microphoneBeforeDeafen = useRef(true)
  const callRef = useRef(call)
  callRef.current = call
  const socket = useSocket()
  const queryClient = useQueryClient()

  // Server view of the user's call on any device; pushes replace it.
  const { data: serverCall } = useQuery({
    queryKey: VOICE_CALL_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.v1.voice.call.$get()
      if (!res.ok) throw new Error("Failed to load call state")
      return (await res.json()).call
    },
  })
  useEffect(() => {
    if (!socket) return
    const onCallUpdated = ({ call }: { call: VoiceCallState | null }) => {
      queryClient.setQueryData(VOICE_CALL_QUERY_KEY, call)
    }
    socket.on("voice:call:updated", onCallUpdated)
    return () => {
      socket.off("voice:call:updated", onCallUpdated)
    }
  }, [socket, queryClient])
  const remoteCall =
    serverCall && serverCall.sessionId !== call?.sessionId ? serverCall : null

  // The server adds this user's sockets to the call chat room when LiveKit
  // reports the join; this keeps the room across socket reconnects.
  const threadRootId = call?.threadRootId ?? undefined
  useRealtimeRoom(socket, "thread", threadRootId)
  const { data: authSession } = authClient.useSession()
  const userId = authSession?.user.id
  const [chatUnread, setChatUnread] = useState(0)
  useEffect(() => {
    setChatUnread(0)
    if (!socket || !threadRootId) return
    const onMessageCreated = (message: RealtimeMessage) => {
      if (message.threadRootId === threadRootId && message.author.id !== userId)
        setChatUnread((count) => count + 1)
    }
    socket.on("message:created", onMessageCreated)
    return () => {
      socket.off("message:created", onMessageCreated)
    }
  }, [socket, threadRootId, userId])
  const clearChatUnread = useCallback(() => setChatUnread(0), [])

  useEffect(() => {
    const handleDisconnected = (reason?: DisconnectReason) => {
      setCall(null)
      setDeafened(false)
      if (
        reason !== undefined &&
        reason !== DisconnectReason.CLIENT_INITIATED
      ) {
        toast.error(disconnectMessage(reason))
      }
    }
    room.on(RoomEvent.Disconnected, handleDisconnected)
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected)
      void room.disconnect()
    }
  }, [room])

  const join = useCallback(
    async (target: JoinTarget) => {
      setJoining(true)
      try {
        if (room.state !== ConnectionState.Disconnected) {
          await room.disconnect()
        }
        const res = await apiClient.v1.channels[":channelId"].voice.join.$post({
          param: { channelId: target.channelId },
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.message ?? "Could not join the call")
        }
        const { url, token, sessionId, threadRootId } = await res.json()
        await room.connect(url, token)
        setCall({ ...target, sessionId, threadRootId })
        setDeafened(false)
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
        } catch {
          toast.error("Microphone unavailable. You can still listen.")
        }
      } finally {
        setJoining(false)
      }
    },
    [room]
  )

  const toggleDeafen = useCallback(async () => {
    const { localParticipant } = room
    if (deafened) {
      setDeafened(false)
      if (microphoneBeforeDeafen.current) {
        await localParticipant.setMicrophoneEnabled(true)
      }
      return
    }
    microphoneBeforeDeafen.current = localParticipant.isMicrophoneEnabled
    setDeafened(true)
    await localParticipant.setMicrophoneEnabled(false)
  }, [room, deafened])

  // The leave request is a hint; LiveKit's webhook is the authority.
  const leave = useCallback(async () => {
    const current = callRef.current
    setCall(null)
    await room.disconnect()
    if (!current) return
    void apiClient.v1.voice.sessions[":sessionId"].leave
      .$post({ param: { sessionId: current.sessionId } })
      .catch(() => undefined)
  }, [room])

  // Closing the macOS window hides it; a hidden window must not keep the
  // microphone live.
  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    let stop: (() => void) | undefined
    listen("main-window-hidden", () => {
      if (callRef.current) void leave()
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else stop = unlisten
      })
      .catch((error) => {
        console.error("[voice] failed to listen for window hide:", error)
      })
    return () => {
      disposed = true
      stop?.()
    }
  }, [leave])

  // The call follows the user everywhere except across workspaces.
  const blocker = useBlocker({
    shouldBlockFn: ({ next }) => {
      const current = callRef.current
      if (!current) return false
      const nextSlug = (next.params as { workspaceSlug?: string }).workspaceSlug
      return Boolean(nextSlug && nextSlug !== current.workspaceSlug)
    },
    enableBeforeUnload: false,
    withResolver: true,
  })

  const value = useMemo(
    () => ({
      call,
      remoteCall,
      joining,
      chatUnread,
      clearChatUnread,
      deafened,
      toggleDeafen,
      join,
      leave,
    }),
    [
      call,
      remoteCall,
      joining,
      chatUnread,
      clearChatUnread,
      deafened,
      toggleDeafen,
      join,
      leave,
    ]
  )

  return (
    <VoiceCallContext.Provider value={value}>
      <RoomContext.Provider value={room}>
        {children}
        {call && <RoomAudioRenderer muted={deafened} />}
      </RoomContext.Provider>
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave the call?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching workspaces ends your call in {call?.channelName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Stay
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                void leave().then(() => blocker.proceed?.())
              }}
            >
              Leave call
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </VoiceCallContext.Provider>
  )
}

export function useVoiceCall() {
  const context = useContext(VoiceCallContext)
  if (!context) {
    throw new Error("useVoiceCall must be used within VoiceCallProvider")
  }
  return context
}
