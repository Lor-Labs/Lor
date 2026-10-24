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
import { features } from "@repo/utils/features"
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
import {
  type FetchPageParams,
  fetchThreadPage,
  useThreadMessages,
} from "@/hooks/use-thread-messages"
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

// How someone enters a call, chosen on the pre-join screen.
export type JoinDevices = { microphone: boolean; camera: boolean }
const DEFAULT_DEVICES: JoinDevices = { microphone: true, camera: false }

// Where this user shows in voice presence before the server catches up: the
// call being joined or in, or the one just left. The server's push after a
// leave lands well inside this; a rejoin clears it sooner.
export type OwnVoiceChannel = {
  workspaceSlug: string
  channelId: string
  left: boolean
}
const LEFT_PRESENCE_MS = 10_000

type VoiceCallContextValue = {
  // The call this device is connected to.
  call: ActiveVoiceCall | null
  // The call this user is connected to on another device ("Transfer here").
  remoteCall: VoiceCallState | null
  joining: boolean
  ownVoiceChannel: OwnVoiceChannel | null
  // Call chat messages from others since the chat was last on screen.
  chatUnread: number
  clearChatUnread: () => void
  // Per-device CC toggle: only hides captions; transcription is always on.
  captionsOn: boolean
  toggleCaptions: () => void
  join: (target: JoinTarget, devices?: JoinDevices) => Promise<void>
  leave: () => Promise<void>
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

const VOICE_CALL_QUERY_KEY = ["voice-call"] as const
const CAPTIONS_STORAGE_KEY = "lor-voice-captions"

function readCaptionsOn() {
  try {
    return localStorage.getItem(CAPTIONS_STORAGE_KEY) !== "off"
  } catch {
    return true
  }
}

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

const disabledVoiceCall: VoiceCallContextValue = {
  call: null,
  joining: false,
  ownVoiceChannel: null,
  chatUnread: 0,
  clearChatUnread: () => {},
  captionsOn: false,
  toggleCaptions: () => {},
  join: async () => {
    throw new Error("Voice channels are unavailable")
  },
  leave: async () => {},
  remoteCall: null,
}

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  if (!features.voiceChannels) {
    return (
      <VoiceCallContext.Provider value={disabledVoiceCall}>
        {children}
      </VoiceCallContext.Provider>
    )
  }
  return <EnabledVoiceCallProvider>{children}</EnabledVoiceCallProvider>
}

// One Room for the app's lifetime: the call survives navigation, and
// remounting a room disconnects everyone.
function EnabledVoiceCallProvider({ children }: { children: ReactNode }) {
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true })
  )
  const [call, setCall] = useState<ActiveVoiceCall | null>(null)
  const [joining, setJoining] = useState(false)
  const [joiningTarget, setJoiningTarget] = useState<JoinTarget | null>(null)
  const [leftCall, setLeftCall] = useState<JoinTarget | null>(null)
  useEffect(() => {
    if (!leftCall) return
    const timer = setTimeout(() => setLeftCall(null), LEFT_PRESENCE_MS)
    return () => clearTimeout(timer)
  }, [leftCall])
  // A join in progress wins over the call it replaces.
  const presenceCall = joiningTarget ?? call
  const ownVoiceChannel = useMemo<OwnVoiceChannel | null>(
    () =>
      presenceCall
        ? {
            workspaceSlug: presenceCall.workspaceSlug,
            channelId: presenceCall.channelId,
            left: false,
          }
        : leftCall
          ? {
              workspaceSlug: leftCall.workspaceSlug,
              channelId: leftCall.channelId,
              left: true,
            }
          : null,
    [presenceCall, leftCall]
  )
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

  // The call chat loads at join and stays current for the whole call, so the
  // chat panel opens at once with every message, even ones sent while it was
  // closed. The panel reads the same thread cache.
  const chatWorkspaceSlug = call?.workspaceSlug ?? ""
  const chatChannelId = call?.channelId ?? ""
  const fetchCallChatPage = useCallback(
    (params: FetchPageParams) =>
      fetchThreadPage(
        {
          workspaceSlug: chatWorkspaceSlug,
          channelId: chatChannelId,
          threadRootId: threadRootId ?? "",
        },
        params
      ),
    [chatWorkspaceSlug, chatChannelId, threadRootId]
  )
  useThreadMessages({
    channelId: chatChannelId,
    threadRootId: threadRootId ?? "",
    fetchPage: fetchCallChatPage,
    enabled: Boolean(threadRootId),
    socket,
  })

  const [captionsOn, setCaptionsOn] = useState(readCaptionsOn)
  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      try {
        localStorage.setItem(CAPTIONS_STORAGE_KEY, on ? "off" : "on")
      } catch {}
      return !on
    })
  }, [])

  useEffect(() => {
    const handleDisconnected = (reason?: DisconnectReason) => {
      setCall(null)
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
    async (target: JoinTarget, devices: JoinDevices = DEFAULT_DEVICES) => {
      setJoining(true)
      setJoiningTarget(target)
      setLeftCall(null)
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
        if (devices.microphone) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true)
          } catch {
            toast.error("Microphone unavailable. You can still listen.")
          }
        }
        if (devices.camera) {
          try {
            await room.localParticipant.setCameraEnabled(true)
          } catch {
            toast.error("Camera unavailable")
          }
        }
      } finally {
        setJoining(false)
        setJoiningTarget(null)
      }
    },
    [room]
  )

  // The leave request is a hint; LiveKit's webhook is the authority.
  const leave = useCallback(async () => {
    const current = callRef.current
    setCall(null)
    // Until the server's push lands, the cached call would read as "in a call
    // on another device".
    if (current) {
      setLeftCall(current)
      queryClient.setQueryData<VoiceCallState | null>(
        VOICE_CALL_QUERY_KEY,
        (cached) => (cached?.sessionId === current.sessionId ? null : cached)
      )
    }
    await room.disconnect()
    if (!current) return
    void apiClient.v1.voice.sessions[":sessionId"].leave
      .$post({ param: { sessionId: current.sessionId } })
      .catch(() => undefined)
  }, [room, queryClient])

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

  // ⌘⇧M (Ctrl+Shift+M elsewhere) mutes and unmutes from anywhere in the app
  // while in a call, like Discord's; the mute tooltips show it.
  const inCall = call !== null
  useEffect(() => {
    if (!inCall) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        !event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "m"
      ) {
        return
      }
      event.preventDefault()
      const { localParticipant } = room
      localParticipant
        .setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled)
        .catch(() => toast.error("Microphone unavailable"))
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [inCall, room])

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
      ownVoiceChannel,
      chatUnread,
      clearChatUnread,
      captionsOn,
      toggleCaptions,
      join,
      leave,
    }),
    [
      call,
      remoteCall,
      joining,
      ownVoiceChannel,
      chatUnread,
      clearChatUnread,
      captionsOn,
      toggleCaptions,
      join,
      leave,
    ]
  )

  return (
    <VoiceCallContext.Provider value={value}>
      <RoomContext.Provider value={room}>
        {children}
        {call && <RoomAudioRenderer />}
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
