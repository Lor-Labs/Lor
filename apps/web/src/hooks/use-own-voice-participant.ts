import { authClient } from "@repo/auth/client"
import type { VoicePresenceParticipant } from "@repo/realtime-types/voice-presence"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"

type MembersData = {
  members: { userId: string; avatarColor: string | null }[]
}

// You, as you appear in a call: your own presence before LiveKit's webhook
// lands, and the pre-join preview with your camera off.
export function useOwnVoiceParticipant(
  workspaceSlug: string | undefined
): VoicePresenceParticipant | null {
  const { data: auth } = authClient.useSession()
  const queryClient = useQueryClient()
  const user = auth?.user
  const avatarColor =
    queryClient
      .getQueryData<MembersData>(["workspace-members", workspaceSlug])
      ?.members.find((member) => member.userId === user?.id)?.avatarColor ??
    null
  return useMemo(
    () =>
      user
        ? {
            userId: user.id,
            name: user.name,
            image: user.image ?? null,
            avatarColor,
            connected: true,
          }
        : null,
    [user, avatarColor]
  )
}
