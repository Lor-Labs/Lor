import { withOwnVoiceCall } from "@repo/realtime-types/voice-presence"
import { toast } from "@repo/ui/components/toast"
import { useNavigate, useParams } from "@tanstack/react-router"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { ParticipantAvatar } from "@/components/voice/participant-avatar"
import { isPhoneBrowser } from "@/components/voice/voice-channel-view"
import { useVoiceCall } from "@/context/voice-call-context"
import { useOwnVoiceParticipant } from "@/hooks/use-own-voice-participant"
import {
  useVoicePresence,
  type VoicePresenceChannel,
} from "@/hooks/use-voice-presence"

type Participants = VoicePresenceChannel["participants"]

const VoicePresenceContext = createContext<Map<string, Participants>>(new Map())

export function VoicePresenceProvider({
  workspaceSlug,
  workspaceId,
  children,
}: {
  workspaceSlug?: string
  workspaceId?: string
  children: ReactNode
}) {
  const channels = useVoicePresence(workspaceSlug, workspaceId)
  const { call } = useVoiceCall()
  const me = useOwnVoiceParticipant(workspaceSlug)
  const value = useMemo(() => {
    const ownCall =
      call && me && call.workspaceSlug === workspaceSlug
        ? {
            channelId: call.channelId,
            sessionId: call.sessionId,
            participant: me,
          }
        : null
    return new Map(
      withOwnVoiceCall(channels ?? [], ownCall).map((channel) => [
        channel.channelId,
        channel.participants,
      ])
    )
  }, [channels, call, me, workspaceSlug])
  return <VoicePresenceContext value={value}>{children}</VoicePresenceContext>
}

// Joined people stacked under the voice channel. Clicking them joins the call
// straight away (or opens it, if this device is already in it).
export function VoiceParticipantRows({
  channelId,
  channelName,
}: {
  channelId: string
  channelName: string
}) {
  const participants = useContext(VoicePresenceContext).get(channelId)
  const { call, joining, join } = useVoiceCall()
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  if (!participants?.length || !workspaceSlug) return null

  const inThisCall = call?.channelId === channelId
  const open = () => {
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId },
    })
    if (inThisCall || joining || isPhoneBrowser) return
    join({ workspaceSlug, channelId, channelName }).catch((error) => {
      toast.error(
        error instanceof Error ? error.message : "Could not join the call"
      )
    })
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={
        inThisCall
          ? `Open the call in ${channelName}`
          : `Join the call in ${channelName}`
      }
      className="mb-1 ml-6 flex w-[calc(100%-1.5rem)] cursor-pointer flex-col gap-0.5 rounded-md text-left transition-colors hover:bg-accent"
    >
      {participants.map((participant) => (
        <span
          key={participant.userId}
          className="flex items-center gap-2 px-2 py-[3px] text-[13px] text-muted-foreground"
        >
          <ParticipantAvatar participant={participant} size="xs" />
          <span className="truncate">{participant.name}</span>
        </span>
      ))}
    </button>
  )
}
