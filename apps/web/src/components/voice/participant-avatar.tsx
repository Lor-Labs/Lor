import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import type { VoiceParticipant } from "@/hooks/use-voice-presence"

export function ParticipantAvatar({
  participant,
  size = "sm",
}: {
  participant: Pick<VoiceParticipant, "name" | "image" | "avatarColor">
  size?: "xs" | "sm"
}) {
  // Avatar's sm size (24px) is a data-attribute variant; xs builds on the
  // default size instead so size-5 isn't outranked.
  const xs = size === "xs"
  return (
    <Avatar size={xs ? "default" : "sm"} className={xs ? "size-5" : undefined}>
      {participant.image && (
        <AvatarImage src={participant.image} alt={participant.name} />
      )}
      <AvatarFallback
        avatarColor={participant.avatarColor}
        fallbackSeed={participant.name}
        className={cn("font-semibold", xs && "text-[9px]")}
      >
        {getAvatarInitials(participant.name)}
      </AvatarFallback>
    </Avatar>
  )
}
