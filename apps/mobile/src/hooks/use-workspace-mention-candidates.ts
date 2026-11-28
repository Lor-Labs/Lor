import { LOR_USER_ID } from "@repo/db/constants"
import { useMemo } from "react"
import {
  useChannelAgents,
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
  // A chat can hold several agents (reference/agents-and-chats.md, decision
  // 32), each mentioned by its own id. Lor's own id is not offered beside
  // them: in a chat it only ever meant the first agent. A chat with no agent
  // has none to mention.
  const agents = useChannelAgents()
  const noAgent = useChannelHasNoAgent()
  const candidates = useMemo<MentionCandidate[]>(
    () => [
      ...agents.map((agent, index) => ({
        id: agent.id,
        userId: agent.id,
        name: agent.name,
        image: null,
        isBot: true,
        status: "online" as const,
        label: agent.name,
        // "@lor" still finds the agent that answers by default.
        search: `${agent.name}${index === 0 ? " lor" : ""}`.toLocaleLowerCase(),
        creature: agent.creature,
      })),
      ...membersState.members
        .filter(
          (member) =>
            member.userId !== currentUserId &&
            !((noAgent || agents.length > 0) && member.userId === LOR_USER_ID)
        )
        .map(workspaceMemberToMentionCandidate),
      ...(broadcasts ? broadcastMentionCandidates() : []),
    ],
    [membersState.members, currentUserId, broadcasts, agents, noAgent]
  )

  return { ...membersState, candidates }
}
