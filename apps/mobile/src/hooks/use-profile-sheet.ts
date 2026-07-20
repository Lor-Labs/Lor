import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import {
  type MemberListItem,
  workspaceMemberDetail,
} from "@/components/member-list-sheet"
import type { MessageComposerMentionHandle } from "@/components/message-composer"
import { messageDisplayName } from "@/components/message-row"
import type { UserProfileTarget } from "@/components/user-profile-sheet"
import type { Message, WorkspaceMember } from "@/lib/api-types"

// Matches the bottom-sheet close animation so one sheet finishes
// dismissing before the next opens (or a mention is inserted).
const SHEET_TRANSITION_MS = 300

export function useProfileSheet({
  avatarColorByUserId,
  members,
  mentionRef,
}: {
  avatarColorByUserId: ReadonlyMap<string, string>
  members: WorkspaceMember[]
  mentionRef: RefObject<MessageComposerMentionHandle | null>
}) {
  const [profileUser, setProfileUser] = useState<UserProfileTarget | null>(null)
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTransition = useCallback(() => {
    if (transitionRef.current) clearTimeout(transitionRef.current)
    transitionRef.current = null
  }, [])

  useEffect(() => clearTransition, [clearTransition])

  const scheduleAfterTransition = (action: () => void) => {
    clearTransition()
    transitionRef.current = setTimeout(() => {
      transitionRef.current = null
      action()
    }, SHEET_TRANSITION_MS)
  }

  const openAuthorProfile = (message: Message) => {
    clearTransition()
    const member = members.find(
      (candidate) => candidate.userId === message.author.id
    )
    setProfileUser({
      id: message.author.id,
      name: messageDisplayName(message),
      avatarName: messageDisplayName(message),
      image: message.author.image,
      avatarColor:
        message.author.avatarColor ??
        avatarColorByUserId.get(message.author.id) ??
        null,
      detail: member ? workspaceMemberDetail(member) : null,
    })
  }

  const openMemberProfile = (member: MemberListItem) => {
    scheduleAfterTransition(() => {
      setProfileUser({
        id: member.id,
        name: member.name,
        avatarName: member.avatarName,
        image: member.image,
        avatarColor: member.avatarColor,
        detail: member.detail,
      })
    })
  }

  const mentionFromProfile = (mention: { id: string; label: string }) => {
    setProfileUser(null)
    scheduleAfterTransition(() => mentionRef.current?.insertMention(mention))
  }

  const closeProfile = () => setProfileUser(null)

  const resetProfileSheet = useCallback(() => {
    clearTransition()
    setProfileUser(null)
  }, [clearTransition])

  return {
    closeProfile,
    mentionFromProfile,
    openAuthorProfile,
    openMemberProfile,
    profileUser,
    resetProfileSheet,
  }
}
