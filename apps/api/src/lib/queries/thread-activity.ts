import { db } from "@repo/db"
import type { Attachment } from "@repo/db/schema"
import { message, messageMention, threadReadState, user } from "@repo/db/schema"
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  max,
  ne,
} from "drizzle-orm"

export type ThreadActivityMention = {
  id: string
  name: string
  username: string | null
  displayUsername: string | null
  image: string | null
}

export type ThreadActivityItem = {
  threadRootId: string
  replyCount: number
  // Replies from others after the caller's read cursor — what the dock badge
  // shows. `replyCount` stays the thread total (matches the inline footer).
  newReplyCount: number
  lastReplyAt: string
  participants: Array<{
    id: string
    name: string
    displayUsername: string | null
    image: string | null
  }>
  lastReply: {
    content: string | null
    author: {
      id: string
      name: string
      username: string | null
      displayUsername: string | null
      image: string | null
    }
    hasAttachments: boolean
    mentions: ThreadActivityMention[]
  }
}

type FetchParams = {
  channelId: string
  currentUserId: string
  limit?: number
}

// Bound the unread-thread backlog: replies older than this never surface,
// even with no thread_read_state row (new members, feature rollout).
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
// Candidates fetched before the per-thread read filter drops the read ones.
const CANDIDATE_LIMIT = 30

/**
 * Threads in a channel with replies from someone other than the caller that
 * the caller hasn't read yet. Freshness is judged per thread against
 * thread_read_state (channel read state doesn't apply — thread replies don't
 * advance it), so the activity dock survives reloads and syncs across devices
 * until the thread is actually opened or dismissed.
 */
export async function fetchChannelThreadActivity({
  channelId,
  currentUserId,
  limit = 8,
}: FetchParams): Promise<ThreadActivityItem[]> {
  const windowStart = new Date(Date.now() - ACTIVITY_WINDOW_MS)

  // Paginate candidates (most-recently-active first) until `limit` unread
  // roots are found or the window is exhausted — a page of already-read
  // recent threads must not hide older unread ones.
  const rootIds: string[] = []
  // Effective read cursor per root (read state ⊔ own last reply) — also feeds
  // the newReplyCount pass below.
  const readAtByRoot = new Map<string, number>()
  for (let offset = 0; rootIds.length < limit; offset += CANDIDATE_LIMIT) {
    const candidateRows = await db
      .select({
        threadRootId: message.threadRootId,
        freshestOtherReplyAt: max(message.createdAt),
      })
      .from(message)
      .where(
        and(
          eq(message.channelId, channelId),
          isNotNull(message.threadRootId),
          ne(message.authorId, currentUserId),
          gt(message.createdAt, windowStart)
        )
      )
      .groupBy(message.threadRootId)
      .orderBy(desc(max(message.createdAt)))
      .limit(CANDIDATE_LIMIT)
      .offset(offset)
    const candidateIds = candidateRows
      .map((r) => r.threadRootId)
      .filter((id): id is string => id !== null)
    if (candidateIds.length === 0) break

    const [readRows, ownReplyRows] = await Promise.all([
      db
        .select({
          threadRootId: threadReadState.threadRootId,
          lastReadAt: threadReadState.lastReadAt,
        })
        .from(threadReadState)
        .where(
          and(
            eq(threadReadState.userId, currentUserId),
            inArray(threadReadState.threadRootId, candidateIds)
          )
        ),
      db
        .select({
          threadRootId: message.threadRootId,
          lastOwnReplyAt: max(message.createdAt),
        })
        .from(message)
        .where(
          and(
            inArray(message.threadRootId, candidateIds),
            eq(message.authorId, currentUserId)
          )
        )
        .groupBy(message.threadRootId),
    ])
    for (const r of readRows) {
      readAtByRoot.set(r.threadRootId, r.lastReadAt.getTime())
    }
    for (const r of ownReplyRows) {
      if (!r.threadRootId || !r.lastOwnReplyAt) continue
      // Replying implies you read everything before your reply.
      const current = readAtByRoot.get(r.threadRootId) ?? 0
      readAtByRoot.set(
        r.threadRootId,
        Math.max(current, r.lastOwnReplyAt.getTime())
      )
    }

    for (const r of candidateRows) {
      if (rootIds.length >= limit) break
      if (!r.threadRootId || !r.freshestOtherReplyAt) continue
      const readAt = readAtByRoot.get(r.threadRootId)
      if (!readAt || r.freshestOtherReplyAt.getTime() > readAt) {
        rootIds.push(r.threadRootId)
      }
    }

    if (candidateRows.length < CANDIDATE_LIMIT) break
  }
  if (rootIds.length === 0) return []

  const [summaryRows, replyRows] = await Promise.all([
    db
      .select({
        threadRootId: message.threadRootId,
        replyCount: count(),
        lastReplyAt: max(message.createdAt),
      })
      .from(message)
      .where(inArray(message.threadRootId, rootIds))
      .groupBy(message.threadRootId),
    // Newest-first; the first row per root is its latest reply, and the
    // distinct authors give participants.
    db
      .select({
        threadRootId: message.threadRootId,
        messageId: message.id,
        createdAt: message.createdAt,
        content: message.content,
        attachments: message.attachments,
        authorId: user.id,
        authorName: user.name,
        authorUsername: user.username,
        authorDisplayUsername: user.displayUsername,
        authorImage: user.image,
      })
      .from(message)
      .innerJoin(user, eq(message.authorId, user.id))
      .where(inArray(message.threadRootId, rootIds))
      .orderBy(desc(message.createdAt)),
  ])

  type ReplyRow = (typeof replyRows)[number]
  const latestReplyByRoot = new Map<string, ReplyRow>()
  const participantsByRoot = new Map<
    string,
    ThreadActivityItem["participants"]
  >()
  const seenAuthorsPerRoot = new Map<string, Set<string>>()
  for (const row of replyRows) {
    if (!row.threadRootId) continue
    if (!latestReplyByRoot.has(row.threadRootId)) {
      latestReplyByRoot.set(row.threadRootId, row)
    }
    const list = participantsByRoot.get(row.threadRootId) ?? []
    if (list.length >= 3) continue
    let seen = seenAuthorsPerRoot.get(row.threadRootId)
    if (!seen) {
      seen = new Set()
      seenAuthorsPerRoot.set(row.threadRootId, seen)
    }
    if (seen.has(row.authorId)) continue
    seen.add(row.authorId)
    list.push({
      id: row.authorId,
      name: row.authorName,
      displayUsername: row.authorDisplayUsername,
      image: row.authorImage,
    })
    participantsByRoot.set(row.threadRootId, list)
  }

  // Unread = replies from others after the caller's effective read cursor.
  const newCountByRoot = new Map<string, number>()
  for (const row of replyRows) {
    if (!row.threadRootId || row.authorId === currentUserId) continue
    const readAt = readAtByRoot.get(row.threadRootId) ?? 0
    if (row.createdAt.getTime() <= readAt) continue
    newCountByRoot.set(
      row.threadRootId,
      (newCountByRoot.get(row.threadRootId) ?? 0) + 1
    )
  }

  // Mentions for the newest reply of each root, so @mentions render as names.
  const latestReplyIds = Array.from(latestReplyByRoot.values()).map(
    (r) => r.messageId
  )
  const mentionRows = latestReplyIds.length
    ? await db
        .select({
          messageId: messageMention.messageId,
          id: user.id,
          name: user.name,
          username: user.username,
          displayUsername: user.displayUsername,
          image: user.image,
        })
        .from(messageMention)
        .innerJoin(user, eq(messageMention.mentionedUserId, user.id))
        .where(
          and(
            inArray(messageMention.messageId, latestReplyIds),
            eq(messageMention.mentionType, "direct")
          )
        )
    : []
  const mentionsByMessageId = new Map<string, ThreadActivityMention[]>()
  for (const row of mentionRows) {
    const list = mentionsByMessageId.get(row.messageId) ?? []
    list.push({
      id: row.id,
      name: row.name,
      username: row.username,
      displayUsername: row.displayUsername,
      image: row.image,
    })
    mentionsByMessageId.set(row.messageId, list)
  }

  const items: ThreadActivityItem[] = []
  for (const row of summaryRows) {
    if (!row.threadRootId || !row.lastReplyAt) continue
    const latest = latestReplyByRoot.get(row.threadRootId)
    if (!latest) continue
    const attachments = (latest.attachments as Attachment[] | null) ?? []
    items.push({
      threadRootId: row.threadRootId,
      replyCount: Number(row.replyCount),
      newReplyCount: newCountByRoot.get(row.threadRootId) ?? 0,
      lastReplyAt: row.lastReplyAt.toISOString(),
      participants: participantsByRoot.get(row.threadRootId) ?? [],
      lastReply: {
        content: latest.content,
        author: {
          id: latest.authorId,
          name: latest.authorName,
          username: latest.authorUsername,
          displayUsername: latest.authorDisplayUsername,
          image: latest.authorImage,
        },
        hasAttachments: attachments.length > 0,
        mentions: mentionsByMessageId.get(latest.messageId) ?? [],
      },
    })
  }

  // Freshest last — matches the bottom-of-feed stack ordering on the client.
  items.sort((a, b) => a.lastReplyAt.localeCompare(b.lastReplyAt))
  return items.slice(-limit)
}
