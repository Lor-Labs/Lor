import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  schema,
  sql,
} from "@repo/db"
import { chatFeedMessage } from "@repo/db/queries/agent-sessions"
import { agentAuthorId, agentIdsByChannel } from "@repo/db/queries/agents"
import {
  joinChat,
  listAccessibleChannelIds,
  resolveChannelAccess,
} from "@repo/db/queries/channel-access"
import { buildNotificationContentPreview } from "@repo/messaging"
import { extractDirectMentionUserIds } from "@repo/messaging/mentions"
import { userRoom } from "@repo/realtime-types"
import { publishRealtime } from "@/lib/bot-messages"
import { postChannelEvent } from "@/lib/channel-events"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { hasWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  AddChatPeopleRoute,
  ListChatPeopleRoute,
  ListChatsRoute,
  RemoveChatPersonRoute,
  UpdateChatRoute,
} from "@/routes/v1/chats/routes"

// How many people a chat's avatar shows.
const PEOPLE_SHOWN = 4

const notFound = { success: false as const, message: "Chat not found" }

// The caller's chat list (reference/agents-and-chats.md, decisions 33, 35
// and 36): the chats they are in, minus the ones they hid and nothing was
// said in since. The client orders them: pinned first, then by last message.
export const listChats: AppRouteHandler<ListChatsRoute> = async (c) => {
  const workspace = c.var.workspace
  const me = c.var.user.id
  const { channel, channelMember, message, user } = schema

  // The newest message the chat feed shows, per chat. Event lines ("created
  // this channel", a rename) are not something said, except an agent
  // starting a session.
  const last = db
    .select({
      lastId: message.id,
      lastAt: message.createdAt,
      lastContent: message.content,
      lastFiles:
        sql<number>`jsonb_array_length(coalesce(${message.attachments}, '[]'::jsonb))`.as(
          "last_files"
        ),
      lastAuthorId: message.authorId,
      lastAuthorName:
        sql<string>`coalesce(${message.overrideName}, ${user.name})`.as(
          "last_author_name"
        ),
      lastAgentId: agentAuthorId(user).as("last_agent_id"),
    })
    .from(message)
    .innerJoin(user, eq(user.id, message.authorId))
    .where(
      and(
        eq(message.channelId, channel.id),
        chatFeedMessage(),
        or(
          ne(message.type, "event"),
          eq(message.eventType, "agent_session_started")
        )
      )
    )
    .orderBy(desc(message.createdAt))
    .limit(1)
    .as("last")

  const [rows, accessible] = await Promise.all([
    db
      .select({
        id: channel.id,
        name: channel.name,
        createdAt: channel.createdAt,
        audience: channel.audience,
        parentId: channel.parentId,
        pinnedAt: channelMember.pinnedAt,
        hiddenAt: channelMember.hiddenAt,
        lastId: last.lastId,
        lastAt: last.lastAt,
        lastContent: last.lastContent,
        lastFiles: last.lastFiles,
        lastAuthorId: last.lastAuthorId,
        lastAuthorName: last.lastAuthorName,
        lastAgentId: last.lastAgentId,
      })
      .from(channelMember)
      .innerJoin(channel, eq(channel.id, channelMember.channelId))
      .leftJoinLateral(last, sql`true`)
      .where(
        and(
          eq(channelMember.userId, me),
          eq(channel.workspaceId, workspace.id),
          eq(channel.type, "text"),
          isNull(channel.archivedAt)
        )
      ),
    listAccessibleChannelIds(me, workspace.id),
  ])
  // A chat the caller can no longer see is not listed, and one they hid
  // stays away until something is said in it.
  const shown = rows.filter(
    (row) =>
      accessible.has(row.id) &&
      !(row.hiddenAt && row.hiddenAt >= (row.lastAt ?? row.createdAt))
  )
  const ids = shown.map((row) => row.id)
  if (ids.length === 0) return c.json({ chats: [] }, HttpStatusCodes.OK)

  const mentionIds = [
    ...new Set(
      shown.flatMap((row) =>
        row.lastContent ? [...extractDirectMentionUserIds(row.lastContent)] : []
      )
    ),
  ]
  const [agentIds, members, privateParents, mentioned] = await Promise.all([
    agentIdsByChannel(ids),
    db
      .select({
        channelId: channelMember.channelId,
        id: user.id,
        name: user.name,
        image: user.image,
        avatarColor: schema.workspaceMember.avatarColor,
      })
      .from(channelMember)
      .innerJoin(user, eq(user.id, channelMember.userId))
      // Someone who left the workspace is no longer in its chats.
      .innerJoin(
        schema.workspaceMember,
        and(
          eq(schema.workspaceMember.userId, channelMember.userId),
          eq(schema.workspaceMember.workspaceId, workspace.id)
        )
      )
      .where(inArray(channelMember.channelId, ids))
      .orderBy(asc(channelMember.createdAt), asc(user.name)),
    db
      .select({ id: channel.id })
      .from(channel)
      .where(
        and(
          eq(channel.workspaceId, workspace.id),
          eq(channel.type, "category"),
          eq(channel.audience, "members")
        )
      )
      .then((found) => new Set(found.map((row) => row.id))),
    mentionIds.length > 0
      ? db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, mentionIds))
      : [],
  ])
  const peopleByChat = new Map<string, typeof members>()
  for (const member of members) {
    peopleByChat.set(member.channelId, [
      ...(peopleByChat.get(member.channelId) ?? []),
      member,
    ])
  }

  const chats = shown.map((row) => {
    const people = peopleByChat.get(row.id) ?? []
    // Other people first: the avatar is of who you are talking with.
    const ordered = [
      ...people.filter((person) => person.id !== me),
      ...people.filter((person) => person.id === me),
    ]
    const preview = row.lastContent?.trim()
      ? buildNotificationContentPreview({
          content: row.lastContent,
          mentions: mentioned,
        })
      : (row.lastFiles ?? 0) > 0
        ? `sent ${row.lastFiles === 1 ? "an attachment" : `${row.lastFiles} attachments`}`
        : "sent a message"
    return {
      id: row.id,
      name: row.name,
      private: row.parentId
        ? privateParents.has(row.parentId)
        : row.audience === "members",
      createdAt: row.createdAt.toISOString(),
      agentIds: agentIds.get(row.id) ?? [],
      people: ordered
        .slice(0, PEOPLE_SHOWN)
        .map(({ id, name, image, avatarColor }) => ({
          id,
          name,
          image,
          avatarColor,
        })),
      peopleCount: people.length,
      pinnedAt: row.pinnedAt?.toISOString() ?? null,
      lastMessage:
        row.lastId && row.lastAt && row.lastAuthorId
          ? {
              id: row.lastId,
              createdAt: row.lastAt.toISOString(),
              preview,
              authorId: row.lastAuthorId,
              authorName: row.lastAuthorName ?? "Someone",
              agentId: row.lastAgentId,
            }
          : null,
    }
  })
  return c.json({ chats }, HttpStatusCodes.OK)
}

// Pins and hides are the caller's own (decision 36). Only for a chat they
// are in.
export const updateChat: AppRouteHandler<UpdateChatRoute> = async (c) => {
  const workspace = c.var.workspace
  const me = c.var.user.id
  const { channelId } = c.req.valid("param")
  const body = c.req.valid("json")
  const { channelMember, channel } = schema

  const [chat] = await db
    .select({ id: channel.id })
    .from(channelMember)
    .innerJoin(channel, eq(channel.id, channelMember.channelId))
    .where(
      and(
        eq(channelMember.channelId, channelId),
        eq(channelMember.userId, me),
        eq(channel.workspaceId, workspace.id)
      )
    )
  if (!chat) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  const now = new Date()
  const [updated] = await db
    .update(channelMember)
    .set({
      ...(body.pinned !== undefined
        ? {
            pinnedAt: body.pinned ? now : null,
            // Pinning a chat you had put away brings it back.
            ...(body.pinned ? { hiddenAt: null } : {}),
          }
        : {}),
      // A hidden chat is not pinned.
      ...(body.hidden !== undefined
        ? body.hidden
          ? { hiddenAt: now, pinnedAt: null }
          : { hiddenAt: null }
        : {}),
    })
    .where(
      and(eq(channelMember.channelId, channelId), eq(channelMember.userId, me))
    )
    .returning({
      pinnedAt: channelMember.pinnedAt,
      hiddenAt: channelMember.hiddenAt,
    })
  if (!updated) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  return c.json(
    {
      success: true as const,
      pinnedAt: updated.pinnedAt?.toISOString() ?? null,
      hiddenAt: updated.hiddenAt?.toISOString() ?? null,
    },
    HttpStatusCodes.OK
  )
}

// The chat a people route names, when the caller can see it. A chat is a
// text channel of this workspace.
async function visibleChat(userId: string, workspaceId: string, id: string) {
  const access = await resolveChannelAccess(userId, id)
  if (!access.ok) return null
  const chat = access.access.channel
  if (chat.type !== "text" || chat.workspaceId !== workspaceId) return null
  return access.access
}

// A person's chat list changed from someone else's hand (added, removed):
// their sidebar refetches on this, as it does for a new chat.
function nudgeChatLists(workspaceId: string, channelId: string, ids: string[]) {
  void publishRealtime((io) => {
    for (const userId of ids) {
      io.to(userRoom(userId)).emit("channel:created", {
        workspaceId,
        channelId,
      })
    }
  }).catch((err) => logger.warn({ err, channelId }, "Chat list nudge failed"))
}

export const listChatPeople: AppRouteHandler<ListChatPeopleRoute> = async (
  c
) => {
  const { channelId } = c.req.valid("param")
  const { channelMember, user } = schema
  if (!(await visibleChat(c.var.user.id, c.var.workspace.id, channelId))) {
    return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  }
  // The avatar colour is the person's in this workspace.
  const people = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      avatarColor: schema.workspaceMember.avatarColor,
    })
    .from(channelMember)
    .innerJoin(user, eq(user.id, channelMember.userId))
    .leftJoin(
      schema.workspaceMember,
      and(
        eq(schema.workspaceMember.userId, user.id),
        eq(schema.workspaceMember.workspaceId, c.var.workspace.id)
      )
    )
    .where(and(eq(channelMember.channelId, channelId), eq(user.isBot, false)))
    .orderBy(asc(channelMember.createdAt), asc(user.name))
  return c.json({ people }, HttpStatusCodes.OK)
}

// Puts people in a chat (reference/agents-and-chats.md, decision 35). An
// open chat takes anyone in the workspace, from anyone who can see it. In a
// private chat the list is also who can see it, so adding takes
// channel:update; a chat inside a private project takes only people already
// in the project.
export const addChatPeople: AppRouteHandler<AddChatPeopleRoute> = async (c) => {
  const workspace = c.var.workspace
  const me = c.var.user.id
  const { channelId } = c.req.valid("param")
  const userIds = [...new Set(c.req.valid("json").userIds)]
  const { channelMember, user, workspaceMember } = schema

  const access = await visibleChat(me, workspace.id, channelId)
  if (!access) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  if (!access.canWrite) {
    return c.json(
      { success: false as const, message: "This chat is archived" },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  const members = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspace.id),
        inArray(workspaceMember.userId, userIds),
        eq(user.isBot, false)
      )
    )
  if (members.length !== userIds.length) {
    return c.json(
      {
        success: false as const,
        message: "Everyone added must belong to this workspace",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  }

  if (access.audience === "members") {
    if (access.accessContainerId === channelId) {
      if (!hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })) {
        return c.json(
          {
            success: false as const,
            message: "Only someone who manages chats can add to a private chat",
          },
          HttpStatusCodes.FORBIDDEN
        )
      }
    } else {
      const inProject = await db
        .select({ userId: channelMember.userId })
        .from(channelMember)
        .where(
          and(
            eq(channelMember.channelId, access.accessContainerId),
            inArray(channelMember.userId, userIds)
          )
        )
      if (inProject.length !== userIds.length) {
        return c.json(
          {
            success: false as const,
            message: "Add them to the project first",
          },
          HttpStatusCodes.BAD_REQUEST
        )
      }
    }
  }

  const already = await db
    .select({ userId: channelMember.userId })
    .from(channelMember)
    .where(
      and(
        eq(channelMember.channelId, channelId),
        inArray(channelMember.userId, userIds)
      )
    )
    .then((rows) => new Set(rows.map((row) => row.userId)))
  const added = userIds.filter((id) => !already.has(id))
  if (added.length === 0) {
    return c.json({ success: true as const }, HttpStatusCodes.OK)
  }
  await joinChat(channelId, added)

  // Joining yourself says nothing in the chat; adding others does.
  const others = added.filter((id) => id !== me)
  if (others.length > 0) {
    await postChannelEvent({
      channel: access.channel,
      actorId: me,
      eventType: "member_added",
      payload: { userIds: others },
    })
  }
  nudgeChatLists(workspace.id, channelId, added)
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

// Leaving a chat is anyone's own; removing someone else takes
// channel:update. In a private chat it also ends their sight of it.
export const removeChatPerson: AppRouteHandler<RemoveChatPersonRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const me = c.var.user.id
  const { channelId, userId } = c.req.valid("param")
  const { channelMember } = schema

  const access = await visibleChat(me, workspace.id, channelId)
  if (!access) return c.json(notFound, HttpStatusCodes.NOT_FOUND)
  if (
    userId !== me &&
    !hasWorkspaceAuthority(c.var.authority, { channel: ["update"] })
  ) {
    return c.json(
      {
        success: false as const,
        message: "Only someone who manages chats can remove people",
      },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const [removed] = await db
    .delete(channelMember)
    .where(
      and(
        eq(channelMember.channelId, channelId),
        eq(channelMember.userId, userId)
      )
    )
    .returning({ id: channelMember.id })
  if (!removed) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  await postChannelEvent(
    userId === me
      ? { channel: access.channel, actorId: me, eventType: "member_left" }
      : {
          channel: access.channel,
          actorId: me,
          eventType: "member_removed",
          payload: { userId },
        }
  )
  nudgeChatLists(workspace.id, channelId, [userId])
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
