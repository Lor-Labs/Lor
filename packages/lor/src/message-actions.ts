import { and, count, db, eq, LOR_USER_ID, schema } from "@repo/db"
import { buildReactionNotification } from "@repo/messaging"
import type {
  ReactionNotification,
  RealtimeMessageReactionUpdated,
} from "@repo/realtime-types"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"

export type TargetedReactionNotification = {
  authorUserId: string
  payload: ReactionNotification
}

export type MessageReactionEvent = {
  update: RealtimeMessageReactionUpdated
  notification?: TargetedReactionNotification
}

export type OnMessageReaction = (
  event: MessageReactionEvent
) => void | Promise<void>

const messageActionContext = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  triggerMessageId: z.string().optional(),
  onMessageReaction: z.custom<OnMessageReaction>().optional(),
})

// Read once per call so the realtime broadcast and the push/browser
// notification can never disagree on how Lor is named.
async function loadLorIdentity(): Promise<{
  name: string
  image: string | null
}> {
  const row = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, LOR_USER_ID))
    .limit(1)
    .then((rows) => rows[0])
    .catch(() => undefined)
  return { name: row?.name ?? "Lor", image: row?.image ?? null }
}

async function buildTargetedNotification(input: {
  workspaceId: string
  channelId: string
  messageId: string
  emoji: string
  actor: { name: string; image: string | null }
}): Promise<TargetedReactionNotification | undefined> {
  const target = await db
    .select({
      authorId: schema.message.authorId,
      content: schema.message.content,
      threadRootId: schema.message.threadRootId,
      channelId: schema.channel.id,
      channelName: schema.channel.name,
      workspaceId: schema.workspace.id,
      workspaceName: schema.workspace.name,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .innerJoin(
      schema.workspace,
      eq(schema.channel.workspaceId, schema.workspace.id)
    )
    .where(
      and(
        eq(schema.message.id, input.messageId),
        eq(schema.message.channelId, input.channelId),
        eq(schema.channel.workspaceId, input.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!target || target.authorId === LOR_USER_ID) return undefined

  const mentions = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
    })
    .from(schema.messageMention)
    .innerJoin(
      schema.user,
      eq(schema.messageMention.mentionedUserId, schema.user.id)
    )
    .where(
      and(
        eq(schema.messageMention.messageId, input.messageId),
        eq(schema.messageMention.mentionType, "direct")
      )
    )

  const actor = {
    id: LOR_USER_ID,
    name: input.actor.name,
    image: input.actor.image,
  }
  const message = {
    id: input.messageId,
    content: target.content,
    threadRootId: target.threadRootId,
    mentions,
  }
  const payload = buildReactionNotification({
    channel: {
      id: target.channelId,
      workspaceId: target.workspaceId,
      name: target.channelName,
      workspaceName: target.workspaceName,
    },
    message,
    actor,
    emoji: input.emoji,
  })

  return { authorUserId: target.authorId, payload }
}

export const messageActionTools = {
  react_to_message: tool({
    description:
      "Add a reaction to a message as Lor to complement a concise written response. Use reactions sparingly. Repeating the same emoji on the same message is harmless and does not remove it. Omit messageId to react to the message that triggered this response.",
    inputSchema: z.object({
      emoji: z.string().trim().min(1).max(64),
      messageId: z.string().uuid().optional(),
    }),
    contextSchema: messageActionContext,
    execute: async ({ emoji, messageId }, { context }) => {
      const targetMessageId = messageId ?? context.triggerMessageId
      if (!targetMessageId) {
        return { error: "no target message is available for this reaction" }
      }

      try {
        const result = await db.transaction(async (tx) => {
          const target = await tx
            .select({ id: schema.message.id })
            .from(schema.message)
            .innerJoin(
              schema.channel,
              eq(schema.message.channelId, schema.channel.id)
            )
            .where(
              and(
                eq(schema.message.id, targetMessageId),
                eq(schema.message.channelId, context.channelId),
                eq(schema.channel.workspaceId, context.workspaceId)
              )
            )
            .limit(1)
            .then((rows) => rows[0])

          if (!target) return null

          const inserted = await tx
            .insert(schema.messageReaction)
            .values({
              messageId: targetMessageId,
              userId: LOR_USER_ID,
              emoji,
            })
            .onConflictDoNothing()
            .returning({ id: schema.messageReaction.id })
            .then((rows) => rows.length > 0)

          const total = await tx
            .select({ value: count() })
            .from(schema.messageReaction)
            .where(
              and(
                eq(schema.messageReaction.messageId, targetMessageId),
                eq(schema.messageReaction.emoji, emoji)
              )
            )
            .then((rows) => rows[0]?.value ?? 0)

          return { inserted, count: total }
        })

        if (!result) return { error: "message not found in this channel" }

        const lor = await loadLorIdentity()
        const update: RealtimeMessageReactionUpdated = {
          channelId: context.channelId,
          messageId: targetMessageId,
          emoji,
          count: result.count,
          actorUserId: LOR_USER_ID,
          actorName: lor.name,
          reactedByActor: true,
        }

        let notification: TargetedReactionNotification | undefined
        if (result.inserted) {
          try {
            notification = await buildTargetedNotification({
              workspaceId: context.workspaceId,
              channelId: context.channelId,
              messageId: targetMessageId,
              emoji,
              actor: lor,
            })
          } catch (err) {
            logger.error(
              { err, messageId: targetMessageId },
              "Lor reaction notification build failed"
            )
          }
        }

        try {
          await context.onMessageReaction?.({ update, notification })
        } catch (err) {
          logger.error(
            { err, messageId: targetMessageId },
            "Lor reaction callback failed"
          )
        }

        return { ...update, inserted: result.inserted }
      } catch (err) {
        logger.error(
          { err, messageId: targetMessageId },
          "Lor message reaction failed"
        )
        return { error: "couldn't react to that message" }
      }
    },
    strict: true,
  }),
}
