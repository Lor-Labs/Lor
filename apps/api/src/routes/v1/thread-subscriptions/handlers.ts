import { and, asc, db, eq, inArray, isNull, schema } from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import { sendSubscribedPush } from "@repo/messaging"
import { type SubscribedNotification, userRoom } from "@repo/realtime-types"
import { HTTPException } from "hono/http-exception"
import { getEmitter } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { hasWorkspaceAuthority } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import type {
  AddThreadSubscriberRoute,
  ListThreadSubscribersRoute,
  RemoveThreadSubscriberRoute,
  SubscribeEveryoneRoute,
} from "@/routes/v1/thread-subscriptions/routes"

const notFound = { success: false as const, message: "Thread not found" }

// Same gate as marking a thread read: a real thread root in this workspace's
// channel, and the caller can see the channel. One 404 for missing and
// forbidden.
async function findUsableThread(args: {
  workspaceId: string
  channelId: string
  threadRootId: string
  userId: string
}) {
  const root = await db
    .select({
      channelName: schema.channel.name,
      authorId: schema.message.authorId,
    })
    .from(schema.message)
    .innerJoin(schema.channel, eq(schema.message.channelId, schema.channel.id))
    .where(
      and(
        eq(schema.message.id, args.threadRootId),
        isNull(schema.message.threadRootId),
        eq(schema.message.channelId, args.channelId),
        eq(schema.channel.workspaceId, args.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!root || !(await userCanAccessChannel(args.channelId, args.userId))) {
    return null
  }
  return root
}

export const listThreadSubscribers: AppRouteHandler<
  ListThreadSubscribersRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId } = c.req.valid("param")
  if (
    !(await findUsableThread({
      workspaceId: workspace.id,
      channelId,
      threadRootId,
      userId: c.var.user.id,
    }))
  ) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  }

  const subscribers = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      avatarColor: schema.workspaceMember.avatarColor,
    })
    .from(schema.threadSubscription)
    .innerJoin(
      schema.user,
      eq(schema.threadSubscription.userId, schema.user.id)
    )
    .leftJoin(
      schema.workspaceMember,
      and(
        eq(schema.workspaceMember.userId, schema.user.id),
        eq(schema.workspaceMember.workspaceId, workspace.id)
      )
    )
    .where(eq(schema.threadSubscription.threadRootId, threadRootId))
    .orderBy(asc(schema.threadSubscription.createdAt))

  return c.json({ subscribers }, HttpStatusCodes.OK)
}

export const addThreadSubscriber: AppRouteHandler<
  AddThreadSubscriberRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId, userId } = c.req.valid("param")
  const actor = c.var.user
  // Anyone who can see the thread can add someone, but only someone who can
  // see the channel too.
  const thread = await findUsableThread({
    workspaceId: workspace.id,
    channelId,
    threadRootId,
    userId: actor.id,
  })
  if (!thread || !(await userCanAccessChannel(channelId, userId))) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  }

  const added = await subscribeToThread(threadRootId, [userId])
  notifyWorkspaceActivity(workspace.id)
  if (added.length > 0 && userId !== actor.id) {
    void notifyAddedSubscriber({
      userId,
      notification: {
        workspaceId: workspace.id,
        channelId,
        channelName: thread.channelName ?? "channel",
        threadRootId,
        actorName: actor.name,
      },
    }).catch((err) =>
      logger.warn({ err, threadRootId, userId }, "Subscriber notify failed")
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

// "Everyone in #channel": every person who can see the channel follows the
// thread. No per-person "added you" notification; it would ping the channel.
export const subscribeEveryone: AppRouteHandler<
  SubscribeEveryoneRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId } = c.req.valid("param")
  if (
    !(await findUsableThread({
      workspaceId: workspace.id,
      channelId,
      threadRootId,
      userId: c.var.user.id,
    }))
  ) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  }

  const audience = await listChannelAudienceUserIds(channelId)
  const people =
    audience.length > 0
      ? await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(inArray(schema.user.id, audience), eq(schema.user.isBot, false))
          )
      : []
  const added = await subscribeToThread(
    threadRootId,
    people.map((person) => person.id)
  )
  notifyWorkspaceActivity(workspace.id)
  return c.json({ added: added.length }, HttpStatusCodes.OK)
}

const ADDED_NOTIFY_WINDOW_SECONDS = 10 * 60

// Being added notifies like a mention: an OS notification on open clients,
// a push on offline phones. At most once per person and thread per window,
// so remove/add cycles can't spam pushes.
async function notifyAddedSubscriber(input: {
  userId: string
  notification: Omit<SubscribedNotification, "sessionId" | "title">
}) {
  const redis = await getRedisClient()
  const first = await redis.set(
    `lor:thread-added:${input.notification.threadRootId}:${input.userId}`,
    "1",
    { NX: true, EX: ADDED_NOTIFY_WINDOW_SECONDS }
  )
  if (first !== "OK") return
  const session = await findAgentSessionByThreadRoot(
    input.notification.threadRootId
  )
  const notification: SubscribedNotification = {
    ...input.notification,
    sessionId: session?.id ?? null,
    title: session?.title ?? null,
  }
  const io = await getEmitter()
  io.to(userRoom(input.userId)).emit("notification:subscribed", notification)
  await sendSubscribedPush({
    userId: input.userId,
    notification,
    redis,
  })
}

export const removeThreadSubscriber: AppRouteHandler<
  RemoveThreadSubscriberRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId, userId } = c.req.valid("param")
  const thread = await findUsableThread({
    workspaceId: workspace.id,
    channelId,
    threadRootId,
    userId: c.var.user.id,
  })
  if (!thread) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  // Anyone may unfollow. Removing someone else is for whoever started the
  // thread (the session's creator, else the root's author) or a moderator.
  if (
    userId !== c.var.user.id &&
    !hasWorkspaceAuthority(c.var.authority, { message: ["delete"] })
  ) {
    const session = await findAgentSessionByThreadRoot(threadRootId)
    const starter = session ? session.creatorId : thread.authorId
    if (starter !== c.var.user.id) {
      throw new HTTPException(HttpStatusCodes.FORBIDDEN, {
        message: "Only the thread's starter can remove other people",
      })
    }
  }

  await db
    .delete(schema.threadSubscription)
    .where(
      and(
        eq(schema.threadSubscription.threadRootId, threadRootId),
        eq(schema.threadSubscription.userId, userId)
      )
    )
  notifyWorkspaceActivity(workspace.id)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
