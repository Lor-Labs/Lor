import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import {
  createAgentWebhook,
  DISCORD_ADMINISTRATOR,
  DISCORD_MANAGE_CHANNELS,
  deleteLinkResources,
  discordLinkByDiscordChannel,
  discordLinkFor,
  discordRequest,
  LINKABLE_CHANNEL_TYPES,
  postAgentToDiscord,
  syncAgentRole,
} from "@repo/lor/discord"
import { channelRoom } from "@repo/realtime-types"
import { channelAgentIdentity } from "@repo/utils/bestiary"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import { resolveApproval } from "@/routes/v1/approvals/handlers"

// The bot's slash commands, registered at each gateway start.
export const LOR_COMMANDS = [
  {
    name: "lor",
    description: "Lor, your team's workspace",
    options: [
      {
        type: 1,
        name: "link",
        description: "Move a Lor channel's chat here, with the code from Lor",
        options: [
          {
            type: 3,
            name: "code",
            description: "The code from the channel's Agent settings in Lor",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "unlink",
        description: "Move this channel's Lor chat back to Lor",
      },
      {
        type: 1,
        name: "connect",
        description: "Link your Discord account to your Lor account",
      },
    ],
  },
]

const LINK_CODE_TTL_S = 15 * 60
const CONNECT_TTL_MS = 15 * 60 * 1000
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const linkCodeKey = (code: string) => `discord:link-code:${code}`

type LinkCodeData = { channelId: string; workspaceId: string; userId: string }

// A one-time code a person with channel settings access makes in Lor and
// runs as `/lor link` in the Discord channel. Running it proves they can
// manage that Discord channel too.
export async function createLinkCode(data: LinkCodeData) {
  const raw = Array.from(
    { length: 8 },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  ).join("")
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`
  const redis = await getRedisClient()
  await redis.set(linkCodeKey(code), JSON.stringify(data), {
    EX: LINK_CODE_TTL_S,
  })
  return {
    code,
    expiresAt: new Date(Date.now() + LINK_CODE_TTL_S * 1000).toISOString(),
  }
}

function sign(payload: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`discord-connect:${payload}`)
    .digest("base64url")
}

// The link `/lor connect` shows only to the person who ran it.
function connectToken(discordUserId: string, username: string) {
  const payload = Buffer.from(
    JSON.stringify({
      d: discordUserId,
      n: username,
      e: Date.now() + CONNECT_TTL_MS,
    })
  ).toString("base64url")
  return `${payload}.${sign(payload)}`
}

export function readConnectToken(
  token: string
): { discordUserId: string; username: string } | null {
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      d: string
      n: string
      e: number
    }
    if (data.e < Date.now()) return null
    return { discordUserId: data.d, username: data.n }
  } catch {
    return null
  }
}

export type DiscordInteraction = {
  id: string
  token: string
  type: number
  guild_id?: string
  channel_id?: string
  channel?: { id: string; name?: string; type: number }
  member?: {
    permissions?: string
    nick?: string | null
    user: { id: string; username: string; global_name?: string | null }
  }
  user?: { id: string; username: string; global_name?: string | null }
  message?: { id: string; content: string }
  data?: {
    name?: string
    custom_id?: string
    options?: Array<{
      name: string
      type: number
      options?: Array<{ name: string; value: string }>
    }>
  }
}

// Discord wants an answer within 3 seconds, so every interaction is
// acknowledged first: a command with a private "thinking" reply, a button by
// deferring the message's update.
const acked = new WeakMap<DiscordInteraction, "reply" | "update">()

async function ack(interaction: DiscordInteraction, kind: "reply" | "update") {
  await discordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: "POST",
      bot: false,
      body: kind === "reply" ? { type: 5, data: { flags: 64 } } : { type: 6 },
    }
  )
  acked.set(interaction, kind)
}

const followUps = (interaction: DiscordInteraction) =>
  `/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`

// A private answer to whoever ran the command or clicked the button.
async function reply(
  interaction: DiscordInteraction,
  content: string,
  extra: Record<string, unknown> = {}
) {
  const state = acked.get(interaction)
  if (state === "reply") {
    await discordRequest(`${followUps(interaction)}/messages/@original`, {
      method: "PATCH",
      bot: false,
      body: { content, ...extra },
    })
  } else if (state === "update") {
    await discordRequest(followUps(interaction), {
      method: "POST",
      bot: false,
      body: { content, flags: 64, ...extra },
    })
  } else {
    await discordRequest(
      `/interactions/${interaction.id}/${interaction.token}/callback`,
      {
        method: "POST",
        bot: false,
        body: { type: 4, data: { content, flags: 64, ...extra } },
      }
    )
  }
}

function canManage(interaction: DiscordInteraction) {
  const permissions = BigInt(interaction.member?.permissions ?? "0")
  return (
    (permissions & DISCORD_ADMINISTRATOR) !== 0n ||
    (permissions & DISCORD_MANAGE_CHANNELS) !== 0n
  )
}

async function notifyLinkChanged(channelId: string) {
  const io = await getEmitter()
  io.to(channelRoom(channelId)).emit("channel:discord:updated", { channelId })
}

export async function unlinkDiscord(channelId: string) {
  const link = await discordLinkFor(channelId)
  if (!link) return false
  await db
    .delete(schema.channelDiscordLink)
    .where(eq(schema.channelDiscordLink.channelId, channelId))
  await deleteLinkResources(link)
  await notifyLinkChanged(channelId)
  return true
}

async function handleLink(
  interaction: DiscordInteraction,
  code: string,
  botName: string
) {
  if (!interaction.guild_id || !interaction.channel_id) {
    return reply(interaction, "Run `/lor link` in a server channel.")
  }
  if (!canManage(interaction)) {
    return reply(
      interaction,
      "Linking needs the Manage Channels permission in this channel."
    )
  }
  const channelType =
    interaction.channel?.type ??
    (
      await discordRequest<{ type: number }>(
        `/channels/${interaction.channel_id}`
      )
    ).type
  if (!LINKABLE_CHANNEL_TYPES.has(channelType)) {
    return reply(interaction, "Link a text channel, not a thread or forum.")
  }
  const redis = await getRedisClient()
  const raw = await redis.getDel(linkCodeKey(code.trim().toUpperCase()))
  if (!raw) {
    return reply(
      interaction,
      "That code is wrong or expired. Make a new one in the channel's Agent settings in Lor."
    )
  }
  const data = JSON.parse(raw) as LinkCodeData
  const taken = await discordLinkByDiscordChannel(interaction.channel_id)
  if (taken && taken.channelId !== data.channelId) {
    return reply(
      interaction,
      "This Discord channel is already linked to another Lor channel. Run `/lor unlink` first."
    )
  }
  const [channel] = await db
    .select({
      id: schema.channel.id,
      name: schema.channel.name,
      archivedAt: schema.channel.archivedAt,
      agentName: schema.channel.agentName,
      agentCreature: schema.channel.agentCreature,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, data.channelId))
  if (!channel || channel.archivedAt) {
    return reply(interaction, "That Lor channel no longer takes messages.")
  }
  await unlinkDiscord(channel.id)
  const identity = channelAgentIdentity(channel)
  const hook = await createAgentWebhook({
    discordChannelId: interaction.channel_id,
    name: identity.name,
    creature: identity.creature,
  })
  const guild = await discordRequest<{ name: string }>(
    `/guilds/${interaction.guild_id}`
  ).catch(() => null)
  await db.insert(schema.channelDiscordLink).values({
    channelId: channel.id,
    workspaceId: data.workspaceId,
    guildId: interaction.guild_id,
    guildName: guild?.name ?? null,
    discordChannelId: interaction.channel_id,
    discordChannelName: interaction.channel?.name ?? null,
    ...hook,
    webhookCreature: identity.creature,
    linkedById: data.userId,
  })
  await notifyLinkChanged(channel.id)
  const roleId = await syncAgentRole(channel.id).catch((err: unknown) => {
    logger.warn({ err, channelId: channel.id }, "Discord agent role failed")
    return null
  })
  await reply(
    interaction,
    roleId
      ? `Linked to #${channel.name ?? "channel"} in Lor. Its chat lives here now, and ${identity.name} answers when someone mentions @${identity.name} or @${botName}, or replies to it.`
      : `Linked to #${channel.name ?? "channel"} in Lor. Its chat lives here now, and ${identity.name} answers when someone mentions @${botName} or replies to it. To mention it as @${identity.name}, add Lor to this server again with its Manage Roles permission.`
  )
  await postAgentToDiscord({
    channelId: channel.id,
    messageId: null,
    content: `Hi, I'm ${identity.name}, this channel's agent from Lor. Mention ${roleId ? `<@&${roleId}>` : `@${botName}`} or reply to me, and I'll answer here.`,
  }).catch((err) =>
    logger.warn({ err, channelId: channel.id }, "Discord hello failed")
  )
}

async function handleUnlink(interaction: DiscordInteraction) {
  if (!canManage(interaction)) {
    return reply(
      interaction,
      "Unlinking needs the Manage Channels permission in this channel."
    )
  }
  const link = interaction.channel_id
    ? await discordLinkByDiscordChannel(interaction.channel_id)
    : null
  if (!link) return reply(interaction, "This channel isn't linked to Lor.")
  await unlinkDiscord(link.channelId)
  return reply(interaction, "Unlinked. The chat is back in Lor.")
}

async function handleConnect(interaction: DiscordInteraction) {
  const user = interaction.member?.user ?? interaction.user
  if (!user) return
  const url = `${env.APP_BASE_URL}/discord/connect?token=${encodeURIComponent(connectToken(user.id, user.global_name ?? user.username))}`
  await reply(
    interaction,
    "Open this link while signed in to Lor to link your accounts. It works for 15 minutes, and only you can see it.",
    {
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Link my Lor account", url },
          ],
        },
      ],
    }
  )
}

const APPROVAL_ID = /^lor-approval:([0-9a-f-]{36}):(approved|rejected)$/

// Approve or reject from the buttons on the agent's approval message: the
// clicker's linked Lor account decides, with the same checks as in Lor.
async function handleApprovalButton(
  interaction: DiscordInteraction,
  approvalId: string,
  resolution: "approved" | "rejected"
) {
  const user = interaction.member?.user ?? interaction.user
  if (!user) return
  const [account] = await db
    .select({
      userId: schema.discordAccount.userId,
      name: schema.user.name,
    })
    .from(schema.discordAccount)
    .innerJoin(schema.user, eq(schema.user.id, schema.discordAccount.userId))
    .where(eq(schema.discordAccount.discordUserId, user.id))
  if (!account) {
    return reply(
      interaction,
      "Link your Lor account first with `/lor connect`, then try again."
    )
  }
  const outcome = await resolveApproval(approvalId, account.userId, resolution)
  if (outcome.kind !== "resolved") {
    const why = {
      not_found: "That approval no longer exists.",
      forbidden: "Your Lor account can't decide this approval.",
      archived: "That Lor channel is read-only now.",
      conflict: "Someone already decided this one.",
      unsupported_target: "This tool no longer exists. Reject it in Lor.",
      post_failed: "Lor couldn't record that. Try again in Lor.",
    }[outcome.kind]
    return reply(interaction, why)
  }
  // The message with the buttons, decided: its buttons go.
  await discordRequest(`${followUps(interaction)}/messages/@original`, {
    method: "PATCH",
    bot: false,
    body: {
      content: `${interaction.message?.content ?? ""}\n\n${resolution === "approved" ? "Approved" : "Rejected"} by ${account.name}.`,
      components: [],
      allowed_mentions: { parse: [] },
    },
  })
}

export async function handleDiscordInteraction(
  interaction: DiscordInteraction,
  botName: string
) {
  try {
    if (interaction.type === 2 && interaction.data?.name === "lor") {
      await ack(interaction, "reply")
      const sub = interaction.data.options?.[0]
      if (sub?.name === "link") {
        const code = sub.options?.find((o) => o.name === "code")?.value ?? ""
        return await handleLink(interaction, code, botName)
      }
      if (sub?.name === "unlink") return await handleUnlink(interaction)
      if (sub?.name === "connect") return await handleConnect(interaction)
      return
    }
    if (interaction.type === 3) {
      const match = interaction.data?.custom_id?.match(APPROVAL_ID)
      if (match?.[1] && match[2]) {
        await ack(interaction, "update")
        return await handleApprovalButton(
          interaction,
          match[1],
          match[2] as "approved" | "rejected"
        )
      }
    }
  } catch (err) {
    logger.error(
      { err, interactionId: interaction.id },
      "Discord interaction failed"
    )
    await reply(interaction, "Something went wrong in Lor. Try again.").catch(
      () => {}
    )
  }
}
