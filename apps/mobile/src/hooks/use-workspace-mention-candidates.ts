import { useMemo } from "react"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import {
  broadcastMentionCandidates,
  type MentionCandidate,
  workspaceMemberToMentionCandidate,
} from "@/lib/mentions"

export function useWorkspaceMentionCandidates({
  workspaceSlug,
  currentUserId,
  channelAudience,
}: {
  workspaceSlug: string
  currentUserId?: string
  // Gates which broadcast mentions the composer offers (@everyone is not
  // offered in members-only channels). Undefined = offer all.
  channelAudience?: "workspace" | "members"
}) {
  const membersState = useWorkspaceMembers(workspaceSlug)
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...broadcastMentionCandidates(channelAudience),
      ...membersState.members
        .filter((member) => member.userId !== currentUserId)
        .map(workspaceMemberToMentionCandidate),
    ],
    [membersState.members, currentUserId, channelAudience]
  )

  return { ...membersState, candidates }
}
