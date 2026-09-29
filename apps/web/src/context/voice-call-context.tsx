import { RoomAudioRenderer, RoomContext } from "@livekit/components-react"
import { toast } from "@repo/ui/components/toast"
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
  useState,
} from "react"
import { apiClient } from "@/lib/api-client"

export type ActiveVoiceCall = {
  workspaceSlug: string
  channelId: string
  channelName: string
}

type VoiceCallContextValue = {
  call: ActiveVoiceCall | null
  joining: boolean
  join: (call: ActiveVoiceCall) => Promise<void>
  leave: () => Promise<void>
}

const VoiceCallContext = createContext<VoiceCallContextValue | null>(null)

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

// One Room for the app's lifetime: the call survives navigation, and
// remounting a room disconnects everyone.
export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const [room] = useState(
    () => new Room({ adaptiveStream: true, dynacast: true })
  )
  const [call, setCall] = useState<ActiveVoiceCall | null>(null)
  const [joining, setJoining] = useState(false)

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
    async (next: ActiveVoiceCall) => {
      setJoining(true)
      try {
        if (room.state !== ConnectionState.Disconnected) {
          await room.disconnect()
        }
        const res = await apiClient.v1.channels[":channelId"].voice.join.$post({
          param: { channelId: next.channelId },
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.message ?? "Could not join the call")
        }
        const { url, token } = await res.json()
        await room.connect(url, token)
        setCall(next)
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

  const leave = useCallback(async () => {
    await room.disconnect()
    setCall(null)
  }, [room])

  const value = useMemo(
    () => ({ call, joining, join, leave }),
    [call, joining, join, leave]
  )

  return (
    <VoiceCallContext.Provider value={value}>
      <RoomContext.Provider value={room}>
        {children}
        {call && <RoomAudioRenderer />}
      </RoomContext.Provider>
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
