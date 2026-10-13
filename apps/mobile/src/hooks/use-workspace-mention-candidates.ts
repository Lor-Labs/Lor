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
  broadcasts = true,
}: {
  workspaceSlug: string
  currentUserId?: string
  // Gates which broadcast mentions the composer offers (@everyone is not
  // offered in members-only channels). Undefined = offer all.
  channelAudience?: "workspace" | "members"
  // Off in sessions, where the server ignores @here, @channel and @everyone.
  broadcasts?: boolean
}) {
  const membersState = useWorkspaceMembers(workspaceSlug)
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...(broadcasts ? broadcastMentionCandidates(channelAudience) : []),
      ...membersState.members
        .filter((member) => member.userId !== currentUserId)
        .map(workspaceMemberToMentionCandidate),
    ],
    [membersState.members, currentUserId, channelAudience, broadcasts]
  )

  return { ...membersState, candidates }
}
