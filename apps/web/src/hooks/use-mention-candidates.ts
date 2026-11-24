import { LOR_USER_ID } from "@repo/db/constants"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import type { MentionCandidate } from "@/components/chat/composer/mention-types"
import {
  agentCreature,
  channelAgentOf,
  useAgentsById,
} from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"
import { broadcastMentionCandidates } from "@/lib/broadcast-mentions"
import { channelQueryOptions } from "@/lib/channel-query"

function useChannelAudience(workspaceSlug: string, channelId: string) {
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const { data: channel } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )
  // Under the channel key so channel and project membership invalidations
  // refresh it too.
  const { data: audience } = useQuery({
    queryKey: ["channel", workspaceSlug, channelId, "audience"],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].audience.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to fetch channel audience")
      return res.json()
    },
  })
  return { members: membersData?.members, channel, audience }
}

// Composer @ suggestions: only people who can see the channel, the same
// audience the server notifies. Bots (Lor) aren't channel members but can be
// mentioned anywhere, except in voice session chats, which are human-only.
// Broadcasts come last, as the @ menu lists them. Session composers pass
// `broadcasts: false`: the server ignores @here, @channel and @everyone in
// sessions.
// In a text channel's chat and threads, Lor is the channel's agent and goes
// by its name and creature (reference/always-on-agents.md, decision 32).
// Session composers pass `agent: false`: there Lor is the session's agent.
export function useMentionCandidates(
  workspaceSlug: string,
  channelId: string,
  {
    broadcasts = true,
    agent = true,
  }: { broadcasts?: boolean; agent?: boolean } = {}
) {
  const { members, channel, audience } = useChannelAudience(
    workspaceSlug,
    channelId
  )

  const agents = useAgentsById(workspaceSlug)

  return useMemo<MentionCandidate[]>(() => {
    const humanOnly = channel?.type === "voice"
    // In a text channel's chat, Lor is the agent in that channel. A channel
    // with no agent has nobody to mention.
    const inChat = agent && channel?.type === "text"
    const placed = inChat ? channelAgentOf(channel, agents) : null
    const identity = placed
      ? { name: placed.name, creature: agentCreature(placed) }
      : null
    const audienceIds = new Set(audience?.userIds ?? [])
    const people = (members ?? []).filter((member) =>
      member.isBot
        ? !humanOnly && !(inChat && !placed && member.userId === LOR_USER_ID)
        : audienceIds.has(member.userId)
    )
    return [
      ...people.map((member) =>
        identity && member.userId === LOR_USER_ID
          ? {
              id: member.userId,
              label: identity.name,
              name: identity.name,
              search: "lor",
              image: null,
              creature: identity.creature,
            }
          : {
              id: member.userId,
              label: member.name,
              name: member.name,
              image: member.image,
            }
      ),
      ...(broadcasts ? broadcastMentionCandidates(audience?.audience) : []),
    ]
  }, [members, channel, audience, broadcasts, agent, agents])
}

// People who can see the channel, so who can follow its threads. Bots never
// subscribe.
export function useChannelPeople(workspaceSlug: string, channelId: string) {
  const { members, audience } = useChannelAudience(workspaceSlug, channelId)
  return useMemo(() => {
    const audienceIds = new Set(audience?.userIds ?? [])
    return (members ?? []).filter(
      (member) => !member.isBot && audienceIds.has(member.userId)
    )
  }, [members, audience])
}
