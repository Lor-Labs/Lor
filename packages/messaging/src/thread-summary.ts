import { and, count, db, desc, eq, inArray, max, schema } from "@repo/db"
import type { RealtimeMessageThreadUpdated } from "@repo/realtime-types"

// Recompute a thread's channel-feed summary ("N replies" footer + newest-reply
// preview). Shared by the realtime gateway (socket-sent replies) and the
// API/worker paths that post into threads server-side (scope-run resolutions,
// Merlin placeholders) — every reply path must broadcast the same
// message:thread:updated shape or channel feeds go stale until a reload.
export async function loadThreadSummary(
  channelId: string,
  threadRootId: string
): Promise<RealtimeMessageThreadUpdated> {
  const summary = await db
    .select({
      replyCount: count(),
      lastReplyAt: max(schema.message.createdAt),
    })
    .from(schema.message)
    .where(eq(schema.message.threadRootId, threadRootId))
    .then((rows) => rows[0])

  // Empty thread (last reply deleted): return an explicit cleared shape so
  // the channel-feed footer can drop its stale threadSummary.
  if (!summary || !summary.lastReplyAt) {
    return {
      channelId,
      threadRootId,
      replyCount: 0,
      lastReplyAt: null,
      participants: [],
      lastReply: null,
    }
  }

  const recentReplies = await db
    .select({
      messageId: schema.message.id,
      content: schema.message.content,
      attachments: schema.message.attachments,
      authorId: schema.message.authorId,
      userName: schema.user.name,
      userUsername: schema.user.username,
      userDisplayUsername: schema.user.displayUsername,
      userImage: schema.user.image,
    })
    .from(schema.message)
    .innerJoin(schema.user, eq(schema.message.authorId, schema.user.id))
    .where(eq(schema.message.threadRootId, threadRootId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20)

  // Newest reply preview for the channel-feed activity card.
  const newest = recentReplies[0]
  const mentionRows = newest
    ? await db
        .select({
          id: schema.user.id,
          name: schema.user.name,
          username: schema.user.username,
          displayUsername: schema.user.displayUsername,
          image: schema.user.image,
        })
        .from(schema.messageMention)
        .innerJoin(
          schema.user,
          eq(schema.messageMention.mentionedUserId, schema.user.id)
        )
        .where(
          and(
            eq(schema.messageMention.messageId, newest.messageId),
            eq(schema.messageMention.mentionType, "direct")
          )
        )
    : []

  const avatarColorUserIds = [
    ...new Set([
      ...recentReplies.map((row) => row.authorId),
      ...mentionRows.map((mention) => mention.id),
    ]),
  ]
  const threadWorkspaceId = await db
    .select({ workspaceId: schema.channel.workspaceId })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0]?.workspaceId ?? null)
  const avatarColorRows =
    threadWorkspaceId && avatarColorUserIds.length > 0
      ? await db
          .select({
            userId: schema.workspaceMember.userId,
            avatarColor: schema.workspaceMember.avatarColor,
          })
          .from(schema.workspaceMember)
          .where(
            and(
              eq(schema.workspaceMember.workspaceId, threadWorkspaceId),
              inArray(schema.workspaceMember.userId, avatarColorUserIds)
            )
          )
      : []
  const avatarColorByUserId = new Map(
    avatarColorRows.map((row) => [row.userId, row.avatarColor])
  )

  const seen = new Set<string>()
  const participants: RealtimeMessageThreadUpdated["participants"] = []
  for (const row of recentReplies) {
    if (seen.has(row.authorId)) continue
    seen.add(row.authorId)
    participants.push({
      id: row.authorId,
      name: row.userName,
      displayUsername: row.userDisplayUsername,
      image: row.userImage,
      avatarColor: avatarColorByUserId.get(row.authorId) ?? null,
    })
    if (participants.length >= 3) break
  }

  let lastReply: RealtimeMessageThreadUpdated["lastReply"] = null
  if (newest) {
    lastReply = {
      content: newest.content,
      author: {
        id: newest.authorId,
        name: newest.userName,
        username: newest.userUsername,
        displayUsername: newest.userDisplayUsername,
        image: newest.userImage,
        avatarColor: avatarColorByUserId.get(newest.authorId) ?? null,
      },
      mentions: mentionRows.map((mention) => ({
        ...mention,
        avatarColor: avatarColorByUserId.get(mention.id) ?? null,
      })),
      hasAttachments: (newest.attachments ?? []).length > 0,
    }
  }

  return {
    channelId,
    threadRootId,
    replyCount: Number(summary.replyCount),
    lastReplyAt: summary.lastReplyAt.toISOString(),
    participants,
    lastReply,
  }
}
