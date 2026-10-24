import { RoomContext } from "@livekit/react-native"
import type { RealtimeMessage } from "@repo/realtime-types"
import { features } from "@repo/utils/features"
import * as SecureStore from "expo-secure-store"
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
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
import { Alert } from "react-native"
import { useSocket } from "@/context/socket-context"
import { listenForCaptions } from "@/hooks/use-call-captions"
import { api, responseMessage } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { holdThreadRoom } from "@/lib/thread-rooms"

export type ActiveVoiceCall = {
  sessionId: string
  // The call chat's thread root.
  threadRootId: string | null
  workspaceId: string
  channelId: string
  channelName: string
  connectedAt: number
}

export type JoinTarget = Pick<
  ActiveVoiceCall,
  "workspaceId" | "channelId" | "channelName"
>

// Where this user shows in voice presence before the server catches up: the
// call being joined or in, or the one just left. The server's push after a
// leave lands well inside this; a rejoin clears it sooner. Same as web.
export type OwnVoiceChannel = {
  workspaceId: string
  channelId: string
  left: boolean
}
const LEFT_PRESENCE_MS = 10_000

export type CameraFacing = "user" | "environment"

// How someone enters a call, chosen on the pre-join screen.
export type JoinDevices = {
  microphone: boolean
  camera: boolean
  facing: CameraFacing
}
const DEFAULT_DEVICES: JoinDevices = {
  microphone: true,
  camera: false,
  facing: "user",
}

type VoiceCallContextValue = {
  // The call this phone is connected to.
  call: ActiveVoiceCall | null
  joining: boolean
  ownVoiceChannel: OwnVoiceChannel | null
  join: (target: JoinTarget, devices?: JoinDevices) => Promise<void>
  leave: () => Promise<void>
  // Front or back camera; your own video is mirrored only for the front.
  cameraFacing: CameraFacing
  flipCamera: () => Promise<void>
  // Per-device CC toggle, like web's: it only hides the stage's captions.
  captionsOn: boolean
  toggleCaptions: () => void
  // Other people's call chat messages since the chat was last on screen.
  chatUnread: number
  clearChatUnread: () => void
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

const CAPTIONS_KEY = "lor.voice-captions"

function disconnectMessage(reason: DisconnectReason) {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "The call moved to another device."
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "You were removed from the call."
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
  cameraFacing: "user",
  flipCamera: async () => {},
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

// One Room for the app's lifetime, so the call survives navigation; the call
// bar brings you back to it. Same rules as web's VoiceCallProvider.
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
            workspaceId: presenceCall.workspaceId,
            channelId: presenceCall.channelId,
            left: false,
          }
        : leftCall
          ? {
              workspaceId: leftCall.workspaceId,
              channelId: leftCall.channelId,
              left: true,
            }
          : null,
    [presenceCall, leftCall]
  )
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user")
  const facingRef = useRef(cameraFacing)
  facingRef.current = cameraFacing
  const flippingRef = useRef(false)
  const [captionsOn, setCaptionsOn] = useState(true)
  const captionsRef = useRef(captionsOn)
  captionsRef.current = captionsOn
  const callRef = useRef(call)
  callRef.current = call
  const socket = useSocket()
  const { data: authSession } = authClient.useSession()
  const userId = authSession?.user.id

  useEffect(() => {
    const handleDisconnected = (reason?: DisconnectReason) => {
      setCall(null)
      if (
        reason !== undefined &&
        reason !== DisconnectReason.CLIENT_INITIATED
      ) {
        Alert.alert("Call ended", disconnectMessage(reason))
      }
    }
    room.on(RoomEvent.Disconnected, handleDisconnected)
    const stopCaptions = listenForCaptions(room)
    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected)
      stopCaptions()
      void room.disconnect()
    }
  }, [room])

  useEffect(() => {
    SecureStore.getItemAsync(CAPTIONS_KEY)
      .then((stored) => {
        if (stored === "off") setCaptionsOn(false)
      })
      .catch(() => {})
  }, [])
  const toggleCaptions = useCallback(() => {
    const next = !captionsRef.current
    setCaptionsOn(next)
    SecureStore.setItemAsync(CAPTIONS_KEY, next ? "on" : "off").catch(() => {})
  }, [])

  // The call chat's room carries the chat and Lor's window, so it's held for
  // the whole call.
  const threadRootId = call?.threadRootId
  useEffect(() => {
    if (!socket || !threadRootId) return
    const release = holdThreadRoom(socket, threadRootId)
    const rejoin = () => socket.emit("thread:join", { threadRootId })
    socket.on("connect", rejoin)
    return () => {
      socket.off("connect", rejoin)
      release()
    }
  }, [socket, threadRootId])

  // Same count as web's, from the room held above.
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

  // The leave request is a hint; LiveKit's webhook is the authority.
  const leave = useCallback(async () => {
    const current = callRef.current
    setCall(null)
    if (current) setLeftCall(current)
    await room.disconnect()
    if (!current) return
    await api.v1.voice.sessions[":sessionId"].leave
      .$post({ param: { sessionId: current.sessionId } })
      .catch(() => undefined)
  }, [room])

  const join = useCallback(
    async (target: JoinTarget, devices: JoinDevices = DEFAULT_DEVICES) => {
      setJoining(true)
      setJoiningTarget(target)
      setLeftCall(null)
      try {
        if (callRef.current) await leave()
        else if (room.state !== ConnectionState.Disconnected) {
          await room.disconnect()
        }
        const res = await api.v1.channels[":channelId"].voice.join.$post({
          param: { channelId: target.channelId },
        })
        if (!res.ok) {
          throw new Error(await responseMessage(res, "Could not join the call"))
        }
        const { url, token, sessionId, threadRootId } = await res.json()
        await room.connect(url, token)
        setCall({ ...target, sessionId, threadRootId, connectedAt: Date.now() })
        setCameraFacing(devices.facing)
        if (devices.microphone) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true)
          } catch {
            Alert.alert("Microphone unavailable", "You can still listen.")
          }
        }
        if (devices.camera) {
          try {
            await room.localParticipant.setCameraEnabled(true, {
              facingMode: devices.facing,
            })
          } catch {
            Alert.alert("Camera unavailable")
          }
        }
      } catch (error) {
        Alert.alert(
          "Could not join the call",
          error instanceof Error ? error.message : "Try again."
        )
      } finally {
        setJoining(false)
        setJoiningTarget(null)
      }
    },
    [room, leave]
  )

  // LiveKit keeps the new facing in the track's constraints, so turning the
  // camera off and on again stays on the same side.
  const flipCamera = useCallback(async () => {
    const track = room.localParticipant.getTrackPublication(
      Track.Source.Camera
    )?.videoTrack
    if (!track || flippingRef.current) return
    flippingRef.current = true
    const next = facingRef.current === "user" ? "environment" : "user"
    try {
      await track.restartTrack({ facingMode: next })
      setCameraFacing(next)
    } catch {
      Alert.alert("Couldn't switch cameras")
    } finally {
      flippingRef.current = false
    }
  }, [room])

  // Signing out ends the call.
  useEffect(() => {
    if (!userId && callRef.current) void leave()
  }, [userId, leave])

  const value = useMemo(
    () => ({
      call,
      joining,
      ownVoiceChannel,
      join,
      leave,
      cameraFacing,
      flipCamera,
      captionsOn,
      toggleCaptions,
      chatUnread,
      clearChatUnread,
    }),
    [
      call,
      joining,
      ownVoiceChannel,
      join,
      leave,
      cameraFacing,
      flipCamera,
      captionsOn,
      toggleCaptions,
      chatUnread,
      clearChatUnread,
    ]
  )

  return (
    <VoiceCallContext.Provider value={value}>
      <RoomContext.Provider value={room}>{children}</RoomContext.Provider>
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
