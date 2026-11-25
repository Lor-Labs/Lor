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
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import { buildNotificationContentPreview } from "@repo/messaging"
import { extractDirectMentionUserIds } from "@repo/messaging/mentions"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { ListChatsRoute, UpdateChatRoute } from "@/routes/v1/chats/routes"

// How many people a chat's avatar shows.
const PEOPLE_SHOWN = 4

const notFound = { success: false as const, message: "Chat not found" }

// The caller's chat list (reference/agents-and-chats.md, decisions 33, 35
// and 36): the chats they are in, minus the ones they hid and nothing was
// said in since. The client orders them: pinned first, then by last message.
export const listChats: AppRouteHandler<ListChatsRoute> = async (c) => {
  const workspace = c.var.workspace
  const me = c.var.user.id
  const { channel, chatMember, message, user } = schema

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
        pinnedAt: chatMember.pinnedAt,
        hiddenAt: chatMember.hiddenAt,
        lastId: last.lastId,
        lastAt: last.lastAt,
        lastContent: last.lastContent,
        lastFiles: last.lastFiles,
        lastAuthorId: last.lastAuthorId,
        lastAuthorName: last.lastAuthorName,
        lastAgentId: last.lastAgentId,
      })
      .from(chatMember)
      .innerJoin(channel, eq(channel.id, chatMember.channelId))
      .leftJoinLateral(last, sql`true`)
      .where(
        and(
          eq(chatMember.userId, me),
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
        channelId: chatMember.channelId,
        id: user.id,
        name: user.name,
        image: user.image,
        avatarColor: schema.workspaceMember.avatarColor,
      })
      .from(chatMember)
      .innerJoin(user, eq(user.id, chatMember.userId))
      // Someone who left the workspace is no longer in its chats.
      .innerJoin(
        schema.workspaceMember,
        and(
          eq(schema.workspaceMember.userId, chatMember.userId),
          eq(schema.workspaceMember.workspaceId, workspace.id)
        )
      )
      .where(inArray(chatMember.channelId, ids))
      .orderBy(asc(chatMember.createdAt), asc(user.name)),
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
  const { chatMember, channel } = schema

  const [chat] = await db
    .select({ id: channel.id })
    .from(chatMember)
    .innerJoin(channel, eq(channel.id, chatMember.channelId))
    .where(
      and(
        eq(chatMember.channelId, channelId),
        eq(chatMember.userId, me),
        eq(channel.workspaceId, workspace.id)
      )
    )
  if (!chat) return c.json(notFound, HttpStatusCodes.NOT_FOUND)

  const now = new Date()
  const [updated] = await db
    .update(chatMember)
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
    .where(and(eq(chatMember.channelId, channelId), eq(chatMember.userId, me)))
    .returning({
      pinnedAt: chatMember.pinnedAt,
      hiddenAt: chatMember.hiddenAt,
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
