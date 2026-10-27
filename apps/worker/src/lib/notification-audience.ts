import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import { liveSessionChatMembers } from "@repo/db/queries/session-chat-access"

// Directed notifications carry private content outside the channel. Resolver
// permissions alone do not grant channel or live-call visibility.
export async function visibleNotificationRecipients(
  userIds: string[],
  channelId: string,
  threadRootId: string | null
): Promise<string[]> {
  if (userIds.length === 0) return []
  const [channelMembers, sessionMembers] = await Promise.all([
    listChannelAudienceUserIds(channelId),
    threadRootId ? liveSessionChatMembers(threadRootId) : null,
  ])
  const channelAudience = new Set(channelMembers)
  return [...new Set(userIds)].filter(
    (userId) =>
      channelAudience.has(userId) &&
      (!sessionMembers || sessionMembers.has(userId))
  )
}
