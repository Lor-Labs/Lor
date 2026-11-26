import {
  APP_USER_ID,
  asc,
  db,
  eq,
  inArray,
  LOR_USER_ID,
  schema,
} from "@repo/db"
import { addInboxMessage, agentsInThread } from "@repo/lor/channel-agent"
import {
  agentOfWebhook,
  agentRolesIn,
  type DiscordLink,
  discordLinkByDiscordChannel,
  discordLinkFor,
  discordRequest,
  withDiscordLinkLock,
} from "@repo/lor/discord"
import { loadThreadSummary } from "@repo/messaging"
import {
  channelRoom,
  type RealtimeMessage,
  threadRoom,
} from "@repo/realtime-types"
import { AGENT_INBOX_BATCH_MS } from "@repo/realtime-types/queues"
import { classifyAgentInbox, flushAgentInbox } from "@/lib/agent-inbox-queue"
import { getEmitter } from "@/lib/bot-messages"
import { discordGuildFor } from "@/lib/discord/places"
import { threadInfo } from "@/lib/discord/threads"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The parts of a Discord MESSAGE_CREATE event Lor reads.
export type DiscordMessageEvent = {
  id: string
  type: number
  channel_id: string
  guild_id?: string
  webhook_id?: string
  content: string
  author: {
    id: string
    username: string
    global_name?: string | null
    avatar?: string | null
    bot?: boolean
  }
  member?: { nick?: string | null }
  mentions?: Array<{
    id: string
    username: string
    global_name?: string | null
    member?: { nick?: string | null }
  }>
  mention_roles?: string[]
  message_reference?: { message_id?: string }
  referenced_message?: {
    webhook_id?: string | null
    author?: { id: string }
  } | null
  attachments?: Array<{ url: string; filename: string }>
}

function displayName(user: {
  username: string
  global_name?: string | null
  member?: { nick?: string | null }
}) {
  return user.member?.nick || user.global_name || user.username
}

function avatarUrl(user: { id: string; avatar?: string | null }) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
  }
  const index = Number((BigInt(user.id) >> 22n) % 6n)
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

async function lorUsersFor(discordUserIds: string[]) {
  if (discordUserIds.length === 0) return new Map<string, string>()
  const rows = await db
    .select({
      userId: schema.discordAccount.userId,
      discordUserId: schema.discordAccount.discordUserId,
    })
    .from(schema.discordAccount)
    .where(inArray(schema.discordAccount.discordUserId, discordUserIds))
  return new Map(rows.map((row) => [row.discordUserId, row.userId]))
}

// Discord's text in Lor's terms: an agent's role is that agent's mention,
// the bot's mention is Lor's (the place's first agent), people who linked
// their account are mentioned by their Lor id, everyone else by name.
function fromDiscordContent(
  event: DiscordMessageEvent,
  botUserId: string,
  agentRoles: Map<string, string>,
  lorIds: Map<string, string>
) {
  const names = new Map(
    (event.mentions ?? []).map((user) => [user.id, displayName(user)])
  )
  let text = event.content
    .replace(/<@!?(\d+)>/g, (_, id: string) => {
      if (id === botUserId) return `<@${LOR_USER_ID}>`
      const lorId = lorIds.get(id)
      return lorId ? `<@${lorId}>` : `@${names.get(id) ?? "someone"}`
    })
    .replace(/<@&(\d+)>/g, (_, id: string) => {
      const agentId = agentRoles.get(id)
      return agentId ? `<@${agentId}>` : "@role"
    })
    .replace(/<#(\d+)>/g, "#channel")
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
  for (const file of event.attachments ?? []) {
    text += `\n[${file.filename}](${file.url})`
  }
  return text.trim()
}

const NO_AGENT_HINT_S = 10 * 60

// Lor's bot shows in every channel it can see, and answers only in places.
// Someone who mentions it, or an agent, anywhere else is told why nothing
// happens and what to do, at most once per channel every 10 minutes.
async function hintNoAgentHere(event: DiscordMessageEvent, botUserId: string) {
  if (!event.guild_id || event.author.bot || event.webhook_id) return
  const mentionsBot = (event.mentions ?? []).some(
    (user) => user.id === botUserId
  )
  const roles = event.mention_roles ?? []
  if (!mentionsBot && roles.length === 0) return
  const guild = await discordGuildFor(event.guild_id)
  if (!mentionsBot) {
    if (!guild) return
    const agentRoles = await agentRolesIn(event.guild_id)
    if (!roles.some((id) => agentRoles.has(id))) return
  }
  const redis = await getRedisClient()
  const first = await redis.set(
    `discord:no-agent-hint:${event.channel_id}`,
    "1",
    { NX: true, EX: NO_AGENT_HINT_S }
  )
  if (first !== "OK") return
  await discordRequest(`/channels/${event.channel_id}/messages`, {
    method: "POST",
    body: {
      content: guild
        ? "No agent is in this channel yet. Someone who manages it can add one with `/lor add`."
        : "This server isn't connected to a Lor workspace yet. Connect it from Lor, under Connectors, then add an agent here with `/lor add`.",
      message_reference: { message_id: event.id, fail_if_not_exists: false },
      allowed_mentions: { parse: [] },
    },
  })
}

// A message someone wrote in a place's Discord channel, kept in the place
// and delivered to the inboxes of the agents in it like a chat message
// (reference/always-on-agents.md §10; reference/agents-and-chats.md,
// decision 51). The agents' own posts come back through their webhooks and
// are skipped.
export async function mirrorDiscordMessage(
  event: DiscordMessageEvent,
  botUserId: string
) {
  if (event.type !== 0 && event.type !== 19) return
  if (event.author.id === botUserId) return
  const direct = await discordLinkByDiscordChannel(event.channel_id)
  const link = direct ?? (await threadParentLink(event.channel_id))
  if (!link) {
    await hintNoAgentHere(event, botUserId).catch((err) =>
      logger.warn({ err, discordMessageId: event.id }, "Discord hint failed")
    )
    return
  }
  if (event.webhook_id && (await agentOfWebhook(event.webhook_id))) return
  const threadId = direct ? null : event.channel_id
  await mirrorInto(link, event, botUserId, threadId).catch((err) =>
    logger.error(
      { err, channelId: link.channelId, discordMessageId: event.id },
      "Discord message mirror failed"
    )
  )
}

// The linked channel above a Discord thread: from the gateway's thread list,
// else from a thread already mirrored.
async function threadParentLink(threadId: string): Promise<DiscordLink | null> {
  const info = threadInfo(threadId)
  if (info) return discordLinkByDiscordChannel(info.parentId)
  const [known] = await db
    .select({ channelId: schema.discordThread.channelId })
    .from(schema.discordThread)
    .where(eq(schema.discordThread.discordThreadId, threadId))
  return known ? discordLinkFor(known.channelId) : null
}

// The Lor thread a Discord thread maps to: one mirrored before, or the Lor
// copy of its starter message (a thread started from a message shares its
// id). Null when neither exists: the first message becomes the root.
async function threadRootFor(
  tx: Tx,
  threadId: string,
  channelId: string
): Promise<string | null> {
  const [known] = await tx
    .select({ rootId: schema.discordThread.threadRootId })
    .from(schema.discordThread)
    .where(eq(schema.discordThread.discordThreadId, threadId))
  if (known) return known.rootId
  const [starter] = await tx
    .select({ id: schema.message.id })
    .from(schema.discordMessage)
    .innerJoin(
      schema.message,
      eq(schema.message.id, schema.discordMessage.messageId)
    )
    .where(eq(schema.discordMessage.discordMessageId, threadId))
  if (!starter) return null
  await tx
    .insert(schema.discordThread)
    .values({ discordThreadId: threadId, channelId, threadRootId: starter.id })
    .onConflictDoNothing()
  return starter.id
}

// Keeps one Discord thread's messages in arrival order in this process. The
// link lock in persist is what makes only one message a thread's root.
const threadQueues = new Map<string, Promise<unknown>>()
function inThreadOrder<T>(threadId: string, run: () => Promise<T>) {
  const next = (threadQueues.get(threadId) ?? Promise.resolve()).then(run)
  const tail = next.catch(() => {})
  threadQueues.set(threadId, tail)
  void tail.then(() => {
    if (threadQueues.get(threadId) === tail) threadQueues.delete(threadId)
  })
  return next
}

async function mirrorInto(
  link: DiscordLink,
  event: DiscordMessageEvent,
  botUserId: string,
  threadId: string | null
) {
  const discordIds = [
    event.author.id,
    ...(event.mentions ?? []).map((user) => user.id),
  ]
  const lorIds = await lorUsersFor(discordIds)
  // A linked account posts as its person, if they can see the channel.
  const linkedAuthor = lorIds.get(event.author.id)
  const asPerson =
    !event.author.bot &&
    !event.webhook_id &&
    linkedAuthor &&
    (await userCanAccessChannel(link.channelId, linkedAuthor))
      ? linkedAuthor
      : null
  const content = fromDiscordContent(
    event,
    botUserId,
    await agentRolesIn(link.guildId),
    lorIds
  )
  if (!content) return

  const [channel] = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
      workspaceName: schema.workspace.name,
      archivedAt: schema.channel.archivedAt,
    })
    .from(schema.channel)
    .leftJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.channel.workspaceId)
    )
    .where(eq(schema.channel.id, link.channelId))
  if (!channel?.workspaceId || channel.archivedAt) return

  const referenced = event.message_reference?.message_id
    ? await db
        .select({
          id: schema.message.id,
          content: schema.message.content,
          overrideName: schema.message.overrideName,
          overrideAvatarUrl: schema.message.overrideAvatarUrl,
          authorId: schema.user.id,
          authorName: schema.user.name,
          authorImage: schema.user.image,
        })
        .from(schema.discordMessage)
        .innerJoin(
          schema.message,
          eq(schema.message.id, schema.discordMessage.messageId)
        )
        .innerJoin(schema.user, eq(schema.user.id, schema.message.authorId))
        .where(
          eq(
            schema.discordMessage.discordMessageId,
            event.message_reference.message_id
          )
        )
        .then((rows) => rows[0] ?? null)
    : null

  const authorId = asPerson ?? APP_USER_ID
  const override = asPerson
    ? null
    : {
        overrideName: displayName({ ...event.author, member: event.member }),
        overrideAvatarUrl: avatarUrl(event.author),
      }
  const savedColumns = {
    id: schema.message.id,
    createdAt: schema.message.createdAt,
    threadRootId: schema.message.threadRootId,
    authorId: schema.message.authorId,
  }
  // Message, its Discord mapping and a new thread root commit together under
  // the channel's link lock, so the root is the same across processes and
  // nothing is written for a link that was unlinked meanwhile.
  const persist = () =>
    withDiscordLinkLock(link.channelId, link.webhookId, async (tx) => {
      // A redelivered event keeps its first copy and author, even if the
      // author linked their account since.
      const [known] = await tx
        .select(savedColumns)
        .from(schema.discordMessage)
        .innerJoin(
          schema.message,
          eq(schema.message.id, schema.discordMessage.messageId)
        )
        .where(eq(schema.discordMessage.discordMessageId, event.id))
      if (known) return { ...known, fresh: false }
      const rootId = threadId
        ? await threadRootFor(tx, threadId, link.channelId)
        : null
      const [saved] = await tx
        .insert(schema.message)
        .values({
          channelId: link.channelId,
          authorId,
          content,
          type: referenced ? "reply" : "default",
          referencedMessageId: referenced?.id ?? null,
          threadRootId: rootId,
          clientKey: `discord:${event.id}`,
          ...(override ?? {}),
        })
        .onConflictDoNothing()
        .returning(savedColumns)
      if (!saved) return null
      await tx.insert(schema.discordMessage).values({
        discordMessageId: event.id,
        messageId: saved.id,
        channelId: link.channelId,
      })
      // A thread whose starter was never mirrored: this message is its root.
      if (threadId && !saved.threadRootId) {
        await tx.insert(schema.discordThread).values({
          discordThreadId: threadId,
          channelId: link.channelId,
          threadRootId: saved.id,
        })
      }
      return { ...saved, fresh: true }
    })
  const inserted = threadId
    ? await inThreadOrder(threadId, persist)
    : await persist()
  if (!inserted) return
  const threadRootId = inserted.threadRootId

  const [author] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, inserted.authorId))
  if (!author) return

  // Realtime only for a newly stored message, for whoever has the place
  // open. Nobody is notified: a place has no people in Lor, and Discord
  // already told them.
  if (inserted.fresh) {
    const io = await getEmitter()
    const message: RealtimeMessage = {
      id: inserted.id,
      channelId: link.channelId,
      content,
      type: referenced ? "reply" : "default",
      eventType: null,
      eventPayload: null,
      pinned: false,
      createdAt: inserted.createdAt.toISOString(),
      author: { ...author, avatarColor: null },
      overrideName: override?.overrideName ?? null,
      overrideAvatarUrl: override?.overrideAvatarUrl ?? null,
      mentions: [],
      reactions: [],
      attachments: [],
      embeds: [],
      referencedMessage: referenced
        ? {
            id: referenced.id,
            content: referenced.content,
            author: {
              id: referenced.authorId,
              name: referenced.authorName,
              image: referenced.authorImage,
              avatarColor: null,
            },
            overrideName: referenced.overrideName,
            overrideAvatarUrl: referenced.overrideAvatarUrl,
          }
        : null,
      threadRootId,
    }
    if (threadRootId) {
      // A reply reaches the thread's room; the chat learns of it through the
      // thread summary.
      io.to(threadRoom(threadRootId)).emit("message:created", message)
      await loadThreadSummary(link.channelId, threadRootId)
        .then((summary) =>
          io
            .to(channelRoom(link.channelId))
            .emit("message:thread:updated", summary)
        )
        .catch(() => {})
    } else {
      io.to(channelRoom(link.channelId)).emit("message:created", message)
    }
  }

  // Into the inboxes of the place's agents, by a chat's rules
  // (apps/realtime/src/services/agent-inbox.ts): a mention of an agent or a
  // reply to it wakes that agent and waits for the others; a message that
  // names nobody waits for all and is judged at once (LOR-171). In a thread
  // it reaches the agents it names, or with none named the ones that are
  // part of the thread. A reply to anything an agent's webhook posted counts,
  // mapped or not (its hello, the later parts of a long answer).
  const placed = await db
    .select({ agentId: schema.channelAgent.agentId })
    .from(schema.channelAgent)
    .where(eq(schema.channelAgent.channelId, link.channelId))
    .orderBy(
      asc(schema.channelAgent.createdAt),
      asc(schema.channelAgent.agentId)
    )
    .then((rows) => rows.map((row) => row.agentId))
  const first = placed[0]
  if (!first) return
  const named = new Set(placed.filter((id) => content.includes(`<@${id}>`)))
  if (content.includes(`<@${LOR_USER_ID}>`)) named.add(first)
  const repliedTo = event.referenced_message?.webhook_id
    ? (await agentOfWebhook(event.referenced_message.webhook_id))?.agentId
    : referenced?.authorId === LOR_USER_ID
      ? first
      : referenced?.authorId
  if (repliedTo && placed.includes(repliedTo)) named.add(repliedTo)
  const inThread =
    threadRootId && named.size === 0
      ? await agentsInThread(threadRootId, placed)
      : new Set<string>()
  for (const agentId of placed) {
    const wakes = named.has(agentId) || inThread.has(agentId)
    if (threadRootId && !wakes) continue
    const lane = wakes ? "wake" : "wait"
    const conversationId = await addInboxMessage({
      workspaceId: channel.workspaceId,
      channelId: link.channelId,
      agentId,
      messageId: inserted.id,
      lane,
    })
    if (conversationId && lane === "wake") {
      await flushAgentInbox(conversationId, AGENT_INBOX_BATCH_MS)
    }
  }
  if (named.size === 0 && !threadRootId) {
    classifyAgentInbox(link.channelId, inserted.id)
  }
}
