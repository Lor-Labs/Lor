import { db, eq, inArray, LOR_USER_ID, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import { type CreatureId, channelAgentIdentity } from "@repo/utils/bestiary"
import { decryptSecret, encryptSecret } from "@repo/utils/crypto"
import {
  STILLS,
  type StillSpec,
  stillKey,
  stillSvg,
} from "@repo/utils/face-stills"
import sharp from "sharp"

// Lor's Discord bot over REST (reference/always-on-agents.md §10). The
// gateway connection that hears Discord lives in the API
// (apps/api/src/lib/discord). Everything here works without it.

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
// Text and announcement channels: the only kinds a Lor channel links to.
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

// What linking made in the Discord server: the webhook and the agent's role.
export async function deleteLinkResources(link: DiscordLink) {
  await discordRequest(`/webhooks/${link.webhookId}`, {
    method: "DELETE",
  }).catch(() => {})
  if (link.agentRoleId) {
    await discordRequest(`/guilds/${link.guildId}/roles/${link.agentRoleId}`, {
      method: "DELETE",
    }).catch(() => {})
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

// The role people mention the agent by in Discord (@Inky): made when the
// channel links, given to the bot so it pings no one, renamed with the
// agent. Mentioning the bot itself works too. Returns the role id, or null
// when the server didn't grant Manage Roles.
export async function syncAgentRole(channelId: string): Promise<string | null> {
  if (!discordConfigured()) return null
  const link = await discordLinkFor(channelId)
  if (!link) return null
  const [channel] = await db
    .select({
      id: schema.channel.id,
      agentName: schema.channel.agentName,
      agentCreature: schema.channel.agentCreature,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (!channel) return null
  const name = channelAgentIdentity(channel).name.slice(0, 100)
  if (link.agentRoleId && link.agentRoleName === name) return link.agentRoleId
  // A server that didn't grant Manage Roles is asked again at most every
  // 10 minutes, not on every post.
  const failedAt = roleFailures.get(channelId) ?? 0
  if (!link.agentRoleId && Date.now() - failedAt < ROLE_RETRY_MS) return null
  if (link.agentRoleId) {
    await discordRequest(`/guilds/${link.guildId}/roles/${link.agentRoleId}`, {
      method: "PATCH",
      body: { name },
    })
  } else {
    const role = await discordRequest<{ id: string }>(
      `/guilds/${link.guildId}/roles`,
      { method: "POST", body: { name, mentionable: true, permissions: "0" } }
    ).catch((err: unknown) => {
      roleFailures.set(channelId, Date.now())
      throw err
    })
    await discordRequest(
      `/guilds/${link.guildId}/members/${await botUserId()}/roles/${role.id}`,
      { method: "PUT" }
    ).catch(() => {})
    link.agentRoleId = role.id
  }
  await db
    .update(schema.channelDiscordLink)
    .set({ agentRoleId: link.agentRoleId, agentRoleName: name })
    .where(eq(schema.channelDiscordLink.channelId, channelId))
  return link.agentRoleId
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

// A message the channel agent posts in its linked Discord channel, under its
// name and creature. Null when the channel isn't linked. The Lor message it
// mirrors maps to the first Discord message.
export async function postAgentToDiscord(input: {
  channelId: string
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
  const [channel] = await db
    .select({
      id: schema.channel.id,
      agentName: schema.channel.agentName,
      agentCreature: schema.channel.agentCreature,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, input.channelId))
  if (!channel) return null
  const identity = channelAgentIdentity(channel)
  await syncAgentRole(input.channelId).catch(() => {})
  // Discord's webhook avatar can't be set per message without a public URL,
  // so the webhook's own avatar follows the face: a change of creature, or
  // of how one is drawn, changes its key and uploads it again.
  const face = STILLS[identity.creature]
  const avatarKey = stillKey(face)
  if (link.webhookCreature !== avatarKey) {
    await discordRequest(`/webhooks/${link.webhookId}`, {
      method: "PATCH",
      body: { avatar: await faceAvatar(face) },
    })
    await db
      .update(schema.channelDiscordLink)
      .set({ webhookCreature: avatarKey })
      .where(eq(schema.channelDiscordLink.channelId, link.channelId))
  }
  const token = decryptSecret(link.webhookToken, encryptionKey())
  const { text, allowedUserIds } = await toDiscordContent(input.content)
  const parts = splitForDiscord(text || "…")
  let first: string | null = null
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1
    const posted = await discordRequest<{ id: string }>(
      `/webhooks/${link.webhookId}/${token}?wait=true&with_components=true${threadId ? `&thread_id=${threadId}` : ""}`,
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
