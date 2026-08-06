import { useMemo, useRef } from "react"
import type { MessageComposerMentionHandle } from "@/components/message-composer"
import { UserProfileSheet } from "@/components/user-profile-sheet"
import { useOpenDM } from "@/hooks/use-open-dm"
import { useProfileSheet } from "@/hooks/use-profile-sheet"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { authClient } from "@/lib/auth-client"

// Profile sheet wiring for screens without a composer — the sheet's Mention
// action stays off because mentionRef never attaches.
export function useAuthorProfileSheet(workspaceSlug: string) {
  const { data: session } = authClient.useSession()
  const { members } = useWorkspaceMembers(workspaceSlug)
  const avatarColorByUserId = useMemo(
    () => new Map(members.map((member) => [member.userId, member.avatarColor])),
    [members]
  )
  const mentionRef = useRef<MessageComposerMentionHandle>(null)
  const { closeProfile, openAuthorProfile, profileUser } = useProfileSheet({
    avatarColorByUserId,
    members,
    mentionRef,
  })
  const { openDM } = useOpenDM()

  const profileSheet = (
    <UserProfileSheet
      currentUserId={session?.user.id}
      onMessage={(target) => {
        closeProfile()
        void openDM(target.id)
      }}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeProfile()
      }}
      user={profileUser}
    />
  )

  return { avatarColorByUserId, openAuthorProfile, profileSheet }
}
