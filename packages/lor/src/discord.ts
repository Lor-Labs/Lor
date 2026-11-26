import { and, db, eq, inArray, LOR_USER_ID, schema, sql } from "@repo/db"
import { channelAgentId } from "@repo/db/queries/agents"
import { env } from "@repo/env/server"
import { agentIdentityFor, type CreatureId } from "@repo/utils/bestiary"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import {
  STILLS,
  type StillSpec,
  stillKey,
  stillSvg,
} from "@repo/utils/face-stills"
import sharp from "sharp"

// Lor's Discord bot over REST (reference/always-on-agents.md §10;
// reference/agents-and-chats.md, decision 51: a Discord channel an agent is
// in is a place). The gateway connection that hears Discord lives in the
// API (apps/api/src/lib/discord). Everything here works without it.

const API = "https://discord.com/api/v10"

// What the bot asks for when it is added to a server: read and write the
// channel, make the webhook the agent posts through, and the role people
// mention the agent by.
const INVITE_PERMISSIONS =
  (1n << 6n) | // add reactions
  (1n << 10n) | // view channels
  (1n << 11n) | // send messages
  (1n << 14n) | // embed links
  (1n << 16n) | // read message history
  (1n << 28n) | // manage roles
  (1n << 29n) | // manage webhooks
  (1n << 35n) | // create public threads (the agent's own)
  (1n << 38n) // send messages in threads (typing there)

export const DISCORD_ADMINISTRATOR = 1n << 3n
export const DISCORD_MANAGE_CHANNELS = 1n << 4n
export const DISCORD_MANAGE_GUILD = 1n << 5n
// Text and announcement channels: the only kinds that become a place.
export const LINKABLE_CHANNEL_TYPES = new Set([0, 5])
// Discord's message length limit.
const MESSAGE_MAX = 2000

export function discordConfigured(): boolean {
  return Boolean(env.DISCORD_BOT_TOKEN && env.DISCORD_APPLICATION_ID)
}

export function discordInviteUrl(): string | null {
  if (!env.DISCORD_APPLICATION_ID) return null
  const params = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID,
    scope: "bot applications.commands",
    permissions: INVITE_PERMISSIONS.toString(),
  })
  return `https://discord.com/oauth2/authorize?${params}`
}

export function discordChannelUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`
}

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

// One REST call as the bot. A rate limit waits its retry_after once.
export async function discordRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; bot?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": "DiscordBot (https://lor.chat, 1)",
  }
  if (init.bot !== false) {
    if (!env.DISCORD_BOT_TOKEN) throw new Error("Discord is not set up")
    headers.Authorization = `Bot ${env.DISCORD_BOT_TOKEN}`
  }
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    if (res.status === 429 && attempt === 0) {
      const body = (await res.json().catch(() => ({}))) as {
        retry_after?: number
      }
      await new Promise((resolve) =>
        setTimeout(resolve, (body.retry_after ?? 1) * 1000)
      )
      continue
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      let message = text
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text
      } catch {}
      throw new DiscordApiError(res.status, message || `HTTP ${res.status}`)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
}

function encryptionKey() {
  const key = env.INTEGRATION_ENCRYPTION_KEY
  if (!key) throw new Error("INTEGRATION_ENCRYPTION_KEY is not set")
  return key
}

// Discord refuses webhook names with these words in them.
export function webhookSafeName(name: string) {
  return name.replace(/discord|clyde/gi, "Lor").slice(0, 80) || "Lor"
}

// The agent's face as a Discord avatar: its flat still, drawn to be seen
// from the front (the app's 3D face frozen at one angle reads worse), on a
// transparent background, with room around it because Discord crops
// avatars to a circle.
async function faceAvatar(face: StillSpec) {
  const svg = stillSvg(face, { size: 256, pad: 3.5 })
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return `data:image/png;base64,${png.toString("base64")}`
}

export type DiscordLink = typeof schema.channelDiscordLink.$inferSelect

export async function discordLinkFor(
  channelId: string
): Promise<DiscordLink | null> {
  const [link] = await db
    .select()
    .from(schema.channelDiscordLink)
    .where(eq(schema.channelDiscordLink.channelId, channelId))
  return link ?? null
}

export async function discordLinkByDiscordChannel(
  discordChannelId: string
): Promise<DiscordLink | null> {
  const [link] = await db
    .select()
    .from(schema.channelDiscordLink)
    .where(eq(schema.channelDiscordLink.discordChannelId, discordChannelId))
  return link ?? null
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Discord mapping writes (discord_message, discord_thread) and unlink hold
// one lock per Lor channel and run only while their link is still current
// (each link gets a new webhook), so work from an unlinked link can't leave
// mappings a relink would reuse. Null when the link changed.
export async function withDiscordLinkLock<T>(
  channelId: string,
  webhookId: string,
  run: (tx: Tx) => Promise<T>
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`discord-link:${channelId}`}, 0))`
    )
    const [current] = await tx
      .select({ webhookId: schema.channelDiscordLink.webhookId })
      .from(schema.channelDiscordLink)
      .where(eq(schema.channelDiscordLink.channelId, channelId))
    if (current?.webhookId !== webhookId) return null
    return run(tx)
  })
}

// The webhook the agent posts through, wearing its face.
export async function createAgentWebhook(input: {
  discordChannelId: string
  name: string
  creature: CreatureId
}) {
  const face = STILLS[input.creature]
  const hook = await discordRequest<{ id: string; token: string }>(
    `/channels/${input.discordChannelId}/webhooks`,
    {
      method: "POST",
      body: {
        name: webhookSafeName(input.name),
        avatar: await faceAvatar(face),
      },
    }
  )
  return {
    webhookId: hook.id,
    webhookToken: encryptSecret(hook.token, encryptionKey()),
    webhookCreature: stillKey(face),
  }
}

async function loadAgentIdentity(agentId: string) {
  const [agent] = await db
    .select({
      id: schema.agent.id,
      name: schema.agent.name,
      creature: schema.agent.creature,
    })
    .from(schema.agent)
    .where(eq(schema.agent.id, agentId))
  return agent ? agentIdentityFor(agent.id, agent) : null
}

export type AgentWebhook = typeof schema.discordAgentWebhook.$inferSelect

// The webhook an agent posts through in a place, made the first time it is
// needed: each agent in a Discord channel posts as itself.
export async function agentWebhookFor(
  link: DiscordLink,
  agentId: string
): Promise<AgentWebhook | null> {
  const where = and(
    eq(schema.discordAgentWebhook.channelId, link.channelId),
    eq(schema.discordAgentWebhook.agentId, agentId)
  )
  const [known] = await db
    .select()
    .from(schema.discordAgentWebhook)
    .where(where)
  if (known) return known
  const identity = await loadAgentIdentity(agentId)
  if (!identity) return null
  const hook = await createAgentWebhook({
    discordChannelId: link.discordChannelId,
    name: identity.name,
    creature: identity.creature,
  })
  const [made] = await db
    .insert(schema.discordAgentWebhook)
    .values({ channelId: link.channelId, agentId, ...hook })
    .onConflictDoNothing()
    .returning()
  if (made) return made
  // Another process made one first: this one is not needed.
  await discordRequest(`/webhooks/${hook.webhookId}`, {
    method: "DELETE",
  }).catch(() => {})
  const [winner] = await db
    .select()
    .from(schema.discordAgentWebhook)
    .where(where)
  return winner ?? null
}

// Whether a Discord webhook is one an agent posts through, and whose: its
// posts come back over the gateway and are not mirrored, and a reply to one
// is a reply to that agent.
export async function agentOfWebhook(
  webhookId: string
): Promise<{ agentId: string; channelId: string } | null> {
  const [row] = await db
    .select({
      agentId: schema.discordAgentWebhook.agentId,
      channelId: schema.discordAgentWebhook.channelId,
    })
    .from(schema.discordAgentWebhook)
    .where(eq(schema.discordAgentWebhook.webhookId, webhookId))
  return row ?? null
}

// An agent's role in a server goes when it is in none of its channels.
async function dropUnusedAgentRole(guildId: string, agentId: string) {
  const [elsewhere] = await db
    .select({ channelId: schema.channelDiscordLink.channelId })
    .from(schema.channelDiscordLink)
    .innerJoin(
      schema.channelAgent,
      eq(schema.channelAgent.channelId, schema.channelDiscordLink.channelId)
    )
    .where(
      and(
        eq(schema.channelDiscordLink.guildId, guildId),
        eq(schema.channelAgent.agentId, agentId)
      )
    )
    .limit(1)
  if (elsewhere) return
  const [role] = await db
    .delete(schema.discordAgentRole)
    .where(
      and(
        eq(schema.discordAgentRole.guildId, guildId),
        eq(schema.discordAgentRole.agentId, agentId)
      )
    )
    .returning({ roleId: schema.discordAgentRole.roleId })
  if (role) {
    await discordRequest(`/guilds/${guildId}/roles/${role.roleId}`, {
      method: "DELETE",
    }).catch(() => {})
  }
}

// What an agent had in a place it was taken out of: its webhook there, and
// its role when that was its last channel in the server. Run after its
// `channel_agent` row is gone.
export async function deleteAgentPlaceResources(
  link: DiscordLink,
  agentId: string
) {
  const [hook] = await db
    .delete(schema.discordAgentWebhook)
    .where(
      and(
        eq(schema.discordAgentWebhook.channelId, link.channelId),
        eq(schema.discordAgentWebhook.agentId, agentId)
      )
    )
    .returning({ webhookId: schema.discordAgentWebhook.webhookId })
  if (hook) {
    await discordRequest(`/webhooks/${hook.webhookId}`, {
      method: "DELETE",
    }).catch(() => {})
  }
  await dropUnusedAgentRole(link.guildId, agentId)
}

// What a place made in the Discord server: its agents' webhooks, and the
// roles of agents left in no other channel there. Run after the link row is
// gone.
export async function deleteLinkResources(link: DiscordLink) {
  const hooks = await db
    .delete(schema.discordAgentWebhook)
    .where(eq(schema.discordAgentWebhook.channelId, link.channelId))
    .returning({
      webhookId: schema.discordAgentWebhook.webhookId,
      agentId: schema.discordAgentWebhook.agentId,
    })
  for (const id of new Set([
    link.webhookId,
    ...hooks.map((h) => h.webhookId),
  ])) {
    await discordRequest(`/webhooks/${id}`, { method: "DELETE" }).catch(
      () => {}
    )
  }
  const roles = await db
    .select({ agentId: schema.discordAgentRole.agentId })
    .from(schema.discordAgentRole)
    .where(eq(schema.discordAgentRole.guildId, link.guildId))
  for (const role of roles) {
    await dropUnusedAgentRole(link.guildId, role.agentId)
  }
}

const ROLE_RETRY_MS = 10 * 60_000
const roleFailures = new Map<string, number>()

let botUser: Promise<string> | null = null
function botUserId() {
  botUser ??= discordRequest<{ id: string }>("/users/@me").then(
    (me) => me.id,
    (err: unknown) => {
      botUser = null
      throw err
    }
  )
  return botUser
}

// The role people mention an agent by in a Discord server (@Inky): made
// when the agent first has a place there, given to the bot so it pings no
// one, renamed with the agent. Mentioning the bot itself works too, and
// means the channel's first agent. Returns the role id, or null when the
// server didn't grant Manage Roles.
export async function syncAgentRole(
  guildId: string,
  agentId: string
): Promise<string | null> {
  if (!discordConfigured()) return null
  const identity = await loadAgentIdentity(agentId)
  if (!identity) return null
  const name = identity.name.slice(0, 100)
  const where = and(
    eq(schema.discordAgentRole.guildId, guildId),
    eq(schema.discordAgentRole.agentId, agentId)
  )
  const [known] = await db.select().from(schema.discordAgentRole).where(where)
  if (known?.roleName === name) return known.roleId
  if (known) {
    await discordRequest(`/guilds/${guildId}/roles/${known.roleId}`, {
      method: "PATCH",
      body: { name },
    })
    await db
      .update(schema.discordAgentRole)
      .set({ roleName: name })
      .where(where)
    return known.roleId
  }
  // A server that didn't grant Manage Roles is asked again at most every
  // 10 minutes, not on every post.
  const key = `${guildId}:${agentId}`
  if (Date.now() - (roleFailures.get(key) ?? 0) < ROLE_RETRY_MS) return null
  const role = await discordRequest<{ id: string }>(
    `/guilds/${guildId}/roles`,
    { method: "POST", body: { name, mentionable: true, permissions: "0" } }
  ).catch((err: unknown) => {
    roleFailures.set(key, Date.now())
    throw err
  })
  await discordRequest(
    `/guilds/${guildId}/members/${await botUserId()}/roles/${role.id}`,
    { method: "PUT" }
  ).catch(() => {})
  const [made] = await db
    .insert(schema.discordAgentRole)
    .values({ guildId, agentId, roleId: role.id, roleName: name })
    .onConflictDoNothing()
    .returning({ roleId: schema.discordAgentRole.roleId })
  if (made) return made.roleId
  // Another process made one first.
  await discordRequest(`/guilds/${guildId}/roles/${role.id}`, {
    method: "DELETE",
  }).catch(() => {})
  const [winner] = await db.select().from(schema.discordAgentRole).where(where)
  return winner?.roleId ?? null
}

// An agent was renamed: its role in every server it is in follows.
export async function syncAgentRoles(agentId: string) {
  const roles = await db
    .select({ guildId: schema.discordAgentRole.guildId })
    .from(schema.discordAgentRole)
    .where(eq(schema.discordAgentRole.agentId, agentId))
  for (const role of roles) {
    await syncAgentRole(role.guildId, agentId).catch(() => {})
  }
}

// The agents' roles in a server, by role id: a role mention in a message
// says which agent it names.
export async function agentRolesIn(guildId: string) {
  const rows = await db
    .select({
      roleId: schema.discordAgentRole.roleId,
      agentId: schema.discordAgentRole.agentId,
    })
    .from(schema.discordAgentRole)
    .where(eq(schema.discordAgentRole.guildId, guildId))
  return new Map(rows.map((row) => [row.roleId, row.agentId]))
}

// Lor's text for Discord: people mentioned by id become Discord mentions
// when they linked their account, else their name; citations drop.
export async function toDiscordContent(content: string) {
  const ids = [...content.matchAll(/<@([0-9a-f-]{36})>/g)].map(
    (match) => match[1] as string
  )
  const unique = [...new Set(ids)]
  const people =
    unique.length > 0
      ? await db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            discordUserId: schema.discordAccount.discordUserId,
          })
          .from(schema.user)
          .leftJoin(
            schema.discordAccount,
            eq(schema.discordAccount.userId, schema.user.id)
          )
          .where(inArray(schema.user.id, unique))
      : []
  const byId = new Map(people.map((person) => [person.id, person]))
  const allowed: string[] = []
  const text = content
    .replace(/<@([0-9a-f-]{36})>/g, (_, id: string) => {
      const person = byId.get(id)
      if (person?.discordUserId) {
        allowed.push(person.discordUserId)
        return `<@${person.discordUserId}>`
      }
      return `@${person?.name ?? "someone"}`
    })
    .replace(/\[\[(?:msg|call|src):[^\]]+\]\]/g, "")
    .trim()
  return { text, allowedUserIds: [...new Set(allowed)] }
}

// Discord takes 2000 characters a message: split at paragraph or line ends.
export function splitForDiscord(text: string): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > MESSAGE_MAX) {
    const window = rest.slice(0, MESSAGE_MAX)
    const cut = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" ")
    )
    const at = cut > MESSAGE_MAX / 2 ? cut : MESSAGE_MAX
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

export type DiscordButton = {
  customId: string
  label: string
  style: "primary" | "secondary" | "success" | "danger"
}

const BUTTON_STYLES = { primary: 1, secondary: 2, success: 3, danger: 4 }

// A message an agent posts in a place's Discord channel, under its own name
// and creature. Null when the channel isn't a place. The Lor message it
// mirrors maps to the first Discord message. With no agent given it is the
// place's first.
export async function postAgentToDiscord(input: {
  channelId: string
  agentId?: string | null
  messageId: string | null
  content: string
  buttons?: DiscordButton[]
  // The Lor thread the agent answers in: the post goes to its Discord
  // thread. Skipped when that thread isn't one Discord has.
  threadRootId?: string | null
}): Promise<{ discordMessageId: string } | null> {
  if (!discordConfigured()) return null
  const link = await discordLinkFor(input.channelId)
  if (!link) return null
  const threadId = input.threadRootId
    ? await discordThreadForRoot(input.threadRootId)
    : null
  if (input.threadRootId && !threadId) return null
  const agentId = input.agentId ?? (await channelAgentId(input.channelId))
  if (!agentId) return null
  const identity = await loadAgentIdentity(agentId)
  if (!identity) return null
  const hook = await agentWebhookFor(link, agentId)
  if (!hook) return null
  await syncAgentRole(link.guildId, agentId).catch(() => {})
  // Discord's webhook avatar can't be set per message without a public URL,
  // so the webhook's own avatar follows the face: a change of creature, or
  // of how one is drawn, changes its key and uploads it again.
  const face = STILLS[identity.creature]
  const avatarKey = stillKey(face)
  // A failed avatar refresh never blocks the post; the old key retries it next time.
  if (hook.webhookCreature !== avatarKey) {
    try {
      await discordRequest(`/webhooks/${hook.webhookId}`, {
        method: "PATCH",
        body: { avatar: await faceAvatar(face) },
      })
      await db
        .update(schema.discordAgentWebhook)
        .set({ webhookCreature: avatarKey })
        .where(
          and(
            eq(schema.discordAgentWebhook.channelId, link.channelId),
            eq(schema.discordAgentWebhook.agentId, agentId)
          )
        )
    } catch (error) {
      console.warn("Discord webhook avatar refresh failed", error)
    }
  }
  const token = decryptSecret(hook.webhookToken, encryptionKey())
  const { text, allowedUserIds } = await toDiscordContent(input.content)
  const parts = splitForDiscord(text || "…")
  let first: string | null = null
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1
    const posted = await discordRequest<{ id: string }>(
      `/webhooks/${hook.webhookId}/${token}?wait=true&with_components=true${threadId ? `&thread_id=${threadId}` : ""}`,
      {
        method: "POST",
        bot: false,
        body: {
          content: part,
          username: webhookSafeName(identity.name),
          allowed_mentions: { parse: [], users: allowedUserIds },
          ...(last && input.buttons?.length
            ? {
                components: [
                  {
                    type: 1,
                    components: input.buttons.map((button) => ({
                      type: 2,
                      style: BUTTON_STYLES[button.style],
                      label: button.label,
                      custom_id: button.customId,
                    })),
                  },
                ],
              }
            : {}),
        },
      }
    )
    first ??= posted.id
  }
  const messageId = input.messageId
  if (first && messageId) {
    const discordMessageId = first
    await withDiscordLinkLock(input.channelId, link.webhookId, (tx) =>
      tx
        .insert(schema.discordMessage)
        .values({ discordMessageId, messageId, channelId: input.channelId })
        .onConflictDoNothing()
    )
  }
  return first ? { discordMessageId: first } : null
}

// "Lor is typing" in Discord, in the chat or the thread the turn answers in.
// It lasts about 10 seconds a call.
export async function showDiscordTyping(
  channelId: string,
  threadRootId: string | null = null
) {
  if (!discordConfigured()) return
  const link = await discordLinkFor(channelId)
  if (!link) return
  const target = threadRootId
    ? await discordThreadForRoot(threadRootId)
    : link.discordChannelId
  if (!target) return
  await discordRequest(`/channels/${target}/typing`, {
    method: "POST",
  }).catch(() => {})
}

// A Discord thread the agent starts on the Discord copy of the message it
// answers, paired with the Lor thread on the same message. Null when the
// channel isn't linked or the message never came from Discord.
export async function startDiscordThread(input: {
  channelId: string
  threadRootId: string
  name: string
}): Promise<string | null> {
  if (!discordConfigured()) return null
  const link = await discordLinkFor(input.channelId)
  if (!link) return null
  const existing = await discordThreadForRoot(input.threadRootId)
  if (existing) return existing
  const [root] = await db
    .select({ id: schema.discordMessage.discordMessageId })
    .from(schema.discordMessage)
    .where(eq(schema.discordMessage.messageId, input.threadRootId))
  if (!root) return null
  const threadId = await discordRequest<{ id: string }>(
    `/channels/${link.discordChannelId}/messages/${root.id}/threads`,
    {
      method: "POST",
      body: { name: input.name.slice(0, 100), auto_archive_duration: 1440 },
    }
  ).then(
    (thread) => thread.id,
    async (err: unknown) => {
      // The message already has a thread (its mapping never saved): a
      // message's thread shares the message's id.
      const existing = await discordRequest<{
        id: string
        parent_id?: string | null
      }>(`/channels/${root.id}`).catch(() => null)
      if (existing?.parent_id !== link.discordChannelId) throw err
      return existing.id
    }
  )
  return withDiscordLinkLock(input.channelId, link.webhookId, async (tx) => {
    await tx
      .insert(schema.discordThread)
      .values({
        discordThreadId: threadId,
        channelId: input.channelId,
        threadRootId: input.threadRootId,
      })
      .onConflictDoNothing()
    return threadId
  })
}

export async function discordThreadForRoot(
  threadRootId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.discordThread.discordThreadId })
    .from(schema.discordThread)
    .where(eq(schema.discordThread.threadRootId, threadRootId))
  return row?.id ?? null
}

export function isLorMention(content: string) {
  return content.includes(`<@${LOR_USER_ID}>`)
}
