import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { auth, type Session } from "@repo/auth"
import { and, db, eq, notExists, schema } from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import {
  canSeeSessionChat,
  isLiveSessionChat,
} from "@repo/db/queries/session-chat-access"
import { env } from "@repo/env/server"
import { enterContext } from "@repo/logger"
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { settleAbandonedRunPlan, toRealtimePlan } from "@repo/lor/plans"
import {
  buildMessageFanout,
  sendMessagePushNotifications,
  sendReactionPushNotification,
} from "@repo/messaging"
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
} from "@repo/realtime-types"
import {
  channelRoom,
  channelRoomPayloadSchema,
  deleteMessagePayloadSchema,
  editMessagePayloadSchema,
  markChannelReadPayloadSchema,
  presenceSubscribePayloadSchema,
  sendMessagePayloadSchema,
  threadRoom,
  threadRoomPayloadSchema,
  toggleMessageReactionPayloadSchema,
  typingStartPayloadSchema,
  userConnectionRoom,
  userRoom,
  workspaceMemberJoinedPayloadSchema,
  workspaceRoom,
} from "@repo/realtime-types"
import type {
  AttachmentIndexJobData,
  LinkUnfurlJobData,
  LorRespondJobData,
} from "@repo/realtime-types/queues"
import {
  ATTACHMENT_INDEX_QUEUE,
  LINK_UNFURL_QUEUE,
  LOR_RESPOND_QUEUE,
} from "@repo/realtime-types/queues"
import { createAdapter } from "@socket.io/redis-adapter"
import { Queue } from "bullmq"
import { createClient } from "redis"
import { Server, type Socket } from "socket.io"
import { toErrorMessage } from "@/lib/errors"
import { logger } from "@/lib/logger"
import { assertUserCanAccessChannel } from "@/services/channel-access"
import {
  createAgentRun,
  createLorPlaceholder,
  type RunRouteOutcome,
  routeToActiveRun,
  sessionStartFor,
} from "@/services/lor"
import {
  claimMessageDelivery,
  MESSAGE_DELIVERY_RETRY,
} from "@/services/message-delivery"
import {
  createMessage,
  deleteMessage,
  editMessage,
  loadMessageByClientKey,
  loadThreadSummary,
  toggleMessageReaction,
} from "@/services/messages"
import {
  listOnlineUserIds,
  markUserConnected,
  markUserDisconnected,
  reconcilePresence,
  refreshPresenceHeartbeat,
} from "@/services/presence"
import {
  enforceDmMessageRateLimit,
  enforceWorkspaceMessageRateLimit,
} from "@/services/rate-limit"
import { getUnreadStatesForUser, markChannelRead } from "@/services/read-states"
import { getWorkspaceActivity } from "@/services/workspace-activity"

type SocketData = {
  user: Session["user"]
  session: Session["session"]
  workspaceIds?: string[]
  initialized?: boolean
  initPromise?: Promise<boolean>
  isAlive?: boolean
}

type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>

function toHeaders(
  handshakeHeaders: Record<string, string | string[] | undefined>
) {
  const headers = new Headers()

  for (const [key, value] of Object.entries(handshakeHeaders)) {
    if (value === undefined) continue

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item)
      }
      continue
    }

    headers.set(key, value)
  }

  return headers
}

const realtimePort = env.REALTIME_PORT

const defaultOrigins = ["http://localhost:3000", "http://localhost:3001"]
// Native apps use fixed origins that must always be allowed — even in
// production where REALTIME_CORS_ORIGIN overrides the defaults. Desktop
// (Tauri) serves from tauri://localhost (macOS/Linux) or http://tauri.localhost
// (Windows); mobile sends its app scheme explicitly (RN's WebSocket otherwise
// derives Origin from the connection URL, which can't be allowlisted).
const nativeOrigins = [
  "tauri://localhost",
  "http://tauri.localhost",
  "lor://",
  "lor-dev://",
]
const corsOrigins = [
  ...(env.REALTIME_CORS_ORIGIN || defaultOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  ...nativeOrigins,
]

const redisPubClient = createClient({ url: env.REDIS_URL })
const redisSubClient = redisPubClient.duplicate()
const redisPresenceClient = redisPubClient.duplicate()

redisPubClient.on("error", (error) => {
  logger.error({ err: error }, "Redis pub error")
})
redisSubClient.on("error", (error) => {
  logger.error({ err: error }, "Redis sub error")
})
redisPresenceClient.on("error", (error) => {
  logger.error({ err: error }, "Redis presence error")
})

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
    return
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ message: "Not found" }))
})

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  transports: ["websocket"],
  cors: {
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error("CORS origin not allowed"), false)
    },
    credentials: true,
  },
})

// Per-IP, so shared across every client behind one NAT — must absorb a whole
// office reconnecting at once after a redeploy or system wake.
const CONNECTION_RATE_WINDOW = 60
const CONNECTION_RATE_MAX = 60
const CONNECTION_RATE_TTL = 90

io.use(async (socket, next) => {
  const ip =
    socket.handshake.headers["x-forwarded-for"]
      ?.toString()
      .split(",")[0]
      ?.trim() ||
    socket.handshake.address ||
    "unknown"
  const windowNum = Math.floor(Date.now() / (CONNECTION_RATE_WINDOW * 1000))
  const key = `ratelimit:ws:connect:${ip}:${windowNum}`

  try {
    const count = await redisPresenceClient.incr(key)
    if (count === 1) {
      await redisPresenceClient.expire(key, CONNECTION_RATE_TTL)
    }
    if (count > CONNECTION_RATE_MAX) {
      next(new Error("Too many connections. Try again later."))
      return
    }
  } catch {
    // allow connection if Redis is unavailable
  }
  next()
})

// Resolve a session from its raw token via better-auth's internal adapter,
// which honors secondary (Redis) storage and expiry the same way getSession
// does — used for the Tauri handshake fallback where no cookie is present.
// findSession is typed to better-auth's base models; at runtime it returns the
// full row, so we surface it as the plugin-augmented Session the app uses.
async function sessionFromToken(token: string): Promise<Session | null> {
  const ctx = await auth.$context
  return (await ctx.internalAdapter.findSession(token)) as Session | null
}

io.use(async (socket, next) => {
  try {
    let session = await auth.api.getSession({
      headers: toHeaders(socket.handshake.headers),
    })

    // Desktop (Tauri) fallback: the webview WS handshake can't carry the native
    // cookie jar, so the client passes the session token in the auth payload.
    if (!session) {
      const token = socket.handshake.auth?.token
      if (typeof token === "string" && token.length > 0) {
        session = await sessionFromToken(token)
      }
    }

    if (!session) {
      next(new Error("Unauthorized"))
      return
    }

    socket.data.user = session.user
    socket.data.session = session.session
    next()
  } catch {
    next(new Error("Unauthorized"))
  }
})

async function clearSocketPresence(socket: RealtimeSocket, socketId: string) {
  const { becameOffline } = await markUserDisconnected(
    redisPresenceClient,
    socket.data.user.id,
    socketId
  )
  if (!becameOffline) return
  const workspaceIds =
    socket.data.workspaceIds ??
    (
      await db
        .select({ workspaceId: schema.workspaceMember.workspaceId })
        .from(schema.workspaceMember)
        .where(eq(schema.workspaceMember.userId, socket.data.user.id))
    ).map((row) => row.workspaceId)
  for (const workspaceId of workspaceIds) {
    io.to(workspaceRoom(workspaceId)).emit("presence:user:update", {
      workspaceId,
      userId: socket.data.user.id,
      status: "offline",
    })
  }
}

async function refreshSocketPresence(socket: RealtimeSocket, socketId: string) {
  await refreshPresenceHeartbeat(
    redisPresenceClient,
    socket.data.user.id,
    socketId
  )
  // A refresh queued before disconnect may reinsert the socket after cleanup.
  if (!socket.connected) await clearSocketPresence(socket, socketId)
}

async function initializeConnection(socket: RealtimeSocket) {
  try {
    const initSocketId = socket.id
    const userPresenceRoom = userRoom(socket.data.user.id)

    const workspaceMembershipRows = await db
      .select({
        workspaceId: schema.workspaceMember.workspaceId,
      })
      .from(schema.workspaceMember)
      .where(eq(schema.workspaceMember.userId, socket.data.user.id))

    const workspaceIds = workspaceMembershipRows.map((row) => row.workspaceId)
    socket.data.workspaceIds = workspaceIds

    const workspacePresenceRooms = workspaceIds.map((workspaceId) =>
      workspaceRoom(workspaceId)
    )
    if (workspacePresenceRooms.length > 0) {
      await socket.join(workspacePresenceRooms)
    }

    const { becameOnline } = await markUserConnected(
      redisPresenceClient,
      socket.data.user.id,
      initSocketId
    )

    const isCurrentSocketAlive =
      socket.data.isAlive === true &&
      socket.connected &&
      socket.id === initSocketId

    if (!isCurrentSocketAlive) {
      await clearSocketPresence(socket, initSocketId)
      return false
    }

    if (becameOnline && isCurrentSocketAlive) {
      for (const workspaceId of workspaceIds) {
        io.to(workspaceRoom(workspaceId)).emit("presence:user:update", {
          workspaceId,
          userId: socket.data.user.id,
          status: "online",
        })
      }
    }

    // Refresh TTL on the socket set so it expires if this server crashes
    await refreshSocketPresence(socket, initSocketId)

    // Keep refreshing while connected
    const heartbeatInterval = setInterval(() => {
      void refreshSocketPresence(socket, initSocketId).catch((err) => {
        logger.warn(
          { err, socketId: initSocketId },
          "Presence heartbeat failed"
        )
      })
    }, 30 * 1000)

    const clearHeartbeat = () => clearInterval(heartbeatInterval)
    socket.once("disconnect", clearHeartbeat)
    if (!socket.connected) {
      clearHeartbeat()
      socket.off("disconnect", clearHeartbeat)
      await clearSocketPresence(socket, initSocketId)
      return false
    }

    socket.emit("presence:ready", {
      userId: socket.data.user.id,
      rooms: {
        user: userPresenceRoom,
        workspaces: workspacePresenceRooms,
      },
    })

    // Bootstrap unread state BEFORE joining userRoom so live notifications
    // arriving after join don't get wiped by a later bootstrap emit
    try {
      const bootstrap = await getUnreadStatesForUser(socket.data.user.id)
      socket.emit("notification:bootstrap", bootstrap)
    } catch (err) {
      logger.error(
        { err, socketId: socket.id, userId: socket.data.user.id },
        "Failed to bootstrap unread states"
      )
    }

    await socket.join(userPresenceRoom)

    return true
  } catch (error) {
    logger.error(
      { err: error, socketId: socket.id, userId: socket.data.user.id },
      "initializeConnection failed"
    )
    socket.disconnect(true)
    return false
  }
}

io.on("connection", (socket) => {
  let activityPending = false
  socket.on("workspace:activity", async (payload, ack) => {
    if (typeof ack !== "function") return
    if (activityPending) {
      ack({ ok: false, error: "Activity refresh already requested" })
      return
    }
    activityPending = true
    try {
      const { workspaceId } = presenceSubscribePayloadSchema.parse(payload)
      const channels = await getWorkspaceActivity(
        socket.data.user.id,
        workspaceId
      )
      ack({ ok: true, channels })
    } catch (error) {
      ack({ ok: false, error: toErrorMessage(error) })
    } finally {
      activityPending = false
    }
  })
  void socket.join(userConnectionRoom(socket.data.user.id))
  socket.data.isAlive = true
  socket.data.initialized = false
  socket.data.initPromise = initializeConnection(socket).then((initialized) => {
    socket.data.initialized = initialized
    return initialized
  })

  // Attach { socketId, userId } to every log line emitted while handling
  // an event from this socket.
  socket.use((_event, next) => {
    enterContext({ socketId: socket.id, userId: socket.data.user?.id })
    next()
  })

  socket.on("presence:subscribe", async (payload, ack) => {
    try {
      if (!socket.data.initialized) {
        await socket.data.initPromise
      }

      if (!socket.data.initialized) {
        ack?.({ ok: false, error: "Socket initialization incomplete" })
        return
      }

      const parsed = presenceSubscribePayloadSchema.parse(payload)
      const workspaceIds = socket.data.workspaceIds ?? []

      if (!workspaceIds.includes(parsed.workspaceId)) {
        ack?.({ ok: false, error: "Forbidden" })
        return
      }

      const workspaceMemberRows = await db
        .select({
          userId: schema.workspaceMember.userId,
        })
        .from(schema.workspaceMember)
        .where(eq(schema.workspaceMember.workspaceId, parsed.workspaceId))

      const userIds = [...new Set(workspaceMemberRows.map((row) => row.userId))]
      const onlineUserIds = await listOnlineUserIds(
        redisPresenceClient,
        userIds
      )

      ack?.({
        ok: true,
        snapshot: {
          workspaceId: parsed.workspaceId,
          onlineUserIds,
        },
      })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("channel:join", async (payload, ack) => {
    try {
      const parsed = channelRoomPayloadSchema.parse(payload)
      await assertUserCanAccessChannel(socket.data.user.id, parsed.channelId)
      await socket.join(channelRoom(parsed.channelId))
      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("channel:leave", async (payload, ack) => {
    try {
      const parsed = channelRoomPayloadSchema.parse(payload)
      await socket.leave(channelRoom(parsed.channelId))
      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("thread:join", async (payload, ack) => {
    try {
      const parsed = threadRoomPayloadSchema.parse(payload)
      // Verify the user can access the thread's channel.
      const root = await db
        .select({
          channelId: schema.message.channelId,
          type: schema.message.type,
        })
        .from(schema.message)
        .where(eq(schema.message.id, parsed.threadRootId))
        .limit(1)
        .then((rows) => rows[0])
      if (!root) throw new Error("Thread not found")
      await assertUserCanAccessChannel(socket.data.user.id, root.channelId)
      if (
        root.type === "voice_session" &&
        !(await canSeeSessionChat(socket.data.user.id, parsed.threadRootId))
      ) {
        throw new Error("Thread not found")
      }
      await socket.join(threadRoom(parsed.threadRootId))
      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("thread:leave", async (payload, ack) => {
    try {
      const parsed = threadRoomPayloadSchema.parse(payload)
      await socket.leave(threadRoom(parsed.threadRootId))
      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("message:send", async (payload, ack) => {
    let delivery: Awaited<ReturnType<typeof claimMessageDelivery>> | undefined
    let acknowledged = false
    try {
      let parsed = sendMessagePayloadSchema.parse(payload)
      const accessibleChannel = await assertUserCanAccessChannel(
        socket.data.user.id,
        parsed.channelId
      )

      if (accessibleChannel.workspaceId && accessibleChannel.memberRole) {
        await enforceWorkspaceMessageRateLimit(redisPresenceClient, {
          workspaceId: accessibleChannel.workspaceId,
          userId: socket.data.user.id,
          role: accessibleChannel.memberRole,
        })
      } else {
        await enforceDmMessageRateLimit(
          redisPresenceClient,
          socket.data.user.id
        )
      }

      delivery = await claimMessageDelivery(
        redisPresenceClient,
        socket.data.user.id,
        parsed.channelId,
        parsed.nonce ?? randomUUID()
      )

      if (delivery.busy) {
        // A lost ack can be retried while the original is still routing Lor.
        const original = await loadMessageByClientKey({
          authorId: socket.data.user.id,
          channelId: parsed.channelId,
          clientKey: parsed.nonce ?? "",
          workspaceId: accessibleChannel.workspaceId,
        })
        if (!original) throw new Error(MESSAGE_DELIVERY_RETRY)
        ack?.({ ok: true, message: original })
        return
      }

      const newSession = await sessionStartFor({
        payload: parsed,
        channel: accessibleChannel,
        senderId: socket.data.user.id,
      })
      // A New session send must never fall back to posting in chat.
      if (parsed.startSession && !newSession) {
        throw new Error("A session can only start in a workspace text channel")
      }
      const createdMessage = await createMessage({
        userId: socket.data.user.id,
        payload: parsed,
        accessibleChannel,
        newSession,
      })

      if (
        createdMessage.deduplicated &&
        (delivery.fresh || delivery.stage === "complete")
      ) {
        if (delivery.fresh) await delivery.checkpoint("complete")
        ack?.({ ok: true, message: createdMessage.message })
        return
      }

      // Resume using persisted content, never a changed retry payload.
      parsed = {
        ...parsed,
        content: createdMessage.message.content ?? undefined,
        threadRootId: createdMessage.message.threadRootId ?? undefined,
      }
      const session =
        createdMessage.session ??
        (parsed.threadRootId
          ? await findAgentSessionByThreadRoot(parsed.threadRootId)
          : null)
      const fanout =
        delivery.stage === "pending"
          ? await buildMessageFanout({
              authorId: socket.data.user.id,
              channel: createdMessage.channel,
              message: createdMessage.message,
              redis: redisPresenceClient,
            })
          : null
      const messageWithMentions = {
        ...createdMessage.message,
        mentions: fanout?.messageMentions ?? createdMessage.message.mentions,
      }
      // Lor sessions and live call chats keep their replies out of the
      // channel room.
      const threadRootId = messageWithMentions.threadRootId
      const summary =
        threadRootId &&
        !session &&
        !(
          accessibleChannel.type === "voice" &&
          (await isLiveSessionChat(threadRootId))
        )
          ? await loadThreadSummary(parsed.channelId, threadRootId)
          : null

      // Finish fallible reads before fanout; retries may repeat message IDs,
      // but notification deltas and pushes have a single delivery claim.
      await delivery.checkpoint("broadcast")
      const realtimeSession = session ? toRealtimeAgentSession(session) : null
      if (createdMessage.session && realtimeSession) {
        io.to(channelRoom(parsed.channelId)).emit("session:updated", {
          session: realtimeSession,
        })
        // Before the ack: the sender may be showing the session already
        // (optimistic start), and Lor's first frames must reach them even
        // if their page joins the room late or not at all (Cmd+Enter).
        await socket.join(threadRoom(realtimeSession.threadRootId))
      }
      // A new session or a post in one changes subscribers' sidebar rows.
      if (session) {
        io.to(workspaceRoom(session.workspaceId)).emit(
          "workspace:activity:updated",
          { workspaceId: session.workspaceId }
        )
      }
      if (messageWithMentions.threadRootId) {
        socket
          .to(threadRoom(messageWithMentions.threadRootId))
          .emit("message:created", messageWithMentions)
        if (summary)
          io.to(channelRoom(parsed.channelId)).emit("message:thread:updated", {
            ...summary,
            reply: messageWithMentions,
          })
      } else {
        socket
          .to(channelRoom(parsed.channelId))
          .emit("message:created", messageWithMentions)
      }
      if (fanout) {
        for (const notification of fanout.unreadNotifications) {
          io.to(userRoom(notification.userId)).emit(
            "notification:unread",
            notification.payload
          )
        }
        for (const notification of fanout.mentionNotifications) {
          io.to(userRoom(notification.userId)).emit(
            "notification:mention",
            notification.payload
          )
        }
        void sendMessagePushNotifications({
          fanout,
          redis: redisPresenceClient,
        }).catch((err) =>
          logger.error({ err }, "Push notification send failed")
        )
      }

      // Starting Lor can exceed mobile's ack timeout; confirm delivery first.
      acknowledged = true
      ack?.({
        ok: true,
        message: messageWithMentions,
        session: realtimeSession ?? undefined,
      })

      // Enqueue link unfurl job if the message contains a URL
      const rawUrlMatches =
        parsed.content?.match(/https?:\/\/[^\s<>"[\]]+/g) ?? null
      const urlMatches = rawUrlMatches
        ? [
            ...new Set(
              rawUrlMatches.map((u) => u.replace(/[.,!?:;'")\]]+$/, ""))
            ),
          ]
        : null
      if (urlMatches && urlMatches.length > 0) {
        void linkUnfurlQueue
          .add(
            "unfurl",
            {
              messageId: createdMessage.message.id,
              channelId: parsed.channelId,
              threadRootId: createdMessage.message.threadRootId,
              urls: urlMatches,
            },
            { jobId: createdMessage.message.id }
          )
          .catch((err) => {
            logger.error({ err }, "Failed to enqueue link-unfurl")
          })
      }

      // DMs (no workspace) are never indexed: they will be E2E encrypted.
      if (
        createdMessage.channel.workspaceId &&
        createdMessage.message.attachments.length > 0
      ) {
        void attachmentIndexQueue
          .add(
            "index",
            {
              messageId: createdMessage.message.id,
              channelId: parsed.channelId,
            },
            {
              jobId: createdMessage.message.id,
              // Rides out transient CDN 503s: retries at 30s, 1m, 2m, 4m.
              attempts: 5,
              backoff: { type: "exponential", delay: 30_000 },
            }
          )
          .catch((err) => {
            logger.error({ err }, "Failed to enqueue attachment-index")
          })
      }

      const routeLor = async () => {
        // DMs have no workspace context; Lor only runs in workspace channels.
        const workspaceId = accessibleChannel.workspaceId
        if (!workspaceId) return
        // Session chats are human-only; Lor takes requests by voice.
        if (accessibleChannel.type === "voice") return
        const [existingRun] = await db
          .select()
          .from(schema.agentRun)
          .where(
            eq(schema.agentRun.triggerMessageId, createdMessage.message.id)
          )
          .limit(1)
        if (existingRun) {
          if (existingRun.state === "queued" && existingRun.messageId) {
            await lorRespondQueue.add(
              "respond",
              {
                runId: existingRun.id,
                lorMessageId: existingRun.messageId,
                channelId: existingRun.channelId,
                threadRootId: existingRun.threadRootId,
                contextThreadRootId: parsed.threadRootId ?? null,
                triggerMessageId: createdMessage.message.id,
              },
              {
                jobId: existingRun.id,
                attempts: 2,
                backoff: { type: "fixed", delay: 90_000 },
              }
            )
          }
          return
        }
        const [queued] = await db
          .select({ id: schema.agentRunQueue.id })
          .from(schema.agentRunQueue)
          .where(eq(schema.agentRunQueue.messageId, createdMessage.message.id))
          .limit(1)
        if (queued) return
        // Lor works only in sessions; chat and human threads are people only.
        // createMessage decided this message's route with the session rule
        // (lor-routing.ts) and stored it.
        const triggerLor = createdMessage.message.routedToLor === true

        if (session && triggerLor) {
          const lorScopeId = session.threadRootId

          // One active run per scope: a mid-run send is absorbed by the active
          // run — steered at its next step boundary, or queued for the
          // follow-up run — instead of spawning a sibling.
          const emitRouted = (routed: RunRouteOutcome) => {
            const target = parsed.threadRootId
              ? threadRoom(parsed.threadRootId)
              : channelRoom(parsed.channelId)
            io.to(target).emit("message:routed", {
              channelId: parsed.channelId,
              threadRootId: parsed.threadRootId ?? null,
              messageId: createdMessage.message.id,
              outcome: routed.outcome,
              runId: routed.runId,
              lorMessageId: routed.lorMessageId,
            })
          }
          const routed = await routeToActiveRun({
            scopeKey: lorScopeId,
            threadScope: true,
            messageId: createdMessage.message.id,
            senderId: socket.data.user.id,
          })
          if (routed) {
            emitRouted(routed)
            return
          }

          const lorThreadRootId = lorScopeId

          await createLorPlaceholder({
            accessibleChannel,
            channelId: parsed.channelId,
            threadRootId: lorThreadRootId,
          })
            .then(async (lorMessage) => {
              try {
                const runId = await createAgentRun({
                  workspaceId,
                  channelId: parsed.channelId,
                  messageId: lorMessage.id,
                  threadRootId: lorThreadRootId,
                  triggerMessageId: createdMessage.message.id,
                })
                if (!runId) throw new Error("Lor requires a durable agent run")
                if (runId === "conflict") {
                  // Another mention claimed the scope between our check and the
                  // insert: drop the never-emitted placeholder and route at the
                  // winner instead. A failed delete leaves an orphaned pending
                  // row that reads as a stuck "thinking" message on reload.
                  await db
                    .delete(schema.message)
                    .where(eq(schema.message.id, lorMessage.id))
                    .catch((err) =>
                      logger.error(
                        { err, messageId: lorMessage.id },
                        "Failed to delete orphaned Lor placeholder"
                      )
                    )
                  const lateRouted = await routeToActiveRun({
                    scopeKey: lorThreadRootId,
                    threadScope: true,
                    messageId: createdMessage.message.id,
                    senderId: socket.data.user.id,
                  })
                  if (!lateRouted)
                    throw new Error("Lor scope changed during routing")
                  emitRouted(lateRouted)
                  return
                }
                // The queued run row committed — sidebar activity shows it.
                io.to(workspaceRoom(workspaceId)).emit(
                  "workspace:activity:updated",
                  { workspaceId }
                )
                // Flag the placeholder as streaming so the "Lor is thinking"
                // indicator shows the instant it lands (independent of the worker's
                // first stream event arriving).
                const placeholder = {
                  ...lorMessage,
                  streaming: true,
                  lorTriggerMessageId: createdMessage.message.id,
                }
                if (placeholder.threadRootId) {
                  io.to(threadRoom(placeholder.threadRootId)).emit(
                    "message:created",
                    placeholder
                  )
                  // No `reply` here on purpose: injecting a streaming placeholder
                  // into a closed panel's cache would freeze it mid-"thinking" —
                  // its stream events only reach the open panel. Closed panels
                  // invalidate and refetch the settled row instead.
                  await loadThreadSummary(
                    parsed.channelId,
                    placeholder.threadRootId
                  )
                    .then((summary) =>
                      io
                        .to(channelRoom(parsed.channelId))
                        .emit("message:thread:updated", summary)
                    )
                    .catch((err) =>
                      logger.warn(
                        { err, messageId: placeholder.id },
                        "Lor startup thread summary failed"
                      )
                    )
                } else {
                  io.to(channelRoom(parsed.channelId)).emit(
                    "message:created",
                    placeholder
                  )
                }
                // One recovery attempt: a crashed/stalled attempt is retried once
                // and resumes from the run's last checkpoint (the run's own
                // attempt cap is the authoritative guard). Handled errors don't
                // retry — the worker catches them and posts a fallback instead of
                // throwing. jobId = runId dedupes re-enqueues of the same run.
                await lorRespondQueue.add(
                  "respond",
                  {
                    lorMessageId: lorMessage.id,
                    channelId: parsed.channelId,
                    threadRootId: lorThreadRootId,
                    contextThreadRootId: parsed.threadRootId ?? null,
                    triggerMessageId: createdMessage.message.id,
                    runId,
                  },
                  {
                    attempts: 2,
                    // Must exceed the run lease TTL (60s) or the retry can never
                    // reclaim a crashed attempt — it sees a live lease and skips.
                    backoff: { type: "fixed", delay: 90_000 },
                    jobId: runId,
                  }
                )
              } catch (err) {
                // A failed insert must not leave a pending message without a run.
                const [orphan] = await db
                  .update(schema.message)
                  .set({
                    status: "failed",
                    content:
                      "I couldn't start that response. Please try again.",
                  })
                  .where(
                    and(
                      eq(schema.message.id, lorMessage.id),
                      eq(schema.message.status, "pending"),
                      notExists(
                        db
                          .select({ id: schema.agentRun.id })
                          .from(schema.agentRun)
                          .where(
                            eq(schema.agentRun.messageId, schema.message.id)
                          )
                      )
                    )
                  )
                  .returning()
                if (orphan) {
                  // Startup may fail before the placeholder's first broadcast.
                  io.to(
                    orphan.threadRootId
                      ? threadRoom(orphan.threadRootId)
                      : channelRoom(orphan.channelId)
                  ).emit("message:created", {
                    ...lorMessage,
                    status: "failed",
                    content: orphan.content,
                    streaming: false,
                  })
                  io.to(
                    orphan.threadRootId
                      ? threadRoom(orphan.threadRootId)
                      : channelRoom(orphan.channelId)
                  ).emit("message:stream", {
                    channelId: orphan.channelId,
                    threadRootId: orphan.threadRootId,
                    messageId: orphan.id,
                    delta: orphan.content ?? "",
                    done: true,
                    status: "failed",
                    replace: true,
                  })
                  await settleAbandonedRunPlan(
                    { threadRootId: orphan.threadRootId },
                    "failed",
                    (plan) => {
                      io.to(channelRoom(orphan.channelId)).emit(
                        "plan:updated",
                        { plan: toRealtimePlan(plan) }
                      )
                      io.to(workspaceRoom(plan.workspaceId)).emit(
                        "workspace:activity:updated",
                        { workspaceId: plan.workspaceId }
                      )
                    }
                  )
                  if (orphan.threadRootId) {
                    const summary = await loadThreadSummary(
                      orphan.channelId,
                      orphan.threadRootId
                    )
                    io.to(channelRoom(orphan.channelId)).emit(
                      "message:thread:updated",
                      summary
                    )
                  }
                }
                throw err
              }
            })
            .catch(async (err) => {
              logger.error({ err }, "Failed to start Lor response")
              const [run] = await db
                .select({ id: schema.agentRun.id })
                .from(schema.agentRun)
                .where(
                  eq(
                    schema.agentRun.triggerMessageId,
                    createdMessage.message.id
                  )
                )
                .limit(1)
              if (!run) {
                await settleAbandonedRunPlan(
                  { threadRootId: lorThreadRootId },
                  "failed",
                  (plan) => {
                    io.to(channelRoom(parsed.channelId)).emit("plan:updated", {
                      plan: toRealtimePlan(plan),
                    })
                    io.to(workspaceRoom(plan.workspaceId)).emit(
                      "workspace:activity:updated",
                      { workspaceId: plan.workspaceId }
                    )
                  }
                )
              }
              throw err
            })
        }
      }
      await routeLor()
      await delivery.checkpoint("complete")
    } catch (error) {
      logger.error({ err: error }, "Message delivery failed")
      if (!acknowledged) ack?.({ ok: false, error: toErrorMessage(error) })
    } finally {
      if (delivery && !delivery.busy) await delivery.release()
    }
  })

  socket.on("message:delete", async (payload, ack) => {
    try {
      const parsed = deleteMessagePayloadSchema.parse(payload)
      const result = await deleteMessage({
        userId: socket.data.user.id,
        payload: parsed,
      })

      const deletedPayload = {
        channelId: result.channelId,
        messageId: result.messageId,
      }

      if (result.threadRootId) {
        // Thread reply: broadcast to thread room and refresh the channel's
        // footer summary so the "N replies" count ticks down (or clears
        // entirely if this was the last reply).
        socket
          .to(threadRoom(result.threadRootId))
          .emit("message:deleted", deletedPayload)
        const hidden =
          result.channel.type === "voice" &&
          (await isLiveSessionChat(result.threadRootId))
        if (!hidden) {
          const summary = await loadThreadSummary(
            parsed.channelId,
            result.threadRootId
          )
          io.to(channelRoom(parsed.channelId)).emit(
            "message:thread:updated",
            summary
          )
        }
      } else {
        socket
          .to([channelRoom(parsed.channelId), threadRoom(result.messageId)])
          .emit("message:deleted", deletedPayload)
      }

      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("message:edit", async (payload, ack) => {
    try {
      const parsed = editMessagePayloadSchema.parse(payload)
      const result = await editMessage({
        userId: socket.data.user.id,
        payload: parsed,
        redis: redisPresenceClient,
      })

      socket
        .to(
          result.threadRootId
            ? threadRoom(result.threadRootId)
            : [channelRoom(parsed.channelId), threadRoom(result.messageId)]
        )
        .emit("message:updated", {
          channelId: result.channelId,
          messageId: result.messageId,
          content: result.content,
          editedAt: result.editedAt,
          mentions: result.mentions,
        })

      ack?.({ ok: true, editedAt: result.editedAt, mentions: result.mentions })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("message:reaction:toggle", async (payload, ack) => {
    try {
      const parsed = toggleMessageReactionPayloadSchema.parse(payload)
      const reactionUpdate = await toggleMessageReaction({
        userId: socket.data.user.id,
        userName: socket.data.user.name,
        userImage: socket.data.user.image ?? null,
        payload: parsed,
      })

      socket
        .to(
          reactionUpdate.threadRootId
            ? threadRoom(reactionUpdate.threadRootId)
            : [channelRoom(parsed.channelId), threadRoom(parsed.messageId)]
        )
        .emit("message:reaction:updated", reactionUpdate.update)

      const reactionNotification = reactionUpdate.notification
      if (reactionNotification) {
        io.to(userRoom(reactionNotification.authorUserId)).emit(
          "notification:reaction",
          reactionNotification.payload
        )
        void sendReactionPushNotification({
          authorUserId: reactionNotification.authorUserId,
          notification: reactionNotification.payload,
          redis: redisPresenceClient,
        }).catch((err) => {
          logger.error(
            {
              err,
              messageId: reactionNotification.payload.messageId,
              authorUserId: reactionNotification.authorUserId,
            },
            "Reaction push notification send failed"
          )
        })
      }

      ack?.({
        ok: true,
        update: reactionUpdate.update,
      })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("channel:mark-read", async (payload, ack) => {
    try {
      const parsed = markChannelReadPayloadSchema.parse(payload)
      const state = await markChannelRead({
        userId: socket.data.user.id,
        channelId: parsed.channelId,
        lastReadMessageId: parsed.lastReadMessageId,
      })

      // Broadcast to other tabs/devices for this user
      socket.to(userRoom(socket.data.user.id)).emit("channel:read-state", state)
      // Also send back to the requesting socket
      socket.emit("channel:read-state", state)
      ack?.({ ok: true, state })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("typing:start", async (payload) => {
    try {
      const parsed = typingStartPayloadSchema.parse(payload)
      await assertUserCanAccessChannel(socket.data.user.id, parsed.channelId)

      // Scope to the thread room when typing in a thread reply, else the
      // channel — keeps thread typing out of the channel feed and vice-versa.
      const room = parsed.threadRootId
        ? threadRoom(parsed.threadRootId)
        : channelRoom(parsed.channelId)
      socket.to(room).emit("typing:update", {
        channelId: parsed.channelId,
        threadRootId: parsed.threadRootId ?? null,
        userId: socket.data.user.id,
        name: socket.data.user.name,
      })
    } catch {
      // silently ignore — unauthorized or invalid payload
    }
  })

  socket.on("workspace:member:joined", async (payload, ack) => {
    try {
      const parsed = workspaceMemberJoinedPayloadSchema.parse(payload)

      // Verify the user is actually a member of this workspace
      const membership = await db
        .select({ workspaceId: schema.workspaceMember.workspaceId })
        .from(schema.workspaceMember)
        .where(
          and(
            eq(schema.workspaceMember.workspaceId, parsed.workspaceId),
            eq(schema.workspaceMember.userId, socket.data.user.id)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (!membership) {
        ack?.({ ok: false, error: "Forbidden" })
        return
      }

      // Join the workspace room so the new member receives future events
      await socket.join(workspaceRoom(parsed.workspaceId))

      // Deduplicate workspaceIds
      const currentWorkspaceIds = socket.data.workspaceIds ?? []
      if (!currentWorkspaceIds.includes(parsed.workspaceId)) {
        socket.data.workspaceIds = [...currentWorkspaceIds, parsed.workspaceId]
      }

      // Broadcast to other workspace members
      socket
        .to(workspaceRoom(parsed.workspaceId))
        .emit("workspace:member:joined", {
          workspaceId: parsed.workspaceId,
          userId: socket.data.user.id,
          name: socket.data.user.name,
          image: socket.data.user.image ?? null,
        })

      ack?.({ ok: true })
    } catch (error) {
      ack?.({ ok: false, error: toErrorMessage(error) })
    }
  })

  socket.on("disconnect", () => {
    socket.data.isAlive = false

    void (async () => {
      try {
        await clearSocketPresence(socket, socket.id)
      } catch (error) {
        logger.error(
          { err: error, socketId: socket.id, userId: socket.data.user.id },
          "Disconnect presence cleanup failed"
        )
      }
    })()
  })
})

function parseRedisUrl(url: string) {
  const parsed = new URL(url)
  const dbIndex = Number.parseInt(parsed.pathname.slice(1), 10)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    username: parsed.username || undefined,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
  }
}

const linkUnfurlQueue = new Queue<LinkUnfurlJobData>(LINK_UNFURL_QUEUE, {
  connection: {
    ...parseRedisUrl(env.REDIS_URL),
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
  },
})

const attachmentIndexQueue = new Queue<AttachmentIndexJobData>(
  ATTACHMENT_INDEX_QUEUE,
  {
    connection: {
      ...parseRedisUrl(env.REDIS_URL),
      maxRetriesPerRequest: null,
    },
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  }
)

const lorRespondQueue = new Queue<LorRespondJobData>(LOR_RESPOND_QUEUE, {
  connection: {
    ...parseRedisUrl(env.REDIS_URL),
    maxRetriesPerRequest: null,
  },
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
  },
})

async function bootstrap() {
  await Promise.all([
    redisPubClient.connect(),
    redisSubClient.connect(),
    redisPresenceClient.connect(),
  ])

  io.adapter(createAdapter(redisPubClient, redisSubClient))

  // Periodically clean up stale presence entries (crashed servers)
  setInterval(() => {
    void reconcilePresence(redisPresenceClient).catch((error) => {
      logger.error({ err: error }, "Presence reconciliation failed")
    })
  }, 30 * 1000)

  httpServer.listen(realtimePort, () => {
    logger.info({ port: realtimePort }, "Realtime server running")
    logger.info({ origins: corsOrigins }, "Allowed origins")
  })
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, "Failed to start")
  process.exit(1)
})
