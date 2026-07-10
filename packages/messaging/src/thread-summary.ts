import { and, count, db, desc, eq, max, ne, schema } from "@repo/db"
import type { RealtimeMessageThreadUpdated } from "@repo/realtime-types"

// Pending rows are in-flight Merlin placeholders — not replies yet, so they
// don't count, don't appear as participants, and don't drive the preview.
// The worker broadcasts a fresh summary once the reply settles.
function settledReplies(threadRootId: string) {
  return and(
    eq(schema.message.threadRootId, threadRootId),
    ne(schema.message.status, "pending")
  )
}

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
    .where(settledReplies(threadRootId))
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
    .where(settledReplies(threadRootId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20)

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
    })
    if (participants.length >= 3) break
  }

  // Newest reply preview for the channel-feed activity card.
  const newest = recentReplies[0]
  let lastReply: RealtimeMessageThreadUpdated["lastReply"] = null
  if (newest) {
    const mentionRows = await db
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
    lastReply = {
      content: newest.content,
      author: {
        id: newest.authorId,
        name: newest.userName,
        username: newest.userUsername,
        displayUsername: newest.userDisplayUsername,
        image: newest.userImage,
      },
      mentions: mentionRows,
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
