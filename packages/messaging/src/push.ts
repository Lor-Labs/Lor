import { and, db, eq, inArray, schema } from "@repo/db"
import {
  buildNotificationConversationName,
  buildNotificationTitle,
  buildReactionNotificationBody,
  PRESENCE_ONLINE_USERS_SET_KEY,
  type ReactionNotification,
  shouldNotifyForMerlinThread,
  type UnreadNotification,
} from "@repo/realtime-types"

// Structural subset of the node-redis client so realtime, worker, and api can
// all pass their own instance without this package depending on "redis".
type PresenceRedisClient = {
  smIsMember(key: string, members: string[]): Promise<Array<boolean | number>>
}

type ExpoPushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } }

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send"
const EXPO_PUSH_BATCH_SIZE = 100
const EXPO_PUSH_MAX_ATTEMPTS = 3
const EXPO_PUSH_TIMEOUT_MS = 10_000

function toRedisBoolean(value: unknown) {
  return value === true || value === 1 || value === "1"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postPushChunk(chunk: unknown[]) {
  for (let attempt = 1; ; attempt++) {
    let response: Response | null = null
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
      })
    } catch (cause) {
      // Timeouts and network failures are transient — retry like a 5xx.
      if (attempt >= EXPO_PUSH_MAX_ATTEMPTS) throw cause
    }
    if (response) {
      if (response.ok) {
        return (await response.json()) as { data?: ExpoPushTicket[] }
      }
      const isTransient = response.status === 429 || response.status >= 500
      if (!isTransient || attempt >= EXPO_PUSH_MAX_ATTEMPTS) {
        throw new Error(`Expo push send failed: ${response.status}`)
      }
    }
    await sleep(500 * 2 ** (attempt - 1))
  }
}

type ExpoPushMessage = {
  to: string
  title: string
  body: string
  sound: "default"
  channelId: "default"
  mutableContent?: boolean
  richContent?: { image: string }
  data: Record<string, unknown>
}

// Chunked delivery + dead-token cleanup shared by all push kinds.
async function deliverExpoPush(messages: ExpoPushMessage[]) {
  const deadTokens: string[] = []
  for (let index = 0; index < messages.length; index += EXPO_PUSH_BATCH_SIZE) {
    const chunk = messages.slice(index, index + EXPO_PUSH_BATCH_SIZE)
    const result = await postPushChunk(chunk)
    for (const [ticketIndex, ticket] of (result.data ?? []).entries()) {
      const target = chunk[ticketIndex]
      if (
        target &&
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        deadTokens.push(target.to)
      }
    }
  }

  if (deadTokens.length > 0) {
    await db
      .delete(schema.pushToken)
      .where(inArray(schema.pushToken.token, deadTokens))
  }
}

// Push decisions are made exactly once, at send time: a user with any
// connected socket gets nothing here (their client shows the message or an
// OS notification), and suppressed pushes are never queued for later —
// presence transitions must not trigger a backlog flood.
export async function sendMessagePushNotifications(input: {
  fanout: {
    unreadNotifications: Array<{ userId: string; payload: UnreadNotification }>
    mentionNotifications: Array<{ userId: string }>
  }
  threadRootId?: string | null
  redis: PresenceRedisClient
}) {
  const recipients = input.fanout.unreadNotifications
  if (recipients.length === 0) return

  const membership = await input.redis.smIsMember(
    PRESENCE_ONLINE_USERS_SET_KEY,
    recipients.map((recipient) => recipient.userId)
  )
  const offline = recipients.filter(
    (_, index) => !toRedisBoolean(membership[index])
  )
  if (offline.length === 0) return

  const settingsRows = await db
    .select({
      userId: schema.userNotificationSettings.userId,
      desktopNotifications:
        schema.userNotificationSettings.desktopNotifications,
      dmNotifications: schema.userNotificationSettings.dmNotifications,
      merlinThreadNotifications:
        schema.userNotificationSettings.merlinThreadNotifications,
    })
    .from(schema.userNotificationSettings)
    .where(
      inArray(
        schema.userNotificationSettings.userId,
        offline.map((recipient) => recipient.userId)
      )
    )
  const settingsByUserId = new Map(settingsRows.map((row) => [row.userId, row]))
  const mentionedUserIds = new Set(
    input.fanout.mentionNotifications.map((notification) => notification.userId)
  )

  // Channel mutes silence everything (mentions included); badges are driven
  // by the socket events, which mutes never touch.
  const channelId = recipients[0]?.payload.channelId ?? ""
  const muteRows = await db
    .select({
      userId: schema.channelMute.userId,
      mutedUntil: schema.channelMute.mutedUntil,
    })
    .from(schema.channelMute)
    .where(
      and(
        eq(schema.channelMute.channelId, channelId),
        inArray(
          schema.channelMute.userId,
          offline.map((recipient) => recipient.userId)
        )
      )
    )
  const now = Date.now()
  const mutedUserIds = new Set(
    muteRows
      .filter((row) => !row.mutedUntil || row.mutedUntil.getTime() > now)
      .map((row) => row.userId)
  )

  const eligible = offline.filter((recipient) => {
    if (mutedUserIds.has(recipient.userId)) return false
    const settings = settingsByUserId.get(recipient.userId)
    if (recipient.payload.workspaceId === null) {
      return (settings?.dmNotifications ?? "all_messages") !== "nothing"
    }
    if (
      !shouldNotifyForMerlinThread(
        settings?.merlinThreadNotifications ?? "all_activity",
        recipient.payload
      )
    ) {
      return false
    }
    const level = settings?.desktopNotifications ?? "all_messages"
    return (
      level === "all_messages" ||
      (level === "mentions_only" && mentionedUserIds.has(recipient.userId))
    )
  })
  if (eligible.length === 0) return

  const tokens = await db
    .select({
      userId: schema.pushToken.userId,
      token: schema.pushToken.token,
    })
    .from(schema.pushToken)
    .where(
      inArray(
        schema.pushToken.userId,
        eligible.map((recipient) => recipient.userId)
      )
    )
  if (tokens.length === 0) return

  const payloadByUserId = new Map(
    eligible.map((recipient) => [recipient.userId, recipient.payload])
  )
  const messages = tokens.flatMap((row) => {
    const payload = payloadByUserId.get(row.userId)
    if (!payload) return []
    const conversationName = buildNotificationConversationName(payload)
    return [
      {
        to: row.token,
        title: buildNotificationTitle({
          actorName: payload.authorName,
          channelName: payload.channelName,
          workspaceName: payload.workspaceName,
        }),
        body: payload.contentPreview ?? "Sent a message",
        sound: "default" as const,
        channelId: "default" as const,
        mutableContent: true,
        ...(payload.authorImage
          ? { richContent: { image: payload.authorImage } }
          : {}),
        data: {
          type: "message",
          communication: true,
          channelId: payload.channelId,
          workspaceId: payload.workspaceId,
          threadRootId: input.threadRootId ?? null,
          messageId: payload.messageId,
          senderId: payload.authorUserId,
          senderName: payload.authorName,
          senderImage: payload.authorImage,
          ...(conversationName ? { conversationName } : {}),
        },
      },
    ]
  })

  await deliverExpoPush(messages)
}

export async function sendReactionPushNotification(input: {
  authorUserId: string
  notification: ReactionNotification
  redis: PresenceRedisClient
}) {
  const [isOnline] = await input.redis.smIsMember(
    PRESENCE_ONLINE_USERS_SET_KEY,
    [input.authorUserId]
  )
  if (toRedisBoolean(isOnline)) return

  const settings = await db
    .select({
      desktopNotifications:
        schema.userNotificationSettings.desktopNotifications,
      dmNotifications: schema.userNotificationSettings.dmNotifications,
    })
    .from(schema.userNotificationSettings)
    .where(eq(schema.userNotificationSettings.userId, input.authorUserId))
    .limit(1)
    .then((rows) => rows[0])
  const enabled =
    input.notification.workspaceId === null
      ? (settings?.dmNotifications ?? "all_messages") !== "nothing"
      : (settings?.desktopNotifications ?? "all_messages") === "all_messages"
  if (!enabled) return

  const mute = await db
    .select({ mutedUntil: schema.channelMute.mutedUntil })
    .from(schema.channelMute)
    .where(
      and(
        eq(schema.channelMute.channelId, input.notification.channelId),
        eq(schema.channelMute.userId, input.authorUserId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  const isMuted =
    mute !== undefined &&
    (mute.mutedUntil === null || mute.mutedUntil.getTime() > Date.now())
  if (isMuted) return

  const tokens = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .where(eq(schema.pushToken.userId, input.authorUserId))
  if (tokens.length === 0) return

  const conversationName = buildNotificationConversationName(input.notification)
  await deliverExpoPush(
    tokens.map((row) => ({
      to: row.token,
      title: buildNotificationTitle({
        actorName: input.notification.actorName,
        channelName: input.notification.channelName,
        workspaceName: input.notification.workspaceName,
      }),
      body: buildReactionNotificationBody(input.notification),
      sound: "default" as const,
      channelId: "default" as const,
      mutableContent: true,
      ...(input.notification.actorImage
        ? { richContent: { image: input.notification.actorImage } }
        : {}),
      data: {
        type: "reaction",
        communication: true,
        channelId: input.notification.channelId,
        workspaceId: input.notification.workspaceId,
        threadRootId: input.notification.threadRootId,
        messageId: input.notification.messageId,
        emoji: input.notification.emoji,
        senderId: input.notification.actorUserId,
        senderName: input.notification.actorName,
        senderImage: input.notification.actorImage,
        ...(conversationName ? { conversationName } : {}),
      },
    }))
  )
}

// Notifies workspace owner/admins that Merlin filed an instructions proposal.
// Deliberately presence-independent (approvals are rare and important) and
// carries only deep-link data — approving from the push is never possible.
export async function sendInstructionsProposalPush(input: {
  workspaceId: string
  version: number
  rationale: string
}) {
  const workspace = await db
    .select({
      ownerId: schema.workspace.ownerId,
      name: schema.workspace.name,
      slug: schema.workspace.slug,
    })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, input.workspaceId))
    .limit(1)
    .then((rows) => rows[0])
  if (!workspace) return

  const admins = await db
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, input.workspaceId),
        eq(schema.workspaceMember.role, "admin")
      )
    )
  const recipientIds = [
    ...new Set([workspace.ownerId, ...admins.map((row) => row.userId)]),
  ]

  const tokens = await db
    .select({ token: schema.pushToken.token })
    .from(schema.pushToken)
    .where(inArray(schema.pushToken.userId, recipientIds))
  if (tokens.length === 0) return

  const rationale = input.rationale.trim()
  const body = rationale
    ? rationale.length > 140
      ? `${rationale.slice(0, 140)}…`
      : rationale
    : "Review and approve the proposed changes in workspace settings."
  await deliverExpoPush(
    tokens.map((row) => ({
      to: row.token,
      title: `Merlin proposed new instructions for ${workspace.name}`,
      body,
      sound: "default" as const,
      channelId: "default" as const,
      data: {
        type: "instructions-proposal",
        workspaceId: input.workspaceId,
        workspaceSlug: workspace.slug,
        version: input.version,
      },
    }))
  )
}
