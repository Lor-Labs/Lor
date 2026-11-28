import {
  APP_USER_ID,
  asc,
  db,
  eq,
  inArray,
  LOR_USER_ID,
  schema,
} from "@repo/db"
import type { Attachment } from "@repo/db/schema"
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
import { copyDiscordFiles, type DiscordAttachment } from "@/lib/discord/files"
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
  attachments?: DiscordAttachment[]
  // When it was written: a backfilled message keeps its own time.
  timestamp?: string
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
  const text = event.content
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
  const agentRoles = guild ? await agentRolesIn(event.guild_id) : new Map()
  // An agent named by its role (@Rusty) is the one the button offers.
  const namedAgentId = roles.map((id) => agentRoles.get(id)).find(Boolean)
  if (!mentionsBot && !namedAgentId) return
  const redis = await getRedisClient()
  const first = await redis.set(
    `discord:no-agent-hint:${event.channel_id}`,
    "1",
    { NX: true, EX: NO_AGENT_HINT_S }
  )
  if (first !== "OK") return
  if (!guild) {
    await discordRequest(`/channels/${event.channel_id}/messages`, {
      method: "POST",
      body: {
        content:
          "This server isn't connected to a Lor workspace yet. Connect it from Lor, under Connectors, then add an agent here with `/lor add`.",
        message_reference: { message_id: event.id, fail_if_not_exists: false },
        allowed_mentions: { parse: [] },
      },
    })
    return
  }
  // A short public answer (Discord answers privately only to a click), whose
  // button opens a private panel to add an agent; the buttons carry the
  // answer's own id so it can say who joined.
  const hint = await discordRequest<{ id: string }>(
    `/channels/${event.channel_id}/messages`,
    {
      method: "POST",
      body: {
        content: "No agent is in this channel yet.",
        message_reference: { message_id: event.id, fail_if_not_exists: false },
        allowed_mentions: { parse: [] },
      },
    }
  )
  const [named] = namedAgentId
    ? await db
        .select({ name: schema.agent.name })
        .from(schema.agent)
        .where(eq(schema.agent.id, namedAgentId))
    : []
  await discordRequest(`/channels/${event.channel_id}/messages/${hint.id}`, {
    method: "PATCH",
    body: {
      components: [
        {
          type: 1,
          components: [
            ...(named && namedAgentId
              ? [
                  {
                    type: 2,
                    style: 1,
                    label: `Add ${named.name} here`.slice(0, 80),
                    custom_id: `lor-add:agent:${namedAgentId}:${hint.id}`,
                  },
                ]
              : []),
            {
              type: 2,
              style: named ? 2 : 1,
              label: named ? "Pick another agent" : "Add an agent",
              custom_id: `lor-add:pick:${hint.id}`,
            },
          ],
        },
      ],
    },
  })
}

// Discord roles are the whole server's, so every agent's @role can be
// mentioned in every channel. In a place, a mention of an agent that isn't
// in it says so, at most once per agent and channel every 10 minutes, with
// a button to add it (the hint's own id lets the button say who joined).
// Not in a thread: an agent is added to a channel, and a click there would
// name the thread.
async function hintAgentsElsewhere(
  event: DiscordMessageEvent,
  agentIds: string[],
  inThread: boolean
) {
  if (event.author.bot || event.webhook_id) return
  const redis = await getRedisClient()
  const fresh: string[] = []
  // Five buttons fit a row; agents answered about lately don't use one up.
  for (const agentId of agentIds) {
    if (fresh.length === 5) break
    const first = await redis.set(
      `discord:agent-elsewhere:${event.channel_id}:${agentId}`,
      "1",
      { NX: true, EX: NO_AGENT_HINT_S }
    )
    if (first === "OK") fresh.push(agentId)
  }
  if (fresh.length === 0) return
  const agents = await db
    .select({ id: schema.agent.id, name: schema.agent.name })
    .from(schema.agent)
    .where(inArray(schema.agent.id, fresh))
  if (agents.length === 0) return
  const names = agents.map((agent) => agent.name)
  const who =
    names.length === 1
      ? `${names[0]} isn't`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} aren't`
  const hint = await discordRequest<{ id: string }>(
    `/channels/${event.channel_id}/messages`,
    {
      method: "POST",
      body: {
        content: `${who} in this channel, so ${names.length === 1 ? "it" : "they"} won't see this. Discord lets everyone mention every agent's role in every channel, but an agent only reads the channels it was added to.${inThread ? ` Add ${names.length === 1 ? "it" : "them"} from the channel this thread is in with \`/lor add\`.` : ""}`,
        message_reference: { message_id: event.id, fail_if_not_exists: false },
        allowed_mentions: { parse: [] },
      },
    }
  )
  if (inThread) return
  await discordRequest(`/channels/${event.channel_id}/messages/${hint.id}`, {
    method: "PATCH",
    body: {
      components: [
        {
          type: 1,
          components: agents.map((agent) => ({
            type: 2,
            style: 2,
            label: `Add ${agent.name} here`.slice(0, 80),
            custom_id: `lor-add:agent:${agent.id}:${hint.id}`,
          })),
        },
      ],
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
  threadId: string | null,
  // What was said before an agent joined: stored at its own time, with no
  // realtime and nothing in the agents' inboxes.
  options: { backfill?: boolean } = {}
) {
  const discordIds = [
    event.author.id,
    ...(event.mentions ?? []).map((user) => user.id),
  ]
  const lorIds = await lorUsersFor(discordIds)
  // A linked account posts as its person, if they can see the channel. In a
  // private Discord channel, posting there shows they can: they are put in
  // its copy in Lor. Not from backfill: an old post says nothing about access
  // now.
  const linkedAuthor = lorIds.get(event.author.id)
  if (
    linkedAuthor &&
    !options.backfill &&
    !event.author.bot &&
    !event.webhook_id
  ) {
    await joinPrivatePlace(link.channelId, linkedAuthor)
  }
  const asPerson =
    !event.author.bot &&
    !event.webhook_id &&
    linkedAuthor &&
    (await userCanAccessChannel(link.channelId, linkedAuthor))
      ? linkedAuthor
      : null
  const agentRoles = await agentRolesIn(link.guildId)
  const text = fromDiscordContent(event, botUserId, agentRoles, lorIds)
  // Its files are copied into Lor; one that can't be is linked instead.
  const files = event.attachments?.length
    ? await copyDiscordFiles(link.channelId, event.attachments)
    : { attachments: [], failed: [] }
  const content = [
    text,
    ...files.failed.map((file) => `[${file.filename}](${file.url})`),
  ]
    .filter(Boolean)
    .join("\n")
  if (!content && files.attachments.length === 0) return

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
      if (deletedInDiscord(event.id)) return null
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
          attachments: files.attachments,
          ...(options.backfill && event.timestamp
            ? { createdAt: new Date(event.timestamp) }
            : {}),
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
  // Deleted in Discord while this copy was being made.
  if (inserted.fresh && deletedInDiscord(event.id)) {
    await db.delete(schema.message).where(eq(schema.message.id, inserted.id))
    return
  }
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
  if (options.backfill) return
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
      attachments: files.attachments,
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
  // An agent named by its role but not in this channel is told about,
  // with a button to add it; the message still reaches the agents here.
  const absent = [
    ...new Set(
      (event.mention_roles ?? []).flatMap((roleId) => {
        const agentId = agentRoles.get(roleId)
        return agentId && !placed.includes(agentId) ? [agentId] : []
      })
    ),
  ]
  if (absent.length > 0) {
    void hintAgentsElsewhere(event, absent, threadId !== null).catch((err) =>
      logger.warn({ err, discordMessageId: event.id }, "Discord hint failed")
    )
  }
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
    // One agent's failure doesn't keep the message from the others.
    try {
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
    } catch (err) {
      logger.warn(
        { err, agentId, channelId: link.channelId, messageId: inserted.id },
        "Discord message not delivered to agent inbox"
      )
    }
  }
  if (named.size === 0 && !threadRootId) {
    classifyAgentInbox(link.channelId, inserted.id)
  }
}

// Someone in a private Discord place, by their linked account: its copy in
// Lor is theirs to see too.
export async function joinPrivatePlace(channelId: string, userId: string) {
  const [place] = await db
    .select({ audience: schema.channel.audience })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (place?.audience !== "members") return
  await db
    .insert(schema.channelMember)
    .values({ channelId, userId })
    .onConflictDoNothing()
}

// The Discord message behind a Lor copy, when someone (not an agent) wrote
// it and its place is still linked.
async function mirroredCopy(discordMessageId: string) {
  const [row] = await db
    .select({
      messageId: schema.message.id,
      channelId: schema.message.channelId,
      threadRootId: schema.message.threadRootId,
      type: schema.message.type,
      attachments: schema.message.attachments,
    })
    .from(schema.discordMessage)
    .innerJoin(
      schema.message,
      eq(schema.message.id, schema.discordMessage.messageId)
    )
    .where(eq(schema.discordMessage.discordMessageId, discordMessageId))
  if (!row || row.type === "agent_post" || row.type === "event") return null
  const link = await discordLinkFor(row.channelId)
  return link ? { ...row, link } : null
}

// A message edited in Discord: its copy in Lor follows. Discord sends edits
// without the text for embeds being filled in; those are skipped.
export async function updateMirroredMessage(
  event: DiscordMessageEvent,
  botUserId: string
) {
  if (typeof event.content !== "string" || !event.author) return
  // Agents' own webhook posts are not mirrored; other webhooks' are.
  if (event.webhook_id && (await agentOfWebhook(event.webhook_id))) return
  const copy = await mirroredCopy(event.id)
  if (!copy) return
  const lorIds = await lorUsersFor([
    event.author.id,
    ...(event.mentions ?? []).map((user) => user.id),
  ])
  const text = fromDiscordContent(
    event,
    botUserId,
    await agentRolesIn(copy.link.guildId),
    lorIds
  )
  // Files follow the edit: copies of files removed in Discord go (matched by
  // the Discord filename the copy keeps), new ones are copied, and one that
  // can't be is linked again like on create.
  let attachments: Attachment[] | undefined
  let failed: DiscordAttachment[] = []
  if (Array.isArray(event.attachments)) {
    const remaining = event.attachments.map((file) => file.filename)
    attachments = (copy.attachments ?? []).filter((file) => {
      const at = remaining.indexOf(file.filename)
      if (at === -1) return false
      remaining.splice(at, 1)
      return true
    })
    const kept = attachments.map((file) => file.filename)
    const added = event.attachments.filter((file) => {
      const at = kept.indexOf(file.filename)
      if (at === -1) return true
      kept.splice(at, 1)
      return false
    })
    if (added.length > 0) {
      const copied = await copyDiscordFiles(copy.channelId, added)
      attachments = [...attachments, ...copied.attachments]
      failed = copied.failed
    }
  }
  const content = [
    text,
    ...failed.map((file) => `[${file.filename}](${file.url})`),
  ]
    .filter(Boolean)
    .join("\n")
  const editedAt = new Date()
  await db
    .update(schema.message)
    .set({ content, editedAt, ...(attachments ? { attachments } : {}) })
    .where(eq(schema.message.id, copy.messageId))
  const io = await getEmitter()
  const payload = {
    channelId: copy.channelId,
    messageId: copy.messageId,
    content,
    editedAt: editedAt.toISOString(),
    mentions: [],
  }
  io.to(
    copy.threadRootId
      ? threadRoom(copy.threadRootId)
      : channelRoom(copy.channelId)
  ).emit("message:updated", payload)
}

// Discord messages deleted recently, so a delete that beats its slow create
// (files still copying) leaves no copy. One gateway process hears both.
const DELETED_TTL_MS = 10 * 60_000
const recentlyDeleted = new Map<string, number>()

function rememberDeleted(discordMessageId: string) {
  const now = Date.now()
  for (const [id, at] of recentlyDeleted) {
    if (now - at > DELETED_TTL_MS) recentlyDeleted.delete(id)
  }
  recentlyDeleted.set(discordMessageId, now)
}

function deletedInDiscord(discordMessageId: string) {
  const at = recentlyDeleted.get(discordMessageId)
  return at !== undefined && Date.now() - at <= DELETED_TTL_MS
}

// A message deleted in Discord: its copy in Lor goes too.
export async function deleteMirroredMessage(event: {
  id: string
  channel_id: string
}) {
  rememberDeleted(event.id)
  const copy = await mirroredCopy(event.id)
  if (!copy) return
  await db.delete(schema.message).where(eq(schema.message.id, copy.messageId))
  const io = await getEmitter()
  const payload = { channelId: copy.channelId, messageId: copy.messageId }
  io.to(channelRoom(copy.channelId)).emit("message:deleted", payload)
  if (copy.threadRootId) {
    io.to(threadRoom(copy.threadRootId)).emit("message:deleted", payload)
  }
}

const BACKFILL_MESSAGES = 50

// A new place starts with the channel's recent history, so an agent added
// to it can read what was said before it joined ("what do you think of the
// above?"). People's messages only; nothing wakes an agent.
export async function backfillPlace(link: DiscordLink, botUserId: string) {
  // A failed history read throws to the caller, which logs it.
  const recent = await discordRequest<DiscordMessageEvent[]>(
    `/channels/${link.discordChannelId}/messages?limit=${BACKFILL_MESSAGES}`
  )
  for (const event of recent.reverse()) {
    if (event.author.id === botUserId || event.webhook_id) continue
    if (event.type !== 0 && event.type !== 19) continue
    await mirrorInto(link, event, botUserId, null, { backfill: true }).catch(
      (err) =>
        logger.warn(
          { err, channelId: link.channelId, discordMessageId: event.id },
          "Discord backfill message failed"
        )
    )
  }
}
