import { APP_USER_ID, db, eq, inArray, LOR_USER_ID, schema } from "@repo/db"
import { addInboxMessage } from "@repo/lor/channel-agent"
import { ensureCheckInLoop } from "@repo/lor/check-in"
import {
  type DiscordLink,
  discordLinkByDiscordChannel,
} from "@repo/lor/discord"
import {
  buildMessageFanout,
  sendMessagePushNotifications,
} from "@repo/messaging"
import {
  channelRoom,
  type RealtimeMessage,
  userRoom,
} from "@repo/realtime-types"
import { AGENT_INBOX_BATCH_MS } from "@repo/realtime-types/queues"
import { flushAgentInbox } from "@/lib/agent-inbox-queue"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { getRedisClient } from "@/lib/redis"

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

// Discord's text in Lor's terms: the bot's mention is Lor's (the channel
// agent's), people who linked their account are mentioned by their Lor id,
// everyone else by name.
function fromDiscordContent(
  event: DiscordMessageEvent,
  botUserId: string,
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
    .replace(/<@&\d+>/g, "@role")
    .replace(/<#(\d+)>/g, "#channel")
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
  for (const file of event.attachments ?? []) {
    text += `\n[${file.filename}](${file.url})`
  }
  return text.trim()
}

// A message someone wrote in a linked Discord channel, mirrored into the Lor
// channel and delivered to the channel agent's inbox like a chat message
// (reference/always-on-agents.md §10). The agent's own posts come back
// through its webhook and are skipped.
export async function mirrorDiscordMessage(
  event: DiscordMessageEvent,
  botUserId: string
) {
  if (event.type !== 0 && event.type !== 19) return
  if (event.author.id === botUserId) return
  const link = await discordLinkByDiscordChannel(event.channel_id)
  if (!link) return
  if (event.webhook_id && event.webhook_id === link.webhookId) return
  await mirrorInto(link, event, botUserId).catch((err) =>
    logger.error(
      { err, channelId: link.channelId, discordMessageId: event.id },
      "Discord message mirror failed"
    )
  )
}

async function mirrorInto(
  link: DiscordLink,
  event: DiscordMessageEvent,
  botUserId: string
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
  const content = fromDiscordContent(event, botUserId, lorIds)
  if (!content) return

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
  const [inserted] = await db
    .insert(schema.message)
    .values({
      channelId: link.channelId,
      authorId,
      content,
      type: referenced ? "reply" : "default",
      referencedMessageId: referenced?.id ?? null,
      clientKey: `discord:${event.id}`,
      ...(override ?? {}),
    })
    .onConflictDoNothing()
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
  if (!inserted) return
  await db
    .insert(schema.discordMessage)
    .values({
      discordMessageId: event.id,
      messageId: inserted.id,
      channelId: link.channelId,
    })
    .onConflictDoNothing()

  const [author] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, authorId))
  const [channel] = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      name: schema.channel.name,
      workspaceName: schema.workspace.name,
    })
    .from(schema.channel)
    .leftJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.channel.workspaceId)
    )
    .where(eq(schema.channel.id, link.channelId))
  if (!author || !channel?.workspaceId) return

  const io = await getEmitter()
  let mentions: RealtimeMessage["mentions"] = []
  try {
    const redis = await getRedisClient()
    const fanout = await buildMessageFanout({
      authorId,
      channel,
      message: {
        id: inserted.id,
        content,
        author: {
          name: override?.overrideName ?? author.name,
          image: override?.overrideAvatarUrl ?? author.image,
        },
        attachments: [],
      },
      redis,
    })
    mentions = fanout.messageMentions
    for (const n of fanout.unreadNotifications) {
      io.to(userRoom(n.userId)).emit("notification:unread", n.payload)
    }
    for (const n of fanout.mentionNotifications) {
      io.to(userRoom(n.userId)).emit("notification:mention", n.payload)
    }
    void sendMessagePushNotifications({ fanout, redis }).catch((err) =>
      logger.error(
        { err, messageId: inserted.id },
        "Discord mirror push failed"
      )
    )
  } catch (err) {
    logger.error(
      { err, messageId: inserted.id },
      "Discord mirror fanout failed"
    )
  }

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
    mentions,
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
    threadRootId: null,
  }
  io.to(channelRoom(link.channelId)).emit("message:created", message)

  // Into the agent's inbox: a mention of the bot or a reply to the agent
  // wakes it, anything else waits unless the channel wakes it every time.
  void ensureCheckInLoop(link.channelId).catch(() => {})
  const addressed =
    content.includes(`<@${LOR_USER_ID}>`) ||
    referenced?.authorId === LOR_USER_ID
  const everyMessage = addressed
    ? false
    : await db
        .select({ mode: schema.channel.agentWakeMode })
        .from(schema.channel)
        .where(eq(schema.channel.id, link.channelId))
        .then((rows) => rows[0]?.mode === "every_message")
  const lane = addressed || everyMessage ? "wake" : "wait"
  const added = await addInboxMessage({
    workspaceId: channel.workspaceId,
    channelId: link.channelId,
    messageId: inserted.id,
    lane,
  })
  if (added && lane === "wake") {
    await flushAgentInbox(link.channelId, AGENT_INBOX_BATCH_MS)
  }
}
