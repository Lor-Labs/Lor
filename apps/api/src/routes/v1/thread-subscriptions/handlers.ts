import { and, asc, db, eq, isNull, schema } from "@repo/db"
import { subscribeToThread } from "@repo/db/queries/thread-subscriptions"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"
import type {
  AddThreadSubscriberRoute,
  ListThreadSubscribersRoute,
  RemoveThreadSubscriberRoute,
} from "@/routes/v1/thread-subscriptions/routes"

const notFound = { success: false as const, message: "Thread not found" }

// Same gate as marking a thread read: a real thread root in this workspace's
// channel, and the caller can see the channel. One 404 for missing and
// forbidden.
async function canUseThread(args: {
  workspaceId: string
  channelId: string
  threadRootId: string
  userId: string
}) {
  const root = await db
    .select({ id: schema.message.id })
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
  return Boolean(root) && userCanAccessChannel(args.channelId, args.userId)
}

export const listThreadSubscribers: AppRouteHandler<
  ListThreadSubscribersRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId } = c.req.valid("param")
  if (
    !(await canUseThread({
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
  // Anyone who can see the thread can add someone, but only someone who can
  // see the channel too.
  if (
    !(await canUseThread({
      workspaceId: workspace.id,
      channelId,
      threadRootId,
      userId: c.var.user.id,
    })) ||
    !(await userCanAccessChannel(channelId, userId))
  ) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  }

  await subscribeToThread(threadRootId, [userId])
  notifyWorkspaceActivity(workspace.id)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const removeThreadSubscriber: AppRouteHandler<
  RemoveThreadSubscriberRoute
> = async (c) => {
  const workspace = c.var.workspace
  const { channelId, threadRootId, userId } = c.req.valid("param")
  if (
    !(await canUseThread({
      workspaceId: workspace.id,
      channelId,
      threadRootId,
      userId: c.var.user.id,
    }))
  ) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
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
