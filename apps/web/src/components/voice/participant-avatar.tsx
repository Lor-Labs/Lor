import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import type { VoiceParticipant } from "@/hooks/use-voice-presence"

export function ParticipantAvatar({
  participant,
  size = "sm",
}: {
  participant: Pick<VoiceParticipant, "name" | "image" | "avatarColor">
  size?: "xs" | "sm" | "xl"
}) {
  // Avatar's sm size (24px) is a data-attribute variant; xs builds on the
  // default size instead so size-5 isn't outranked, and xl (the pre-join
  // preview with the camera off) grows past Avatar's own lg, sized like the
  // account settings avatar.
  const xs = size === "xs"
  const xl = size === "xl"
  return (
    <Avatar
      size={xs ? "default" : xl ? "lg" : "sm"}
      className={xs ? "size-5" : xl ? "size-20" : undefined}
    >
      {participant.image && (
        <AvatarImage src={participant.image} alt={participant.name} />
      )}
      <AvatarFallback
        avatarColor={participant.avatarColor}
        fallbackSeed={participant.name}
        className={cn("font-semibold", xs && "text-[9px]", xl && "text-lg")}
      >
        {getAvatarInitials(participant.name)}
      </AvatarFallback>
    </Avatar>
  )
}
