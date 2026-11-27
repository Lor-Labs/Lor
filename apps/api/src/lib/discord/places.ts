import { and, asc, db, eq, inArray, schema } from "@repo/db"
import { MAX_CHANNEL_AGENTS } from "@repo/db/queries/agents"
import {
  agentFaceUrl,
  botUserId,
  createAgentWebhook,
  DiscordApiError,
  deleteLinkResources,
  discordChannelUrl,
  discordLinkByDiscordChannel,
  discordLinkFor,
  discordRequest,
  isPrivateDiscordChannel,
  LINKABLE_CHANNEL_TYPES,
  postAgentToDiscord,
  syncAgentRole,
  withDiscordLinkLock,
} from "@repo/lor/discord"
import { agentCardIdentity, helloCard } from "@repo/lor/discord-ui"
import { agentIdentityFor } from "@repo/utils/bestiary"
import {
  afterChannelAgentsChanged,
  emitAgentsUpdated,
  setChannelAgents,
} from "@/lib/agents"
import { stopChatAgents } from "@/lib/chat-archive"
import { backfillPlace } from "@/lib/discord/inbound"
import { logger } from "@/lib/logger"

// Places in Discord (reference/agents-and-chats.md, decisions 24 and 51): a
// server is connected to a workspace once, and a channel of it an agent is
// put in becomes a place. A place is a `channel` row of kind "place" with
// its `channel_discord_link`: which agents are in it is `channel_agent`,
// and what is said there is kept in `message` for their inboxes, so a chat's
// rules, Loops and sessions work in a place unchanged. No list in Lor shows
// it.

export async function discordGuildFor(guildId: string) {
  const [guild] = await db
    .select()
    .from(schema.discordGuild)
    .where(eq(schema.discordGuild.guildId, guildId))
  return guild ?? null
}

// Connects a server to a workspace: run from `/lor link` with a code from
// Lor's Connectors. A server belongs to one workspace.
export async function connectDiscordGuild(input: {
  guildId: string
  workspaceId: string
  userId: string
}): Promise<"connected" | "already" | "other_workspace"> {
  const known = await discordGuildFor(input.guildId)
  if (known) {
    return known.workspaceId === input.workspaceId
      ? "already"
      : "other_workspace"
  }
  const guild = await discordRequest<{ name: string }>(
    `/guilds/${input.guildId}`
  ).catch(() => null)
  const inserted = await db
    .insert(schema.discordGuild)
    .values({
      guildId: input.guildId,
      workspaceId: input.workspaceId,
      name: guild?.name ?? null,
      connectedById: input.userId,
    })
    .onConflictDoNothing()
    .returning({ guildId: schema.discordGuild.guildId })
  if (inserted.length > 0) return "connected"
  // Linked from another workspace (or this one) at the same moment.
  const owner = await discordGuildFor(input.guildId)
  return owner?.workspaceId === input.workspaceId
    ? "already"
    : "other_workspace"
}

// Takes a place away: its link and Discord mappings go, what the bot made
// for it in the server is deleted, and the row is archived, so nothing more
// runs there and its Loops pause. Its messages and sessions stay.
export async function removeDiscordPlace(channelId: string) {
  const link = await discordLinkFor(channelId)
  if (!link) return false
  const archivedAt = new Date()
  // Archived with the link delete, so an unlinked place is never left live.
  const removed = await withDiscordLinkLock(
    channelId,
    link.webhookId,
    async (tx) => {
      await tx
        .delete(schema.channelDiscordLink)
        .where(eq(schema.channelDiscordLink.channelId, channelId))
      await tx
        .delete(schema.discordThread)
        .where(eq(schema.discordThread.channelId, channelId))
      await tx
        .delete(schema.discordMessage)
        .where(eq(schema.discordMessage.channelId, channelId))
      await tx
        .update(schema.channel)
        .set({ archivedAt })
        .where(eq(schema.channel.id, channelId))
      return true
    }
  )
  if (!removed) return false
  await deleteLinkResources(link)
  await stopChatAgents(channelId, archivedAt).catch((err) =>
    logger.warn({ err, channelId }, "Removed place's agents not all stopped")
  )
  return true
}

// Disconnects a server: every place in it goes and the bot leaves.
export async function disconnectDiscordGuild(
  workspaceId: string,
  guildId: string
) {
  const guild = await discordGuildFor(guildId)
  if (!guild || guild.workspaceId !== workspaceId) return false
  const links = await db
    .select({ channelId: schema.channelDiscordLink.channelId })
    .from(schema.channelDiscordLink)
    .where(eq(schema.channelDiscordLink.guildId, guildId))
  for (const link of links) await removeDiscordPlace(link.channelId)
  // The bot leaves before the server's row goes, so a failed leave throws and
  // disconnecting again retries it. 404: the bot is already out (kicked).
  await discordRequest(`/users/@me/guilds/${guildId}`, {
    method: "DELETE",
  }).catch((err: unknown) => {
    if (err instanceof DiscordApiError && err.status === 404) return
    logger.error({ err, guildId }, "Discord leave failed")
    throw err
  })
  await db
    .delete(schema.discordAgentRole)
    .where(eq(schema.discordAgentRole.guildId, guildId))
  await db
    .delete(schema.discordGuild)
    .where(eq(schema.discordGuild.guildId, guildId))
  emitAgentsUpdated(workspaceId)
  return true
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// A place's agents in the order they were added, read under a lock on its
// channel row so concurrent adds and removes don't drop each other.
async function lockedPlaceAgents(tx: Tx, channelId: string) {
  await tx
    .select({ id: schema.channel.id })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .for("update")
  const rows = await tx
    .select({ agentId: schema.channelAgent.agentId })
    .from(schema.channelAgent)
    .where(eq(schema.channelAgent.channelId, channelId))
    .orderBy(
      asc(schema.channelAgent.createdAt),
      asc(schema.channelAgent.agentId)
    )
  return rows.map((row) => row.agentId)
}

export type DiscordPlace = {
  channelId: string
  guildId: string
  discordChannelId: string
  name: string | null
  url: string
  agentIds: string[]
}

// A workspace's places in Discord, with the agents in each in the order
// they were added.
export async function listDiscordPlaces(
  workspaceId: string
): Promise<DiscordPlace[]> {
  const links = await db
    .select({
      channelId: schema.channelDiscordLink.channelId,
      guildId: schema.channelDiscordLink.guildId,
      discordChannelId: schema.channelDiscordLink.discordChannelId,
      name: schema.channelDiscordLink.discordChannelName,
    })
    .from(schema.channelDiscordLink)
    .where(eq(schema.channelDiscordLink.workspaceId, workspaceId))
    .orderBy(asc(schema.channelDiscordLink.createdAt))
  if (links.length === 0) return []
  const placed = await db
    .select({
      channelId: schema.channelAgent.channelId,
      agentId: schema.channelAgent.agentId,
    })
    .from(schema.channelAgent)
    .where(
      inArray(
        schema.channelAgent.channelId,
        links.map((link) => link.channelId)
      )
    )
    .orderBy(
      asc(schema.channelAgent.createdAt),
      asc(schema.channelAgent.agentId)
    )
  return links.map((link) => ({
    ...link,
    url: discordChannelUrl(link.guildId, link.discordChannelId),
    agentIds: placed
      .filter((row) => row.channelId === link.channelId)
      .map((row) => row.agentId),
  }))
}

export type AddPlaceAgentResult =
  | { ok: true; channelId: string; agentName: string; roleId: string | null }
  | {
      ok: false
      reason:
        | "no_server"
        | "no_agent"
        | "not_a_text_channel"
        | "already_here"
        | "too_many"
        | "discord_refused"
      detail?: string
    }

// Puts an agent in a Discord channel of a connected server, making the
// channel a place when it is not one yet. The agent says hello there.
export async function addAgentToDiscordChannel(input: {
  workspaceId: string
  guildId: string
  discordChannelId: string
  agentId: string
  userId: string
}): Promise<AddPlaceAgentResult> {
  const guild = await discordGuildFor(input.guildId)
  if (!guild || guild.workspaceId !== input.workspaceId) {
    return { ok: false, reason: "no_server" }
  }
  const [agent] = await db
    .select({
      id: schema.agent.id,
      name: schema.agent.name,
      creature: schema.agent.creature,
    })
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.id, input.agentId),
        eq(schema.agent.workspaceId, input.workspaceId)
      )
    )
  if (!agent) return { ok: false, reason: "no_agent" }
  const identity = agentIdentityFor(agent.id, agent)

  const existing = await discordLinkByDiscordChannel(input.discordChannelId)
  if (existing && existing.workspaceId !== input.workspaceId) {
    return { ok: false, reason: "no_server" }
  }
  let channelId: string
  if (existing) {
    channelId = existing.channelId
    const placeId = channelId
    const failed = await db.transaction(
      async (tx): Promise<AddPlaceAgentResult | null> => {
        const current = await lockedPlaceAgents(tx, placeId)
        if (current.includes(agent.id)) {
          return { ok: false, reason: "already_here" }
        }
        if (current.length >= MAX_CHANNEL_AGENTS) {
          return { ok: false, reason: "too_many" }
        }
        const placed = await setChannelAgents({
          workspaceId: input.workspaceId,
          channelId: placeId,
          agentIds: [...current, agent.id],
          userId: input.userId,
          tx,
        })
        if (placed.ok) return null
        return {
          ok: false,
          reason: placed.reason === "too_many" ? "too_many" : "no_agent",
        }
      }
    )
    if (failed) return failed
  } else {
    let discordChannel: {
      name?: string
      type: number
      guild_id?: string
      permission_overwrites?: Array<{
        id: string
        type: number
        allow?: string
        deny: string
      }>
    }
    let hook: Awaited<ReturnType<typeof createAgentWebhook>>
    let isPrivate: boolean
    try {
      discordChannel = await discordRequest(
        `/channels/${input.discordChannelId}`
      )
      if (
        discordChannel.guild_id !== input.guildId ||
        !LINKABLE_CHANNEL_TYPES.has(discordChannel.type)
      ) {
        return { ok: false, reason: "not_a_text_channel" }
      }
      isPrivate = await isPrivateDiscordChannel(discordChannel)
      hook = await createAgentWebhook({
        discordChannelId: input.discordChannelId,
        name: identity.name,
        creature: identity.creature,
      })
    } catch (err) {
      if (!(err instanceof DiscordApiError)) throw err
      return { ok: false, reason: "discord_refused", detail: err.message }
    }
    const name = discordChannel.name ?? null
    const made = await db
      .transaction(async (tx) => {
        const [place] = await tx
          .insert(schema.channel)
          .values({
            name,
            type: "text",
            kind: "place",
            // A private Discord channel's copy is for the people in it
            // (`joinPrivatePlace`) and whoever put an agent there.
            audience: isPrivate ? "members" : "workspace",
            workspaceId: input.workspaceId,
            creatorId: input.userId,
          })
          .returning({ id: schema.channel.id })
        if (!place) throw new Error("Place not made")
        await tx.insert(schema.channelDiscordLink).values({
          channelId: place.id,
          workspaceId: input.workspaceId,
          guildId: input.guildId,
          guildName: guild.name,
          discordChannelId: input.discordChannelId,
          discordChannelName: name,
          webhookId: hook.webhookId,
          webhookToken: hook.webhookToken,
          linkedById: input.userId,
        })
        await tx
          .insert(schema.discordAgentWebhook)
          .values({ channelId: place.id, agentId: agent.id, ...hook })
        await tx.insert(schema.channelAgent).values({
          channelId: place.id,
          agentId: agent.id,
          addedById: input.userId,
        })
        if (isPrivate) {
          await tx
            .insert(schema.channelMember)
            .values({ channelId: place.id, userId: input.userId })
            .onConflictDoNothing()
        }
        return place.id
      })
      .catch(async (err: unknown) => {
        await discordRequest(`/webhooks/${hook.webhookId}`, {
          method: "DELETE",
        }).catch(() => {})
        logger.warn({ err }, "Discord place not made")
        return null
      })
    if (!made) {
      // Someone made this channel a place at the same moment: add the agent
      // to theirs. Any other failure is not "already here".
      const raced = await discordLinkByDiscordChannel(input.discordChannelId)
      if (raced) return addAgentToDiscordChannel(input)
      return { ok: false, reason: "discord_refused", detail: "Place not made" }
    }
    channelId = made
    // What was said before, so the agent can read back.
    const link = await discordLinkFor(made)
    if (link) {
      void botUserId()
        .then((bot) => backfillPlace(link, bot))
        .catch((err) =>
          logger.warn({ err, channelId: made }, "Discord backfill failed")
        )
    }
  }

  const roleId = await syncAgentRole(input.guildId, agent.id).catch(
    (err: unknown) => {
      logger.warn({ err, agentId: agent.id }, "Discord agent role failed")
      return null
    }
  )
  emitAgentsUpdated(input.workspaceId)
  // Its hello: a card with its face, role and how to reach it.
  const card = await agentCardIdentity(agent.id)
  await postAgentToDiscord({
    channelId,
    agentId: agent.id,
    messageId: null,
    content: "",
    components: helloCard({
      name: identity.name,
      role: card?.role ?? null,
      accent: card?.accent ?? 0x5865f2,
      face: await agentFaceUrl(channelId, agent.id).catch(() => null),
      roleId,
    }),
  }).catch((err) => logger.warn({ err, channelId }, "Discord hello failed"))
  return { ok: true, channelId, agentName: identity.name, roleId }
}

// Takes an agent out of a place. The place goes with its last agent.
export async function removeAgentFromDiscordPlace(input: {
  workspaceId: string
  channelId: string
  agentId: string
  userId: string
}): Promise<boolean> {
  const link = await discordLinkFor(input.channelId)
  if (!link || link.workspaceId !== input.workspaceId) return false
  const changed = await db.transaction(async (tx) => {
    const current = await lockedPlaceAgents(tx, input.channelId)
    if (!current.includes(input.agentId)) return null
    const rest = current.filter((id) => id !== input.agentId)
    const placed = await setChannelAgents({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      agentIds: rest,
      userId: input.userId,
      tx,
    })
    return placed.ok ? { rest, removed: placed.removed } : null
  })
  if (!changed) return false
  // Clears its inbox, pauses its Loops that report here, and deletes its
  // webhook and, when this was its last channel in the server, its role.
  await afterChannelAgentsChanged({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    hasAgent: changed.rest.length > 0,
    removed: changed.removed,
  })
  if (changed.rest.length === 0) await removeDiscordPlace(input.channelId)
  return true
}

// A place's Discord channel changed (renamed, made private or public): its
// copy in Lor follows. Made private, it keeps who was in it and adds whoever
// put an agent there.
export async function syncPlaceFromDiscord(channel: {
  id: string
  name?: string
  guild_id?: string
  permission_overwrites?: Array<{
    id: string
    type: number
    allow?: string
    deny: string
  }>
}) {
  const link = await discordLinkByDiscordChannel(channel.id)
  if (!link) return
  const audience = (await isPrivateDiscordChannel(channel))
    ? "members"
    : "workspace"
  await db
    .update(schema.channel)
    .set({ audience, ...(channel.name ? { name: channel.name } : {}) })
    .where(eq(schema.channel.id, link.channelId))
  if (channel.name) {
    await db
      .update(schema.channelDiscordLink)
      .set({ discordChannelName: channel.name })
      .where(eq(schema.channelDiscordLink.channelId, link.channelId))
  }
  if (audience === "members" && link.linkedById) {
    await db
      .insert(schema.channelMember)
      .values({ channelId: link.channelId, userId: link.linkedById })
      .onConflictDoNothing()
  }
  emitAgentsUpdated(link.workspaceId)
}
