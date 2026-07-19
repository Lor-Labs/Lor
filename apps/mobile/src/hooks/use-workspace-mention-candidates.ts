import { useMemo } from "react"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import {
  everyoneMentionCandidate,
  type MentionCandidate,
  workspaceMemberToMentionCandidate,
} from "@/lib/mentions"

export function useWorkspaceMentionCandidates({
  workspaceSlug,
  currentUserId,
}: {
  workspaceSlug: string
  currentUserId?: string
}) {
  const membersState = useWorkspaceMembers(workspaceSlug)
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      everyoneMentionCandidate,
      ...membersState.members
        .filter((member) => member.userId !== currentUserId)
        .map(workspaceMemberToMentionCandidate),
    ],
    [membersState.members, currentUserId]
  )

  return { ...membersState, candidates }
}
