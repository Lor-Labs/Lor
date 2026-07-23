import { db, inArray, schema } from "@repo/db"
import {
  PRESENCE_ONLINE_USERS_SET_KEY,
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

function toRedisBoolean(value: unknown) {
  return value === true || value === 1 || value === "1"
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postPushChunk(chunk: unknown[]) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(chunk),
    })
    if (response.ok) {
      return (await response.json()) as { data?: ExpoPushTicket[] }
    }
    const isTransient = response.status === 429 || response.status >= 500
    if (!isTransient || attempt >= EXPO_PUSH_MAX_ATTEMPTS) {
      throw new Error(`Expo push send failed: ${response.status}`)
    }
    await sleep(500 * 2 ** (attempt - 1))
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

  const eligible = offline.filter((recipient) => {
    const settings = settingsByUserId.get(recipient.userId)
    if (recipient.payload.workspaceId === null) {
      return (settings?.dmNotifications ?? "all_messages") !== "nothing"
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
    const body = payload.contentPreview
      ? payload.channelName
        ? `#${payload.channelName}: ${payload.contentPreview}`
        : payload.contentPreview
      : "Sent an attachment"
    return [
      {
        to: row.token,
        title: payload.authorName,
        body,
        sound: "default" as const,
        data: {
          channelId: payload.channelId,
          workspaceId: payload.workspaceId,
          threadRootId: input.threadRootId ?? null,
          messageId: payload.messageId,
        },
      },
    ]
  })

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
