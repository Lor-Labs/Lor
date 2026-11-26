import { LOR_USER_ID } from "@repo/db/constants"
import { useMemo } from "react"
import {
  useChannelAgent,
  useChannelHasNoAgent,
} from "@/hooks/use-channel-agent"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import {
  broadcastMentionCandidates,
  type MentionCandidate,
  workspaceMemberToMentionCandidate,
} from "@/lib/mentions"

export function useWorkspaceMentionCandidates({
  workspaceSlug,
  currentUserId,
  broadcasts = true,
}: {
  workspaceSlug: string
  currentUserId?: string
  // Off in sessions, where the server ignores @chat and @here.
  broadcasts?: boolean
}) {
  const membersState = useWorkspaceMembers(workspaceSlug)
  // Under a channel, Lor goes by its agent's name and creature. A channel
  // with no agent has nobody to mention.
  const agent = useChannelAgent()
  const noAgent = useChannelHasNoAgent()
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...(broadcasts ? broadcastMentionCandidates() : []),
      ...membersState.members
        .filter(
          (member) =>
            member.userId !== currentUserId &&
            !(noAgent && member.userId === LOR_USER_ID)
        )
        .map((member) => {
          const candidate = workspaceMemberToMentionCandidate(member)
          return agent && member.userId === LOR_USER_ID
            ? {
                ...candidate,
                name: agent.name,
                label: agent.name,
                search: `${agent.name} lor`.toLocaleLowerCase(),
                creature: agent.creature,
              }
            : candidate
        }),
    ],
    [membersState.members, currentUserId, broadcasts, agent, noAgent]
  )

  return { ...membersState, candidates }
}
