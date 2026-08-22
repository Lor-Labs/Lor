import { db, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { IntegrationProvider } from "@repo/db/schema"
import {
  agentProfile,
  channel,
  message,
  messageMention,
  messageReaction,
  user,
} from "@repo/db/schema"
import {
  listConnectorScopes as listScopes,
  searchConnector,
  searchConnectorFiles as searchFiles,
} from "@repo/merlin/connector-search"
import { and, asc, desc, eq, inArray, or } from "drizzle-orm"
import { allowedChannelConnectors } from "@/lib/channel-connectors"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspacePermission } from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import {
  fetchMessages,
  getAvatarColorsByUserId,
  messageSelect,
  referencedMessageSelect,
  toReferencedMessage,
} from "@/lib/queries/messages"
import { fetchChannelThreadActivity } from "@/lib/queries/thread-activity"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  CreateChannelRoute,
  DeleteChannelRoute,
  GetChannelRoute,
  GetMessageLocationRoute,
  ListChannelConnectorsRoute,
  ListChannelMessagesRoute,
  ListChannelsRoute,
  ListConnectorScopesRoute,
  ListPinnedMessagesRoute,
  ListThreadActivityRoute,
  ListThreadRepliesRoute,
  ReorderChannelsRoute,
  SearchChannelConnectorRoute,
  SearchConnectorFilesRoute,
  ToggleMessagePinRoute,
  UpdateChannelRoute,
} from "@/routes/v1/channels/routes"

const DEFAULT_CONNECTOR_SEARCH_LIMIT = 8

export const listChannels: AppRouteHandler<ListChannelsRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user

  const [allChannels, accessibleIds] = await Promise.all([
    db
      .select()
      .from(channel)
      .where(eq(channel.workspaceId, workspace.id))
      .orderBy(asc(channel.position)),
    listAccessibleChannelIds(currentUser.id, workspace.id),
  ])
  // Restricted channels the user isn't a member of are invisible, not locked.
  const channels = allChannels.filter((ch) => accessibleIds.has(ch.id))

  const categoryMap = new Map<string, typeof channels>()
  const categories: typeof channels = []
  const uncategorized: typeof channels = []

  for (const ch of channels) {
    if (ch.type === "category") {
      categories.push(ch)
      categoryMap.set(ch.id, [])
    }
  }

  for (const ch of channels) {
    if (ch.type === "category") continue
    const parent = ch.parentId ? categoryMap.get(ch.parentId) : undefined
    if (parent) {
      parent.push(ch)
    } else {
      uncategorized.push(ch)
    }
  }

  return c.json(
    {
      uncategorized,
      categories: categories.map((cat) => ({
        ...cat,
        channels: categoryMap.get(cat.id) ?? [],
      })),
    },
    HttpStatusCodes.OK
  )
}

export const createChannel: AppRouteHandler<CreateChannelRoute> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { audience, memberIds, ...body } = c.req.valid("json")

  assertWorkspacePermission(member, workspace, {
    channel: ["create"],
  })

  // Creating inside a category requires access to it — no planting channels
  // inside a private project.
  if (
    body.parentId &&
    !(await userCanAccessChannel(body.parentId, currentUser.id))
  ) {
    return c.json(
      { success: false, message: "Category not found" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Membership only matters for standalone private channels — a channel
  // inside a category inherits the container's audience.
  const isStandalonePrivate = audience === "members" && !body.parentId
  const resolvedMemberIds = isStandalonePrivate
    ? [...new Set([currentUser.id, ...(memberIds ?? [])])]
    : []
  if (isStandalonePrivate && resolvedMemberIds.length > 0) {
    const workspaceMemberRows = await db
      .select({ userId: schema.workspaceMember.userId })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, workspace.id),
          inArray(schema.workspaceMember.userId, resolvedMemberIds)
        )
      )
    if (workspaceMemberRows.length !== resolvedMemberIds.length) {
      return c.json(
        {
          success: false,
          message: "All channel members must belong to this workspace",
        },
        HttpStatusCodes.FORBIDDEN
      )
    }
  }

  const newChannel = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(channel)
      .values({
        ...body,
        audience: isStandalonePrivate ? "members" : "workspace",
        workspaceId: workspace.id,
      })
      .returning()
      .then((rows) => rows[0])
    if (inserted && isStandalonePrivate) {
      await tx.insert(schema.channelMember).values(
        resolvedMemberIds.map((userId) => ({
          channelId: inserted.id,
          userId,
        }))
      )
    }
    return inserted
  })

  if (!newChannel) {
    return c.json(
      { success: false, message: "Internal server error" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }

  return c.json(newChannel, HttpStatusCodes.CREATED)
}

export const reorderChannels: AppRouteHandler<ReorderChannelsRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const { channels: updates } = c.req.valid("json")

  assertWorkspacePermission(member, workspace, {
    channel: ["update"],
  })

  const channelIds = updates.map((u) => u.id)
  const uniqueChannelIds = [...new Set(channelIds)]

  // Verify all channels belong to this workspace
  const existing = await db
    .select({ id: channel.id, audience: channel.audience })
    .from(channel)
    .where(
      and(
        eq(channel.workspaceId, workspace.id),
        inArray(channel.id, uniqueChannelIds)
      )
    )

  if (existing.length !== uniqueChannelIds.length) {
    return c.json(
      {
        success: false,
        message: "One or more channels not found in workspace",
      },
      HttpStatusCodes.FORBIDDEN
    )
  }

  // Audience lives on the container: reject reorders that change a channel's
  // container when either side is private or a project — moving a project's
  // channels is project management, not a drag.
  const currentRows = await db
    .select({
      id: channel.id,
      parentId: channel.parentId,
      audience: channel.audience,
    })
    .from(channel)
    .where(inArray(channel.id, uniqueChannelIds))
  const currentById = new Map(currentRows.map((ch) => [ch.id, ch]))

  const referencedParentIds = [
    ...new Set(
      [
        ...updates.map((u) => u.parentId),
        ...currentRows.map((ch) => ch.parentId),
      ].filter((id): id is string => id !== null)
    ),
  ]
  const [parentRows, projectRows] = await Promise.all([
    referencedParentIds.length
      ? db
          .select({ id: channel.id, audience: channel.audience })
          .from(channel)
          .where(
            and(
              eq(channel.workspaceId, workspace.id),
              inArray(channel.id, referencedParentIds)
            )
          )
      : Promise.resolve([]),
    referencedParentIds.length
      ? db
          .select({ categoryChannelId: schema.project.categoryChannelId })
          .from(schema.project)
          .where(inArray(schema.project.categoryChannelId, referencedParentIds))
      : Promise.resolve([]),
  ])
  const parentAudienceById = new Map(
    parentRows.map((ch) => [ch.id, ch.audience])
  )
  const projectCategoryIds = new Set(
    projectRows.map((row) => row.categoryChannelId)
  )

  for (const update of updates) {
    const current = currentById.get(update.id)
    if (!current) continue
    const fromContainer = current.parentId ?? current.id
    const toContainer = update.parentId ?? update.id
    if (fromContainer === toContainer) continue
    const fromAudience = current.parentId
      ? (parentAudienceById.get(current.parentId) ?? "workspace")
      : current.audience
    const toAudience = update.parentId
      ? (parentAudienceById.get(update.parentId) ?? "workspace")
      : current.audience
    if (
      fromAudience === "members" ||
      toAudience === "members" ||
      projectCategoryIds.has(fromContainer) ||
      projectCategoryIds.has(toContainer)
    ) {
      return c.json(
        {
          success: false,
          message: "Channels cannot be moved into or out of a project",
        },
        HttpStatusCodes.FORBIDDEN
      )
    }
  }

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(channel)
        .set({ position: update.position, parentId: update.parentId })
        .where(
          and(eq(channel.id, update.id), eq(channel.workspaceId, workspace.id))
        )
    }
  })

  return c.json({ success: true }, HttpStatusCodes.OK)
}

export const getChannel: AppRouteHandler<GetChannelRoute> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  if (!(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const ch = await db
    .select()
    .from(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!ch) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(ch, HttpStatusCodes.OK)
}

export const updateChannel: AppRouteHandler<UpdateChannelRoute> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const body = c.req.valid("json")

  assertWorkspacePermission(member, workspace, {
    channel: ["update"],
  })

  // Channel-manage permission is workspace-wide, but a private channel is
  // invisible to non-members — including admins. No implicit admin access.
  if (!(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Assigning a Merlin profile: it must belong to this workspace (the FK alone
  // doesn't scope it). null clears the assignment (inherit category/default).
  if (body.agentProfileId) {
    const profile = await db
      .select({ id: agentProfile.id })
      .from(agentProfile)
      .where(
        and(
          eq(agentProfile.id, body.agentProfileId),
          eq(agentProfile.workspaceId, workspace.id)
        )
      )
      .limit(1)
      .then((r) => r[0])
    if (!profile) {
      return c.json(
        { success: false, message: "Profile not found" },
        HttpStatusCodes.NOT_FOUND
      )
    }
  }

  const updated = await db
    .update(channel)
    .set(body)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .returning()
    .then((rows) => rows[0])

  if (!updated) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(updated, HttpStatusCodes.OK)
}

export const deleteChannel: AppRouteHandler<DeleteChannelRoute> = async (c) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  assertWorkspacePermission(member, workspace, {
    channel: ["delete"],
  })

  if (!(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const deleted = await db
    .delete(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .returning({ id: channel.id })
    .then((rows) => rows[0])

  if (!deleted) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json({ success: true }, HttpStatusCodes.OK)
}

export const listChannelMessages: AppRouteHandler<
  ListChannelMessagesRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const { around, before, after, limit } = c.req.valid("query")

  // Verify channel belongs to this workspace
  const ch = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!ch || !(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(
    await fetchMessages({
      channelId,
      currentUserId: currentUser.id,
      limit,
      around,
      before,
      after,
    }),
    HttpStatusCodes.OK
  )
}

export const listThreadActivity: AppRouteHandler<
  ListThreadActivityRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  const ch = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!ch || !(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const data = await fetchChannelThreadActivity({
    channelId,
    currentUserId: currentUser.id,
  })

  return c.json({ data }, HttpStatusCodes.OK)
}

export const toggleMessagePin: AppRouteHandler<ToggleMessagePinRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  const member = c.var.member
  const currentUser = c.var.user
  const { channelId, messageId } = c.req.valid("param")

  assertWorkspacePermission(member, workspace, {
    message: ["pin"],
  })

  // Verify message exists in this channel and workspace
  const msg = await db
    .select({
      id: message.id,
      pinned: message.pinned,
      channelId: message.channelId,
    })
    .from(message)
    .innerJoin(channel, eq(message.channelId, channel.id))
    .where(
      and(
        eq(message.id, messageId),
        eq(message.channelId, channelId),
        eq(channel.workspaceId, workspace.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!msg || !(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Message not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const newPinned = !msg.pinned

  await db
    .update(message)
    .set({ pinned: newPinned })
    .where(eq(message.id, messageId))

  return c.json(
    { success: true as const, pinned: newPinned },
    HttpStatusCodes.OK
  )
}

export const listPinnedMessages: AppRouteHandler<
  ListPinnedMessagesRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  // Verify channel belongs to workspace
  const ch = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!ch || !(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Same shape as the shared message queries, minus the memory column the
  // client never sees.
  const { merlinMemories: _merlinMemories, ...pinnedMessageSelect } =
    messageSelect
  const messages = await db
    .select(pinnedMessageSelect)
    .from(message)
    .innerJoin(user, eq(message.authorId, user.id))
    .where(and(eq(message.channelId, channelId), eq(message.pinned, true)))
    .orderBy(desc(message.createdAt))

  const messageIds = messages.map((msg) => msg.id)
  const referencedMessageIds = messages
    .map((msg) => msg.referencedMessageId)
    .filter((id): id is string => id !== null)
  // Quoted messages join the same mention lookup so reply previews can resolve
  // the `<@uuid>` tokens inside the content they quote.
  const mentionLookupIds = [
    ...new Set([...messageIds, ...referencedMessageIds]),
  ]

  const mentionRows =
    mentionLookupIds.length > 0
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
              inArray(messageMention.messageId, mentionLookupIds),
              eq(messageMention.mentionType, "direct")
            )
          )
      : []

  const reactionRows =
    messageIds.length > 0
      ? await db
          .select({
            messageId: messageReaction.messageId,
            emoji: messageReaction.emoji,
            userId: messageReaction.userId,
            userName: user.name,
          })
          .from(messageReaction)
          .innerJoin(user, eq(messageReaction.userId, user.id))
          .where(inArray(messageReaction.messageId, messageIds))
      : []

  const referencedMessageRows =
    referencedMessageIds.length > 0
      ? await db
          .select(referencedMessageSelect)
          .from(message)
          .innerJoin(user, eq(message.authorId, user.id))
          .where(inArray(message.id, referencedMessageIds))
      : []

  const avatarColorByUserId = await getAvatarColorsByUserId(
    { workspaceId: workspace.id },
    [
      ...messages.map((msg) => msg.author.id),
      ...mentionRows.map((row) => row.id),
      ...referencedMessageRows.map((row) => row.authorId),
    ]
  )

  const mentionsByReferencedId = new Map<string, typeof mentionRows>()
  for (const row of mentionRows) {
    if (!referencedMessageIds.includes(row.messageId)) continue
    const existing = mentionsByReferencedId.get(row.messageId) ?? []
    existing.push(row)
    mentionsByReferencedId.set(row.messageId, existing)
  }

  const referencedMessagesById = new Map(
    referencedMessageRows.map((row) => {
      const referencedMessage = toReferencedMessage(row)
      return [
        row.id,
        {
          ...referencedMessage,
          author: {
            ...referencedMessage.author,
            avatarColor:
              avatarColorByUserId.get(referencedMessage.author.id) ?? null,
          },
          mentions: (mentionsByReferencedId.get(row.id) ?? []).map(
            ({ messageId: _messageId, ...mention }) => ({
              ...mention,
              avatarColor: avatarColorByUserId.get(mention.id) ?? null,
            })
          ),
        },
      ]
    })
  )

  const mentionsByMessageId = new Map<string, typeof mentionRows>()
  for (const row of mentionRows) {
    const existing = mentionsByMessageId.get(row.messageId) ?? []
    existing.push(row)
    mentionsByMessageId.set(row.messageId, existing)
  }

  const reactionsByMessageId = new Map<
    string,
    Map<
      string,
      {
        emoji: string
        count: number
        reactedByCurrentUser: boolean
        reactors: Array<{ id: string; name: string }>
      }
    >
  >()
  for (const row of reactionRows) {
    const reactionsByEmoji =
      reactionsByMessageId.get(row.messageId) ?? new Map()
    const existing = reactionsByEmoji.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      reactedByCurrentUser: false,
      reactors: [],
    }
    existing.count += 1
    existing.reactors.push({ id: row.userId, name: row.userName })
    if (row.userId === currentUser.id) {
      existing.reactedByCurrentUser = true
    }
    reactionsByEmoji.set(row.emoji, existing)
    reactionsByMessageId.set(row.messageId, reactionsByEmoji)
  }

  const data = messages.map((msg) => ({
    ...msg,
    author: {
      ...msg.author,
      avatarColor: avatarColorByUserId.get(msg.author.id) ?? null,
    },
    embeds: msg.embeds ?? [],
    merlinToolCalls: msg.merlinToolCalls ?? [],
    merlinReasoningSegments: msg.merlinReasoningSegments ?? [],
    mentions: (mentionsByMessageId.get(msg.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      username: m.username,
      displayUsername: m.displayUsername,
      image: m.image,
      avatarColor: avatarColorByUserId.get(m.id) ?? null,
    })),
    reactions: Array.from(reactionsByMessageId.get(msg.id)?.values() ?? []),
    referencedMessage: msg.referencedMessageId
      ? (referencedMessagesById.get(msg.referencedMessageId) ?? null)
      : null,
    threadSummary: null,
  }))

  return c.json({ data }, HttpStatusCodes.OK)
}

export const listThreadReplies: AppRouteHandler<
  ListThreadRepliesRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId, messageId } = c.req.valid("param")
  const { around, before, after, limit } = c.req.valid("query")

  // Verify channel belongs to this workspace.
  const ch = await db
    .select({ id: channel.id })
    .from(channel)
    .where(
      and(eq(channel.id, channelId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!ch || !(await userCanAccessChannel(channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Verify the root message exists, belongs to this channel, and is itself a
  // channel-level message (not a thread reply — threads are flat).
  const root = await db
    .select({ id: message.id, threadRootId: message.threadRootId })
    .from(message)
    .where(and(eq(message.id, messageId), eq(message.channelId, channelId)))
    .limit(1)
    .then((rows) => rows[0])

  if (!root || root.threadRootId !== null) {
    return c.json(
      { success: false, message: "Thread root not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  // Only hydrate the root on the initial page (no cursor) — the client reads
  // `root` from the first page only, so paginated calls skip the extra query.
  // The root is fetched as a single channel-level message (around + limit 1)
  // so the panel can show it even when it's scrolled out of the channel feed.
  const isInitialPage = !before && !after
  const [replies, rootResult, participantRows, taskCreatorRow] =
    await Promise.all([
      fetchMessages({
        channelId,
        currentUserId: currentUser.id,
        limit,
        around,
        before,
        after,
        threadRootId: messageId,
      }),
      isInitialPage
        ? fetchMessages({
            channelId,
            currentUserId: currentUser.id,
            limit: 1,
            around: messageId,
          })
        : Promise.resolve(null),
      isInitialPage
        ? db
            .selectDistinct({
              id: user.id,
              name: user.name,
              displayUsername: user.displayUsername,
              image: user.image,
              avatarColor: schema.workspaceMember.avatarColor,
            })
            .from(message)
            .innerJoin(user, eq(message.authorId, user.id))
            .leftJoin(
              schema.workspaceMember,
              and(
                eq(schema.workspaceMember.userId, user.id),
                eq(schema.workspaceMember.workspaceId, workspace.id)
              )
            )
            .where(
              and(
                eq(message.channelId, channelId),
                or(
                  eq(message.id, messageId),
                  eq(message.threadRootId, messageId)
                )
              )
            )
        : Promise.resolve([]),
      isInitialPage
        ? db
            .select({
              id: user.id,
              name: user.name,
              displayUsername: user.displayUsername,
              image: user.image,
              avatarColor: schema.workspaceMember.avatarColor,
            })
            .from(schema.task)
            .innerJoin(user, eq(schema.task.creatorId, user.id))
            .leftJoin(
              schema.workspaceMember,
              and(
                eq(schema.workspaceMember.userId, user.id),
                eq(schema.workspaceMember.workspaceId, workspace.id)
              )
            )
            .where(eq(schema.task.cardMessageId, messageId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ])

  const participants = new Map(
    participantRows.map((participant) => [participant.id, participant])
  )
  if (taskCreatorRow) participants.set(taskCreatorRow.id, taskCreatorRow)

  return c.json(
    {
      ...replies,
      root: rootResult?.data[0] ?? null,
      participants: [...participants.values()],
    },
    HttpStatusCodes.OK
  )
}

export const getMessageLocation: AppRouteHandler<
  GetMessageLocationRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { messageId } = c.req.valid("param")

  const row = await db
    .select({
      messageId: message.id,
      channelId: message.channelId,
      threadRootId: message.threadRootId,
    })
    .from(message)
    .innerJoin(channel, eq(message.channelId, channel.id))
    .where(
      and(eq(message.id, messageId), eq(channel.workspaceId, workspace.id))
    )
    .limit(1)
    .then((rows) => rows[0])

  // Same 404 for "doesn't exist" and "not allowed" — message ids must not
  // probe private channels.
  if (!row || !(await userCanAccessChannel(row.channelId, currentUser.id))) {
    return c.json(
      { success: false, message: "Message not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  return c.json(row, HttpStatusCodes.OK)
}

async function channelInWorkspace(channelId: string, workspaceId: string) {
  return db
    .select({ id: channel.id })
    .from(channel)
    .where(and(eq(channel.id, channelId), eq(channel.workspaceId, workspaceId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

// The channel must exist in this workspace, be visible to the caller, and
// actually grant the connector.
// Returns the failure to send, or null when the caller may proceed.
async function assertConnectorAllowed(
  workspaceId: string,
  channelId: string,
  provider: IntegrationProvider,
  userId: string
) {
  if (
    !(await channelInWorkspace(channelId, workspaceId)) ||
    !(await userCanAccessChannel(channelId, userId))
  ) {
    return {
      body: { success: false as const, message: "Channel not found" },
      status: HttpStatusCodes.NOT_FOUND,
    } as const
  }

  const connectors = await allowedChannelConnectors(workspaceId, channelId)
  if (!connectors.some((connector) => connector.id === provider)) {
    return {
      body: {
        success: false as const,
        message: "That connector isn't available here",
      },
      status: HttpStatusCodes.FORBIDDEN,
    } as const
  }

  return null
}

export const listChannelConnectors: AppRouteHandler<
  ListChannelConnectorsRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")

  if (
    !(await channelInWorkspace(channelId, workspace.id)) ||
    !(await userCanAccessChannel(channelId, currentUser.id))
  ) {
    return c.json(
      { success: false, message: "Channel not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }

  const connectors = await allowedChannelConnectors(workspace.id, channelId)
  return c.json({ connectors }, HttpStatusCodes.OK)
}

export const searchChannelConnector: AppRouteHandler<
  SearchChannelConnectorRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId, provider } = c.req.valid("param")
  const { q, limit } = c.req.valid("query")

  const denied = await assertConnectorAllowed(
    workspace.id,
    channelId,
    provider,
    currentUser.id
  )
  if (denied) return c.json(denied.body, denied.status)

  const results = await searchConnector(
    provider,
    workspace.id,
    q ?? "",
    limit ?? DEFAULT_CONNECTOR_SEARCH_LIMIT
  )
  return c.json({ results: results ?? [] }, HttpStatusCodes.OK)
}

export const listConnectorScopes: AppRouteHandler<
  ListConnectorScopesRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId, provider } = c.req.valid("param")

  const denied = await assertConnectorAllowed(
    workspace.id,
    channelId,
    provider,
    currentUser.id
  )
  if (denied) return c.json(denied.body, denied.status)

  const scopes = await listScopes(provider, workspace.id)
  return c.json({ scopes: scopes ?? [] }, HttpStatusCodes.OK)
}

export const searchConnectorFiles: AppRouteHandler<
  SearchConnectorFilesRoute
> = async (c) => {
  const workspace = c.var.workspace
  const currentUser = c.var.user
  const { channelId, provider } = c.req.valid("param")
  const { scope, q, limit } = c.req.valid("query")

  const denied = await assertConnectorAllowed(
    workspace.id,
    channelId,
    provider,
    currentUser.id
  )
  if (denied) return c.json(denied.body, denied.status)

  const results = await searchFiles(
    provider,
    workspace.id,
    scope,
    q ?? "",
    limit ?? DEFAULT_CONNECTOR_SEARCH_LIMIT
  )
  return c.json({ results: results ?? [] }, HttpStatusCodes.OK)
}
