import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { and, asc, db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { addInboxNote } from "@repo/lor/channel-agent"
import {
  agentRolesIn,
  DISCORD_ADMINISTRATOR,
  DISCORD_COMPONENTS_V2,
  DISCORD_MANAGE_CHANNELS,
  DISCORD_MANAGE_GUILD,
  discordLinkByDiscordChannel,
  discordRequest,
} from "@repo/lor/discord"
import { sessionCardFor } from "@repo/lor/discord-sessions"
import { decidedApprovalCard } from "@repo/lor/discord-ui"
import { AGENT_INBOX_BATCH_MS } from "@repo/realtime-types/queues"
import { flushAgentInbox } from "@/lib/agent-inbox-queue"
import {
  addAgentToDiscordChannel,
  connectDiscordGuild,
  discordGuildFor,
  removeAgentFromDiscordPlace,
} from "@/lib/discord/places"
import { logger } from "@/lib/logger"
import {
  hasWorkspaceAuthority,
  resolveWorkspaceAuthority,
} from "@/lib/permissions"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"
import { resolveApproval } from "@/routes/v1/approvals/handlers"

const agentOption = (description: string) => ({
  type: 3,
  name: "agent",
  description,
  required: true,
  autocomplete: true,
})

// The bot's slash commands, registered at each gateway start.
export const LOR_COMMANDS = [
  {
    name: "lor",
    description: "Lor, your team's workspace",
    options: [
      {
        type: 1,
        name: "link",
        description: "Connect this server to your Lor workspace",
        options: [
          {
            type: 3,
            name: "code",
            description: "The code from Connectors in Lor",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "add",
        description: "Put one of your team's agents in this channel",
        options: [agentOption("The agent to add")],
      },
      {
        type: 1,
        name: "remove",
        description: "Take an agent out of this channel",
        options: [agentOption("The agent to take out")],
      },
      {
        type: 1,
        name: "agents",
        description: "Which agents are in this channel",
      },
      {
        type: 1,
        name: "connect-account",
        description: "Link your Discord account to your Lor account",
      },
    ],
  },
]

const LINK_CODE_TTL_S = 15 * 60
const CONNECT_TTL_MS = 15 * 60 * 1000
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const linkCodeKey = (code: string) => `discord:link-code:${code}`

type LinkCodeData = { workspaceId: string; userId: string }

// A one-time code someone who manages the workspace's chats makes in Lor's
// Connectors and runs as `/lor link` in the Discord server. Running it
// proves they manage that server too.
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

// The link `/lor connect-account` shows only to the person who ran it.
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
  message?: { id: string; content: string; flags?: number }
  data?: {
    name?: string
    custom_id?: string
    // A select menu's picks.
    values?: string[]
    // A submitted form's fields, in their rows.
    components?: Array<{
      components?: Array<{ custom_id: string; value?: string }>
    }>
    options?: Array<{
      name: string
      type: number
      options?: Array<{ name: string; value: string; focused?: boolean }>
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

function hasPermission(interaction: DiscordInteraction, permission: bigint) {
  const permissions = BigInt(interaction.member?.permissions ?? "0")
  return (
    (permissions & DISCORD_ADMINISTRATOR) !== 0n ||
    (permissions & permission) !== 0n
  )
}

const NOT_CONNECTED =
  "This server isn't connected to a Lor workspace yet. In Lor, open Connectors, pick Discord, and run the code it gives you here with `/lor link`."

async function handleLink(interaction: DiscordInteraction, code: string) {
  if (!interaction.guild_id) {
    return reply(interaction, "Run `/lor link` in a server.")
  }
  if (!hasPermission(interaction, DISCORD_MANAGE_GUILD)) {
    return reply(
      interaction,
      "Connecting a server needs its Manage Server permission."
    )
  }
  const redis = await getRedisClient()
  const raw = await redis.getDel(linkCodeKey(code.trim().toUpperCase()))
  if (!raw) {
    return reply(
      interaction,
      "That code is wrong or expired. Make a new one in Lor, under Connectors."
    )
  }
  const data = JSON.parse(raw) as LinkCodeData
  const outcome = await connectDiscordGuild({
    guildId: interaction.guild_id,
    workspaceId: data.workspaceId,
    userId: data.userId,
  })
  if (outcome === "other_workspace") {
    return reply(
      interaction,
      "This server is already connected to another Lor workspace. Disconnect it there first."
    )
  }
  return reply(
    interaction,
    "Connected to your Lor workspace. Put an agent in a channel with `/lor add`, or from the agent's page in Lor."
  )
}

// Whoever ran a command, as a person in the workspace this server belongs
// to who may manage its chats: adding or removing an agent takes Manage
// Channels here and channel:update in Lor. An answer to give instead, when
// they may not.
async function managerOf(
  interaction: DiscordInteraction
): Promise<
  { userId: string; workspaceId: string; guildId: string } | { refusal: string }
> {
  const guildId = interaction.guild_id
  const discordUser = interaction.member?.user ?? interaction.user
  if (!guildId || !discordUser) return { refusal: "Run this in a server." }
  const guild = await discordGuildFor(guildId)
  if (!guild) return { refusal: NOT_CONNECTED }
  if (!hasPermission(interaction, DISCORD_MANAGE_CHANNELS)) {
    return {
      refusal: "This needs the Manage Channels permission in this channel.",
    }
  }
  const [person] = await db
    .select({
      member: schema.workspaceMember,
      ownerId: schema.workspace.ownerId,
    })
    .from(schema.discordAccount)
    .innerJoin(
      schema.workspaceMember,
      and(
        eq(schema.workspaceMember.userId, schema.discordAccount.userId),
        eq(schema.workspaceMember.workspaceId, guild.workspaceId)
      )
    )
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.workspaceMember.workspaceId)
    )
    .where(eq(schema.discordAccount.discordUserId, discordUser.id))
  if (!person) {
    return {
      refusal:
        "Link your Lor account first with `/lor connect-account`, then try again.",
    }
  }
  const authority = await resolveWorkspaceAuthority(person.member, {
    id: guild.workspaceId,
    ownerId: person.ownerId,
  })
  if (!hasWorkspaceAuthority(authority, { channel: ["update"] })) {
    return {
      refusal: "Your Lor account can't manage agents in this workspace.",
    }
  }
  return {
    userId: person.member.userId,
    workspaceId: guild.workspaceId,
    guildId,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The agent a command names: its id when picked from the list, else its
// name as typed.
async function agentNamed(workspaceId: string, value: string) {
  const wanted = value.trim()
  const agents = await db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.workspaceId, workspaceId))
    .orderBy(asc(schema.agent.createdAt))
  return (
    (UUID.test(wanted) ? agents.find((agent) => agent.id === wanted) : null) ??
    agents.find(
      (agent) =>
        agent.name.toLowerCase() === wanted.replace(/^@/, "").toLowerCase()
    ) ??
    null
  )
}

async function agentsHere(discordChannelId: string) {
  const link = await discordLinkByDiscordChannel(discordChannelId)
  if (!link) return { link: null, agents: [] }
  const agents = await db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.channelAgent)
    .innerJoin(schema.agent, eq(schema.agent.id, schema.channelAgent.agentId))
    .where(eq(schema.channelAgent.channelId, link.channelId))
    .orderBy(
      asc(schema.channelAgent.createdAt),
      asc(schema.channelAgent.agentId)
    )
  return { link, agents }
}

async function handleAdd(interaction: DiscordInteraction, value: string) {
  const manager = await managerOf(interaction)
  if ("refusal" in manager) return reply(interaction, manager.refusal)
  if (!interaction.channel_id) return
  const agent = await agentNamed(manager.workspaceId, value)
  if (!agent) {
    return reply(interaction, "Your Lor workspace has no agent by that name.")
  }
  const added = await addAgentToDiscordChannel({
    workspaceId: manager.workspaceId,
    guildId: manager.guildId,
    discordChannelId: interaction.channel_id,
    agentId: agent.id,
    userId: manager.userId,
  })
  if (!added.ok) {
    return reply(
      interaction,
      {
        no_server: NOT_CONNECTED,
        no_agent: "Your Lor workspace has no agent by that name.",
        not_a_text_channel:
          "Add an agent in a text channel, not a thread or forum.",
        already_here: `${agent.name} is already in this channel.`,
        too_many: "This channel has as many agents as one can hold.",
        discord_refused: `Discord didn't allow it: ${added.detail ?? "unknown error"}. Check that Lor can manage webhooks in this channel.`,
      }[added.reason]
    )
  }
  return reply(
    interaction,
    added.roleId
      ? `${added.agentName} is in this channel now. It answers when someone mentions <@&${added.roleId}> or replies to it.`
      : `${added.agentName} is in this channel now. It answers when someone mentions Lor or replies to it. To mention it by its own name, add Lor to this server again with its Manage Roles permission.`,
    { allowed_mentions: { parse: [] } }
  )
}

async function handleRemove(interaction: DiscordInteraction, value: string) {
  const manager = await managerOf(interaction)
  if ("refusal" in manager) return reply(interaction, manager.refusal)
  if (!interaction.channel_id) return
  const { link, agents } = await agentsHere(interaction.channel_id)
  const wanted = await agentNamed(manager.workspaceId, value)
  const agent = agents.find((here) => here.id === wanted?.id)
  if (!link || !agent) {
    return reply(interaction, "No agent by that name is in this channel.")
  }
  const removed = await removeAgentFromDiscordPlace({
    workspaceId: manager.workspaceId,
    channelId: link.channelId,
    agentId: agent.id,
    userId: manager.userId,
  })
  if (!removed) {
    return reply(interaction, `${agent.name} couldn't be taken out. Try again.`)
  }
  return reply(interaction, `${agent.name} is no longer in this channel.`)
}

async function handleAgents(interaction: DiscordInteraction) {
  if (!interaction.guild_id || !interaction.channel_id) return
  if (!(await discordGuildFor(interaction.guild_id))) {
    return reply(interaction, NOT_CONNECTED)
  }
  const { agents } = await agentsHere(interaction.channel_id)
  // None here: the same private panel as the hint's button.
  if (agents.length === 0) return agentMenu(interaction, "none")
  const roles = new Map(
    [...(await agentRolesIn(interaction.guild_id))].map(([roleId, agentId]) => [
      agentId,
      roleId,
    ])
  )
  return reply(
    interaction,
    `In this channel: ${agents
      .map((agent) => {
        const roleId = roles.get(agent.id)
        return roleId ? `<@&${roleId}>` : agent.name
      })
      .join(", ")}. Mention one or reply to it, and it answers here.`,
    { allowed_mentions: { parse: [] } }
  )
}

// The list under `/lor add` and `/lor remove` as someone types: the
// workspace's agents not here yet, or the ones here. Answered at once, with
// no acknowledgement first.
async function handleAutocomplete(interaction: DiscordInteraction) {
  const sub = interaction.data?.options?.[0]
  const typed = (
    sub?.options?.find((option) => option.focused)?.value ?? ""
  ).toLowerCase()
  const guild = interaction.guild_id
    ? await discordGuildFor(interaction.guild_id)
    : null
  let choices: { id: string; name: string; role?: string | null }[] = []
  if (guild && interaction.channel_id) {
    const here = (await agentsHere(interaction.channel_id)).agents
    if (sub?.name === "remove") {
      choices = here
    } else if (!("refusal" in (await managerOf(interaction)))) {
      // The workspace's agents, only for someone who may add one (like the
      // "Add an agent" menu).
      const all = await db
        .select({
          id: schema.agent.id,
          name: schema.agent.name,
          role: schema.agent.role,
        })
        .from(schema.agent)
        .where(eq(schema.agent.workspaceId, guild.workspaceId))
        .orderBy(asc(schema.agent.createdAt))
      choices = all.filter((agent) => !here.some((h) => h.id === agent.id))
    }
  }
  await discordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: "POST",
      bot: false,
      body: {
        type: 8,
        data: {
          choices: choices
            .filter((agent) => agent.name.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((agent) => ({
              name: (agent.role?.trim()
                ? `${agent.name} · ${agent.role.trim()}`
                : agent.name
              ).slice(0, 100),
              value: agent.id,
            })),
        },
      },
    }
  )
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
const SEND_ID = /^lor-send:([0-9a-f-]{36})$/
// The hint's buttons carry its message id ("none" from `/lor agents`).
const PICK_ID = /^lor-add:pick:(\d+|none)$/
const ADD_ID = /^lor-add:agent:([0-9a-f-]{36}):(\d+|none)$/
const SELECT_ID = /^lor-add:select:(\d+|none)$/

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
      "Link your Lor account first with `/lor connect-account`, then try again."
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
  const v2 = ((interaction.message?.flags ?? 0) & DISCORD_COMPONENTS_V2) !== 0
  const [decided] = v2
    ? await db
        .select({ description: schema.approval.description })
        .from(schema.approval)
        .where(eq(schema.approval.id, approvalId))
    : []
  await discordRequest(`${followUps(interaction)}/messages/@original`, {
    method: "PATCH",
    bot: false,
    body: v2
      ? {
          components: decidedApprovalCard({
            description: decided?.description ?? "",
            resolution,
            by: account.name,
          }),
          allowed_mentions: { parse: [] },
        }
      : {
          content: `${interaction.message?.content ?? ""}\n\n${resolution === "approved" ? "Approved" : "Rejected"} by ${account.name}.`,
          components: [],
          allowed_mentions: { parse: [] },
        },
  })
}

const displayName = (interaction: DiscordInteraction) =>
  interaction.member?.nick ??
  interaction.member?.user.global_name ??
  interaction.member?.user.username ??
  interaction.user?.global_name ??
  interaction.user?.username ??
  "Someone"

// What an agent is for, under its name in a menu: its role and the start
// of its brief.
function agentBlurb(agent: { role: string | null; brief: string | null }) {
  const role = agent.role?.trim() || "No role set"
  const brief = agent.brief?.replace(/\s+/g, " ").trim()
  const line = brief ? `${role} · ${brief}` : role
  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

// The private panel of agents to add to a channel with none
// (reference/agents-and-chats.md, decision 51): a menu for someone who may
// add one, else who can and the command to pass on. `hintId` is the public
// "No agent is in this channel yet" message, changed once one joins.
async function agentMenu(interaction: DiscordInteraction, hintId: string) {
  const manager = await managerOf(interaction)
  if ("refusal" in manager) {
    return reply(
      interaction,
      manager.refusal.includes("Manage Channels")
        ? "Only someone who can manage this channel can add an agent. Ask one of them to run `/lor add`."
        : manager.refusal
    )
  }
  if (!interaction.channel_id) return
  const here = (await agentsHere(interaction.channel_id)).agents
  const agents = (
    await db
      .select({
        id: schema.agent.id,
        name: schema.agent.name,
        role: schema.agent.role,
        brief: schema.agent.brief,
      })
      .from(schema.agent)
      .where(eq(schema.agent.workspaceId, manager.workspaceId))
      .orderBy(asc(schema.agent.createdAt))
  ).filter((agent) => !here.some((h) => h.id === agent.id))
  if (agents.length === 0) {
    return reply(
      interaction,
      "Every agent in your workspace is in this channel already. Make another in Lor."
    )
  }
  const channel = interaction.channel?.name
  return reply(
    interaction,
    `Pick an agent for ${channel ? `#${channel}` : "this channel"}. It reads along and answers when someone mentions it.`,
    {
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `lor-add:select:${hintId}`,
              placeholder: "Choose an agent",
              options: agents.slice(0, 25).map((agent) => ({
                label: agent.name.slice(0, 100),
                value: agent.id,
                description: agentBlurb(agent),
              })),
            },
          ],
        },
      ],
    }
  )
}

// Adds an agent picked from the panel or named by the hint's button, then
// says so where the hint was. A private answer either way.
async function addFromHint(
  interaction: DiscordInteraction,
  agentId: string,
  hintId: string,
  answer: (content: string) => Promise<unknown>
) {
  const manager = await managerOf(interaction)
  const [agent] = await db
    .select({ name: schema.agent.name })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  if ("refusal" in manager) {
    return answer(
      manager.refusal.includes("Manage Channels")
        ? `Only someone who can manage this channel can add an agent. Ask one of them to run \`/lor add agent:${agent?.name ?? "name"}\`.`
        : manager.refusal
    )
  }
  if (!interaction.channel_id || !agent) return answer("That agent is gone.")
  const added = await addAgentToDiscordChannel({
    workspaceId: manager.workspaceId,
    guildId: manager.guildId,
    discordChannelId: interaction.channel_id,
    agentId,
    userId: manager.userId,
  })
  if (!added.ok) {
    return answer(
      {
        no_server: NOT_CONNECTED,
        no_agent: "That agent is gone.",
        not_a_text_channel:
          "Add an agent in a text channel, not a thread or forum.",
        already_here: `${agent.name} is already in this channel.`,
        too_many: "This channel has as many agents as one can hold.",
        discord_refused: `Discord didn't allow it: ${added.detail ?? "unknown error"}. Check that Lor can manage webhooks in this channel.`,
      }[added.reason]
    )
  }
  if (hintId !== "none") {
    await discordRequest(
      `/channels/${interaction.channel_id}/messages/${hintId}`,
      {
        method: "PATCH",
        body: {
          content: `${added.agentName} joined this channel, added by ${displayName(interaction)}.`,
          components: [],
          allowed_mentions: { parse: [] },
        },
      }
    ).catch(() => {})
  }
  return answer(`${added.agentName} is in this channel now.`)
}

// The private panel's menu answers by changing the panel itself.
async function updatePanel(interaction: DiscordInteraction, content: string) {
  await discordRequest(`${followUps(interaction)}/messages/@original`, {
    method: "PATCH",
    bot: false,
    body: { content, components: [], allowed_mentions: { parse: [] } },
  })
}

const SEND_TEXT = "text"

// "Follow up" on a session's card opens a form at once: Discord takes
// a form only as the first answer.
async function openSendForm(
  interaction: DiscordInteraction,
  sessionId: string
) {
  const [session] = await db
    .select({ title: schema.agentSession.title })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, sessionId))
  await discordRequest(
    `/interactions/${interaction.id}/${interaction.token}/callback`,
    {
      method: "POST",
      bot: false,
      body: {
        type: 9,
        data: {
          custom_id: `lor-send:${sessionId}`,
          title: `Follow up on ${session?.title ?? "the session"}`.slice(0, 45),
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: SEND_TEXT,
                  style: 2,
                  label: "What should it do next?",
                  required: true,
                  max_length: 4000,
                },
              ],
            },
          ],
        },
      },
    }
  )
}

// The form sent: the agent that started the session hears it and passes it
// on (on the owner's plan), and the thread shows who sent what.
async function handleSendForm(
  interaction: DiscordInteraction,
  sessionId: string
) {
  const user = interaction.member?.user ?? interaction.user
  const value = interaction.data?.components
    ?.flatMap((row) => row.components ?? [])
    .find((field) => field.custom_id === SEND_TEXT)
    ?.value?.trim()
  if (!user || !value) return reply(interaction, "Nothing was sent.")
  const [account] = await db
    .select({ userId: schema.discordAccount.userId, name: schema.user.name })
    .from(schema.discordAccount)
    .innerJoin(schema.user, eq(schema.user.id, schema.discordAccount.userId))
    .where(eq(schema.discordAccount.discordUserId, user.id))
  if (!account) {
    return reply(
      interaction,
      "Link your Lor account first with `/lor connect-account`, then try again."
    )
  }
  const card = await sessionCardFor(sessionId)
  const [session] = card
    ? await db
        .select({
          title: schema.agentSession.title,
          workspaceId: schema.agentSession.workspaceId,
          conversationId: schema.agentSession.conversationId,
        })
        .from(schema.agentSession)
        .where(eq(schema.agentSession.id, sessionId))
    : []
  if (!card || !session) return reply(interaction, "That session is gone.")
  if (!(await userCanAccessChannel(card.channelId, account.userId))) {
    return reply(interaction, "Your Lor account can't reach this session.")
  }
  const conversationId = await addInboxNote({
    workspaceId: session.workspaceId,
    channelId: card.channelId,
    conversationId: session.conversationId,
    source: "session",
    sourceId: `discord-send:${interaction.id}`,
    note: `${account.name} sent this from Discord for session "${session.title}" (session ${sessionId}). Pass it on with message_session, then say so in the thread:\n${value}`,
    lane: "wake",
  })
  // Null: no agent can take it (the sourceId is this interaction's own, so
  // never a duplicate).
  if (!conversationId) {
    return reply(
      interaction,
      "No agent here can pass this on to the session, so nothing was sent."
    )
  }
  await flushAgentInbox(conversationId, AGENT_INBOX_BATCH_MS)
  if (interaction.channel_id) {
    await discordRequest(`/channels/${interaction.channel_id}/messages`, {
      method: "POST",
      body: {
        content: `**${displayName(interaction)}** followed up:\n>>> ${value.slice(0, 1800)}`,
        allowed_mentions: { parse: [] },
      },
    }).catch(() => {})
  }
  return reply(interaction, "Sent. The agent passes it on to the session.")
}

export async function handleDiscordInteraction(
  interaction: DiscordInteraction
) {
  if (interaction.type === 4) {
    return handleAutocomplete(interaction).catch((err) =>
      logger.warn(
        { err, interactionId: interaction.id },
        "Discord autocomplete failed"
      )
    )
  }
  try {
    if (interaction.type === 2 && interaction.data?.name === "lor") {
      await ack(interaction, "reply")
      const sub = interaction.data.options?.[0]
      const option = (name: string) =>
        sub?.options?.find((o) => o.name === name)?.value ?? ""
      if (sub?.name === "link") {
        return await handleLink(interaction, option("code"))
      }
      if (sub?.name === "add") {
        return await handleAdd(interaction, option("agent"))
      }
      if (sub?.name === "remove") {
        return await handleRemove(interaction, option("agent"))
      }
      if (sub?.name === "agents") return await handleAgents(interaction)
      if (sub?.name === "connect-account") {
        return await handleConnect(interaction)
      }
      return
    }
    if (interaction.type === 3) {
      const id = interaction.data?.custom_id ?? ""
      const match = id.match(APPROVAL_ID)
      if (match?.[1] && match[2]) {
        await ack(interaction, "update")
        return await handleApprovalButton(
          interaction,
          match[1],
          match[2] as "approved" | "rejected"
        )
      }
      const send = id.match(SEND_ID)
      if (send?.[1]) return await openSendForm(interaction, send[1])
      const pick = id.match(PICK_ID)
      if (pick?.[1]) {
        await ack(interaction, "reply")
        return await agentMenu(interaction, pick[1])
      }
      const named = id.match(ADD_ID)
      if (named?.[1] && named[2]) {
        await ack(interaction, "reply")
        return await addFromHint(interaction, named[1], named[2], (content) =>
          reply(interaction, content)
        )
      }
      const select = id.match(SELECT_ID)
      const picked = interaction.data?.values?.[0]
      if (select?.[1] && picked && UUID.test(picked)) {
        await ack(interaction, "update")
        return await addFromHint(interaction, picked, select[1], (content) =>
          updatePanel(interaction, content)
        )
      }
    }
    if (interaction.type === 5) {
      const send = interaction.data?.custom_id?.match(SEND_ID)
      if (send?.[1]) {
        await ack(interaction, "reply")
        return await handleSendForm(interaction, send[1])
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
