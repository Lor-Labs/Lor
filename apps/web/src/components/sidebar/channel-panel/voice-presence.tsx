import { createContext, type ReactNode, useContext, useMemo } from "react"
import { ParticipantAvatar } from "@/components/voice/participant-avatar"
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
  const value = useMemo(
    () =>
      new Map(
        channels?.map((channel) => [channel.channelId, channel.participants])
      ),
    [channels]
  )
  return <VoicePresenceContext value={value}>{children}</VoicePresenceContext>
}

// Joined people stacked under the voice channel.
export function VoiceParticipantRows({ channelId }: { channelId: string }) {
  const participants = useContext(VoicePresenceContext).get(channelId)
  if (!participants?.length) return null

  return (
    <ul className="mb-1 ml-6 flex flex-col gap-0.5">
      {participants.map((participant) => (
        <li
          key={participant.userId}
          className="flex items-center gap-2 rounded-md px-2 py-[3px] text-[13px] text-muted-foreground"
        >
          <ParticipantAvatar participant={participant} size="xs" />
          <span className="truncate">{participant.name}</span>
        </li>
      ))}
    </ul>
  )
}
