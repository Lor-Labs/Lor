import { and, db, eq, inArray, MERLIN_USER_ID, or, schema } from "@repo/db"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type {
  MentionNotification,
  ReactionNotification,
  RealtimeMessageMention,
  UnreadNotification,
} from "@repo/realtime-types"
import {
  extractDirectMentionUserIds,
  MARKDOWN_USER_MENTION_REGEX,
  USER_MENTION_REGEX,
} from "./mentions"

export {
  extractDirectMentionUserIds,
  MARKDOWN_USER_MENTION_REGEX,
  USER_MENTION_REGEX,
} from "./mentions"

// Minimal shapes so both realtime (human send) and worker (Merlin reply) can call this.
type FanoutChannel = {
  id: string
  workspaceId: string | null
  name: string | null
  workspaceName?: string | null
}

type FanoutMessage = {
  id: string
  content: string | null
  author: { name: string; image?: string | null }
  attachments: readonly unknown[]
  threadRootId?: string | null
}

type MessageFanoutInput = {
  authorId: string
  channel: FanoutChannel
  message: FanoutMessage
}

type UserTargetedPayload<T> = {
  userId: string
  payload: T
}

async function resolveThreadNotificationContext(message: FanoutMessage) {
  const threadRootId = message.threadRootId ?? null
  if (!threadRootId) {
    return {
      threadRootId: null,
      isMerlinThread: false,
      subscribedUserIds: new Set<string>(),
    }
  }

  const [participantRows, taskCreator] = await Promise.all([
    db
      .selectDistinct({ userId: schema.message.authorId })
      .from(schema.message)
      .where(
        or(
          eq(schema.message.id, threadRootId),
          eq(schema.message.threadRootId, threadRootId)
        )
      ),
    db
      .select({ userId: schema.task.creatorId })
      .from(schema.task)
      .where(eq(schema.task.cardMessageId, threadRootId))
      .limit(1)
      .then((rows) => rows[0]?.userId ?? null),
  ])
  const subscribedUserIds = new Set(
    participantRows.map((participant) => participant.userId)
  )
  if (taskCreator) subscribedUserIds.add(taskCreator)

  return {
    threadRootId,
    isMerlinThread: subscribedUserIds.has(MERLIN_USER_ID),
    subscribedUserIds,
  }
}

type MentionInsertType =
  (typeof schema.messageMention.$inferInsert)["mentionType"]
type NotificationInsertType = Extract<
  (typeof schema.notificationEvent.$inferInsert)["type"],
  "direct_mention" | "everyone_mention"
>

const EVERYONE_MENTION_REGEX = /(^|\s)@everyone\b/i
const mentionNotificationTypes = ["direct_mention", "everyone_mention"] as const

async function listRecipientUserIds(channel: FanoutChannel) {
  // Shared audience resolver: workspace channels fan out to the workspace
  // unless the channel's container is members-audience (private channel /
  // project folder), DMs to their channel members. Never widen this — a
  // restricted channel's messages must not reach non-members' unreads/push.
  return listChannelAudienceUserIds(channel.id)
}

function buildMentionTargets(args: {
  channel: FanoutChannel
  recipients: string[]
  messageContent: string
}) {
  const directMentionedUserIds = extractDirectMentionUserIds(
    args.messageContent
  )
  const includeEveryoneMention =
    Boolean(args.channel.workspaceId) &&
    EVERYONE_MENTION_REGEX.test(args.messageContent)

  const mentionTypeByUserId = new Map<string, MentionInsertType>()
  const recipientSet = new Set(args.recipients)

  for (const userId of directMentionedUserIds) {
    if (recipientSet.has(userId)) {
      mentionTypeByUserId.set(userId, "direct")
    }
  }

  if (includeEveryoneMention) {
    for (const userId of args.recipients) {
      if (!mentionTypeByUserId.has(userId)) {
        mentionTypeByUserId.set(userId, "everyone")
      }
    }
  }

  return mentionTypeByUserId
}

function toNotificationType(
  mentionType: MentionInsertType
): NotificationInsertType {
  return mentionType === "direct" ? "direct_mention" : "everyone_mention"
}

function isMentionNotificationType(
  type: (typeof schema.notificationEvent.$inferSelect)["type"]
): type is MentionNotification["type"] {
  return (mentionNotificationTypes as readonly string[]).includes(type)
}

async function listMentionUsers(
  mentionTypeByUserId: Map<string, MentionInsertType>
): Promise<RealtimeMessageMention[]> {
  const directIds = Array.from(mentionTypeByUserId.entries())
    .filter(([, mentionType]) => mentionType === "direct")
    .map(([userId]) => userId)
  if (directIds.length === 0) return []

  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, directIds))
  const userById = new Map(users.map((user) => [user.id, user]))
  return directIds.flatMap((userId) => userById.get(userId) ?? [])
}

// Reconciles message_mention rows after an edit and returns the canonical
// direct mentions. Deliberately does not create notification events — edits
// don't re-ping, but fresh mention rows still feed unread mention badges.
export async function syncMessageMentions(input: {
  authorId: string
  channel: FanoutChannel
  messageId: string
  content: string
}): Promise<RealtimeMessageMention[]> {
  const allRecipientIds = await listRecipientUserIds(input.channel)
  const recipientIds = [...new Set(allRecipientIds)].filter(
    (id) => id !== input.authorId
  )
  const mentionTypeByUserId = buildMentionTargets({
    channel: input.channel,
    recipients: recipientIds,
    messageContent: input.content,
  })

  const existingRows = await db
    .select({
      mentionedUserId: schema.messageMention.mentionedUserId,
      mentionType: schema.messageMention.mentionType,
    })
    .from(schema.messageMention)
    .where(eq(schema.messageMention.messageId, input.messageId))
  const existingTypeByUserId = new Map(
    existingRows.map((row) => [row.mentionedUserId, row.mentionType])
  )

  const removedUserIds = existingRows
    .filter(
      (row) => mentionTypeByUserId.get(row.mentionedUserId) !== row.mentionType
    )
    .map((row) => row.mentionedUserId)
  if (removedUserIds.length > 0) {
    await db
      .delete(schema.messageMention)
      .where(
        and(
          eq(schema.messageMention.messageId, input.messageId),
          inArray(schema.messageMention.mentionedUserId, removedUserIds)
        )
      )
  }

  const addedRows = Array.from(mentionTypeByUserId.entries())
    .filter(
      ([userId, mentionType]) =>
        existingTypeByUserId.get(userId) !== mentionType
    )
    .map(([mentionedUserId, mentionType]) => ({
      messageId: input.messageId,
      channelId: input.channel.id,
      mentionedUserId,
      mentionType,
    }))
  if (addedRows.length > 0) {
    await db
      .insert(schema.messageMention)
      .values(addedRows)
      .onConflictDoNothing()
  }

  return listMentionUsers(mentionTypeByUserId)
}

export type NotificationPreviewMention = {
  id: string
  name: string
  username?: string | null
  displayUsername?: string | null
}

// Plain-text preview for notification surfaces (desktop notifications, push).
// Mention/citation/markdown handling mirrors apps/web/src/lib/search-preview.ts.
export function buildNotificationContentPreview(input: {
  content: string
  mentions?: readonly NotificationPreviewMention[]
  maxLength?: number
}) {
  const userById = new Map(
    (input.mentions ?? []).map((user) => [user.id, user])
  )
  const mentionLabel = (id: string) => {
    const user = userById.get(id)
    return `@${user ? (user.displayUsername ?? user.username ?? user.name) : "unknown-user"}`
  }

  const normalized = input.content
    .replace(MARKDOWN_USER_MENTION_REGEX, (_match, id: string) =>
      mentionLabel(id)
    )
    .replace(USER_MENTION_REGEX, (_match, id: string) => mentionLabel(id))
    .replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
      const token = raw.trim()
      if (token.startsWith("msg:")) return "↗ message"
      if (token.startsWith("src:")) {
        const [, title = ""] = token.slice(4).split("|")
        return `↗ ${title.trim() || "source"}`
      }
      return token
    })
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^```[^\n]*$/gm, "")
    .replace(/(^|\n)[ \t]{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/g, "$1")
    .replace(/(\*\*|__)(\S(?:[\s\S]*?\S)?)\1/g, "$2")
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, "$1")
    .replace(/(^|\W)_(\S(?:[^_\n]*?\S)?)_(?=\W|$)/g, "$1$2")
    .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .trim()

  const maxLength = input.maxLength ?? 100
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}

async function buildResolvedNotificationContentPreview(content: string) {
  const mentionIds = [...extractDirectMentionUserIds(content)]
  const mentions =
    mentionIds.length > 0
      ? await db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            username: schema.user.username,
            displayUsername: schema.user.displayUsername,
          })
          .from(schema.user)
          .where(inArray(schema.user.id, mentionIds))
      : []
  return buildNotificationContentPreview({ content, mentions })
}

export function buildReactionNotification(input: {
  channel: {
    id: string
    workspaceId: string | null
    name: string | null
    workspaceName?: string | null
  }
  message: {
    id: string
    threadRootId?: string | null
    content: string | null
    mentions?: readonly NotificationPreviewMention[]
  }
  actor: { id: string; name: string; image?: string | null }
  emoji: string
}): ReactionNotification {
  const contentPreview = input.message.content
    ? buildNotificationContentPreview({
        content: input.message.content,
        mentions: input.message.mentions,
      })
    : ""
  const messagePreview = contentPreview || null

  return {
    channelId: input.channel.id,
    workspaceId: input.channel.workspaceId,
    messageId: input.message.id,
    threadRootId: input.message.threadRootId ?? null,
    emoji: input.emoji,
    actorUserId: input.actor.id,
    actorName: input.actor.name,
    actorImage: input.actor.image ?? null,
    channelName: input.channel.name,
    workspaceName: input.channel.workspaceName ?? null,
    messagePreview,
  }
}

export async function buildMessageFanout(input: MessageFanoutInput) {
  const allRecipientIds = await listRecipientUserIds(input.channel)
  const recipientIds = [...new Set(allRecipientIds)].filter(
    (id) => id !== input.authorId
  )
  const threadContext = await resolveThreadNotificationContext(input.message)

  const previewText = input.message.content
    ? await buildResolvedNotificationContentPreview(input.message.content)
    : ""
  const contentPreview = previewText
    ? previewText
    : input.message.attachments.length > 0
      ? `sent ${input.message.attachments.length} attachment${input.message.attachments.length > 1 ? "s" : ""}`
      : null

  const unreadNotifications: Array<UserTargetedPayload<UnreadNotification>> =
    recipientIds.map((userId) => ({
      userId,
      payload: {
        channelId: input.channel.id,
        workspaceId: input.channel.workspaceId,
        messageId: input.message.id,
        threadRootId: threadContext.threadRootId,
        isMerlinThread: threadContext.isMerlinThread,
        isSubscribedToThread: threadContext.subscribedUserIds.has(userId),
        unreadCountDelta: 1,
        authorUserId: input.authorId,
        authorName: input.message.author.name,
        authorImage: input.message.author.image ?? null,
        contentPreview,
        channelName: input.channel.name,
        workspaceName: input.channel.workspaceName ?? null,
      },
    }))

  const mentionTypeByUserId = buildMentionTargets({
    channel: input.channel,
    recipients: recipientIds,
    messageContent: input.message.content ?? "",
  })

  const messageMentions = await listMentionUsers(mentionTypeByUserId)

  if (mentionTypeByUserId.size === 0) {
    return {
      unreadNotifications,
      messageMentions,
      mentionNotifications: [] as Array<
        UserTargetedPayload<MentionNotification>
      >,
    }
  }

  const mentionRows = Array.from(mentionTypeByUserId.entries()).map(
    ([userId, mentionType]) => ({
      messageId: input.message.id,
      channelId: input.channel.id,
      mentionedUserId: userId,
      mentionType,
    })
  )

  await db
    .insert(schema.messageMention)
    .values(mentionRows)
    .onConflictDoNothing()

  const notificationRows = Array.from(mentionTypeByUserId.entries()).map(
    ([userId, mentionType]) => ({
      userId,
      workspaceId: input.channel.workspaceId,
      channelId: input.channel.id,
      messageId: input.message.id,
      type: toNotificationType(mentionType),
    })
  )

  const insertedNotifications = await db
    .insert(schema.notificationEvent)
    .values(notificationRows)
    .onConflictDoNothing()
    .returning({
      id: schema.notificationEvent.id,
      userId: schema.notificationEvent.userId,
      type: schema.notificationEvent.type,
      messageId: schema.notificationEvent.messageId,
      channelId: schema.notificationEvent.channelId,
      workspaceId: schema.notificationEvent.workspaceId,
      createdAt: schema.notificationEvent.createdAt,
    })

  const expectedNotificationKey = (row: { userId: string; type: string }) =>
    `${row.userId}:${row.type}`

  const insertedKeys = new Set(
    insertedNotifications.map((row) => expectedNotificationKey(row))
  )
  const missingUserIds = notificationRows
    .filter((row) => !insertedKeys.has(expectedNotificationKey(row)))
    .map((row) => row.userId)

  let allNotifications = insertedNotifications

  if (missingUserIds.length > 0) {
    const existingNotifications = await db
      .select({
        id: schema.notificationEvent.id,
        userId: schema.notificationEvent.userId,
        type: schema.notificationEvent.type,
        messageId: schema.notificationEvent.messageId,
        channelId: schema.notificationEvent.channelId,
        workspaceId: schema.notificationEvent.workspaceId,
        createdAt: schema.notificationEvent.createdAt,
      })
      .from(schema.notificationEvent)
      .where(
        and(
          eq(schema.notificationEvent.messageId, input.message.id),
          inArray(schema.notificationEvent.userId, [
            ...new Set(missingUserIds),
          ]),
          inArray(schema.notificationEvent.type, mentionNotificationTypes)
        )
      )

    const expectedKeys = new Set(
      notificationRows.map((row) => expectedNotificationKey(row))
    )
    const mergedByKey = new Map<
      string,
      (typeof insertedNotifications)[number]
    >()

    for (const notification of insertedNotifications) {
      mergedByKey.set(expectedNotificationKey(notification), notification)
    }

    for (const notification of existingNotifications) {
      const key = expectedNotificationKey(notification)
      if (expectedKeys.has(key) && !mergedByKey.has(key)) {
        mergedByKey.set(key, notification)
      }
    }

    allNotifications = [...mergedByKey.values()]
  }

  const mentionNotifications: Array<UserTargetedPayload<MentionNotification>> =
    allNotifications.flatMap((notification) => {
      if (!isMentionNotificationType(notification.type)) {
        return []
      }

      return [
        {
          userId: notification.userId,
          payload: {
            id: notification.id,
            type: notification.type,
            messageId: notification.messageId ?? input.message.id,
            channelId: notification.channelId ?? input.channel.id,
            workspaceId: notification.workspaceId ?? input.channel.workspaceId,
            threadRootId: threadContext.threadRootId,
            isMerlinThread: threadContext.isMerlinThread,
            isSubscribedToThread: threadContext.subscribedUserIds.has(
              notification.userId
            ),
            createdAt: notification.createdAt.toISOString(),
          },
        },
      ]
    })

  return {
    unreadNotifications,
    messageMentions,
    mentionNotifications,
  }
}

export * from "./push"
