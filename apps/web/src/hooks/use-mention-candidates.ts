import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { apiClient } from "@/lib/api-client"
import { broadcastMentionCandidates } from "@/lib/broadcast-mentions"
import { channelQueryOptions } from "@/lib/channel-query"

// Composer @ suggestions: only people who can see the channel, the same
// audience the server notifies. Bots (Lor) aren't channel members but can be
// mentioned anywhere, except in voice session chats, which are human-only.
export function useMentionCandidates(workspaceSlug: string, channelId: string) {
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

  return useMemo(() => {
    const humanOnly = channel?.type === "voice"
    const audienceIds = new Set(audience?.userIds ?? [])
    const people = (membersData?.members ?? []).filter((member) =>
      member.isBot ? !humanOnly : audienceIds.has(member.userId)
    )
    return [
      ...broadcastMentionCandidates(audience?.audience),
      ...people.map((member) => ({
        id: member.userId,
        label: member.name,
        name: member.name,
        image: member.image,
      })),
    ]
  }, [membersData?.members, channel?.type, audience])
}
