import { LOR_USER_ID } from "@repo/db/constants"
import { useMemo } from "react"
import { useChannelAgent } from "@/hooks/use-channel-agent"
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
  // Under a channel, Lor goes by its agent's name (decision 32).
  const agentName = useChannelAgent()?.name
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...(broadcasts ? broadcastMentionCandidates(channelAudience) : []),
      ...membersState.members
        .filter((member) => member.userId !== currentUserId)
        .map((member) => {
          const candidate = workspaceMemberToMentionCandidate(member)
          return agentName && member.userId === LOR_USER_ID
            ? {
                ...candidate,
                name: agentName,
                label: agentName,
                search: `${agentName} lor`.toLocaleLowerCase(),
              }
            : candidate
        }),
    ],
    [
      membersState.members,
      currentUserId,
      channelAudience,
      broadcasts,
      agentName,
    ]
  )

  return { ...membersState, candidates }
}
