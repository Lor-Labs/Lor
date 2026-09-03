import {
  and,
  db,
  eq,
  inArray,
  isUniqueViolation,
  MERLIN_USER_ID,
  schema,
} from "@repo/db"
import type { Task } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { toRealtimeTask } from "@repo/merlin/tasks"
import type { RealtimeMessage } from "@repo/realtime-types"
import {
  MERLIN_RESPOND_QUEUE,
  type MerlinRespondJobData,
} from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { Queue } from "bullmq"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

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

let respondQueue: Queue<MerlinRespondJobData> | null = null
function getRespondQueue(): Queue<MerlinRespondJobData> {
  respondQueue ??= new Queue<MerlinRespondJobData>(MERLIN_RESPOND_QUEUE, {
    connection: { ...parseRedisUrl(env.REDIS_URL), maxRetriesPerRequest: null },
    defaultJobOptions: {
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 86400, count: 5000 },
    },
  })
  return respondQueue
}

// Shared row→wire serializer (drift-guarded in @repo/merlin/tasks);
// re-exported under the name this app's handlers already import.
export { toRealtimeTask as serializeTask }

export async function emitTaskUpdated(task: Task): Promise<void> {
  const io = await getEmitter()
  io.to(channelRoom(task.channelId)).emit("task:updated", {
    task: toRealtimeTask(task),
  })
}

async function loadAuthor(userId: string) {
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

// Archived channels (archived projects) are write-locked everywhere; task
// rails insert directly, so they check here rather than via a route guard.
async function channelIsArchived(channelId: string): Promise<boolean> {
  const row = await db
    .select({ archivedAt: schema.channel.archivedAt })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(row?.archivedAt)
}

// The room a run scope broadcasts into: its thread when it has one, else the
// channel itself (plain channel runs, loop runs).
function scopeRoom(channelId: string, threadRootId: string | null) {
  return threadRootId ? threadRoom(threadRootId) : channelRoom(channelId)
}

// Post a message into a run scope (e.g. an approval resolution, authored by
// the resolver) and broadcast it. Returns the message id.
export async function postScopeMessage(args: {
  channelId: string
  threadRootId: string | null
  authorId: string
  content: string
}): Promise<string | null> {
  if (await channelIsArchived(args.channelId)) {
    logger.warn(
      { channelId: args.channelId },
      "Scope message rejected: channel archived"
    )
    return null
  }
  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: args.channelId,
      authorId: args.authorId,
      content: args.content,
      threadRootId: args.threadRootId,
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      logger.error({ err, channelId: args.channelId }, "Scope post failed")
      return null
    })
  if (!inserted) return null

  // The message is committed; a failed author lookup only costs the live
  // broadcast (clients catch up on refetch) — never the caller's 200.
  const author = await loadAuthor(args.authorId).catch(() => null)
  if (author) {
    const message: RealtimeMessage = {
      id: inserted.id,
      channelId: args.channelId,
      content: args.content,
      type: "default",
      pinned: false,
      createdAt: inserted.createdAt.toISOString(),
      author: { ...author, avatarColor: null },
      mentions: [],
      reactions: [],
      attachments: [],
      embeds: [],
      referencedMessage: null,
      threadRootId: args.threadRootId,
      status: "complete",
    }
    const io = await getEmitter()
    io.to(scopeRoom(args.channelId, args.threadRootId)).emit(
      "message:created",
      message
    )
  }
  return inserted.id
}

export type ScopeContinuation = {
  workspaceId: string
  channelId: string
  // One active run per scope; also what the worker continues from.
  scopeKey: string
  // Null for plain channel scopes — the placeholder posts at channel level.
  threadRootId: string | null
  triggerMessageId: string
  senderId: string
  // Set for a resolved policy gate (LOR-81): the run resumes the parked
  // transcript and answers its approval request instead of building a delta.
  resumeApprovalId?: string
  // Called whenever no run (or queue ride) will answer the trigger after all —
  // archived channel, failed placeholder/enqueue, lost race with a settled
  // winner — so the caller can put its workflow back in the team's court.
  onAbandoned?: () => Promise<void>
}

// Start a scope's next run, answering `triggerMessageId`. Mirrors the worker's
// completion-drain shape: if the scope is busy, the message rides the scope
// queue (the drain starts it when the active run settles); otherwise
// placeholder + run + enqueue, with the same race handling. Shared by task
// threads, plain channel scopes, and approval resumes.
export async function startScopeContinuationRun(
  args: ScopeContinuation
): Promise<void> {
  const {
    workspaceId,
    channelId,
    scopeKey,
    threadRootId,
    triggerMessageId,
    senderId,
  } = args
  const room = scopeRoom(channelId, threadRootId)

  if (await channelIsArchived(channelId)) {
    logger.warn({ channelId }, "Scope continuation rejected: channel archived")
    await args.onAbandoned?.().catch(() => {})
    return
  }

  const queueBehindActiveRun = async (): Promise<
    "queued" | "no_active_run" | "failed"
  > => {
    const active = await db
      .select({ id: schema.agentRun.id, messageId: schema.agentRun.messageId })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.scopeKey, scopeKey),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    // A conversational scope always carries a placeholder message; a
    // message-less run is a headless triggered run, which can never occupy it.
    if (!active?.messageId) return "no_active_run"
    // A failed queue insert means no run will ever answer this trigger —
    // surface it so the caller can abandon instead of resolving into a
    // running task with nothing behind it.
    try {
      await db
        .insert(schema.agentRunQueue)
        .values({
          scopeKey,
          runId: active.id,
          messageId: triggerMessageId,
          senderId,
          state: "queued",
          // The resume must survive the queue ride — the drain forwards it so
          // the follow-up replays the parked transcript.
          resumeApprovalId: args.resumeApprovalId ?? null,
        })
        .onConflictDoNothing({ target: schema.agentRunQueue.messageId })
    } catch (err) {
      logger.error({ err, scopeKey }, "Scope queue insert failed")
      return "failed"
    }
    // The queue row is durable (the drain picks it up regardless); a failed
    // broadcast only costs the live routing indicator.
    try {
      const io = await getEmitter()
      io.to(room).emit("message:routed", {
        channelId,
        threadRootId,
        messageId: triggerMessageId,
        outcome: "queued",
        runId: active.id,
        merlinMessageId: active.messageId,
      })
    } catch (err) {
      logger.warn({ err, scopeKey }, "Queue routing broadcast failed")
    }
    return "queued"
  }

  const rideOutcome = await queueBehindActiveRun()
  if (rideOutcome === "queued") return
  if (rideOutcome === "failed") {
    await args.onAbandoned?.().catch(() => {})
    return
  }

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId,
      authorId: MERLIN_USER_ID,
      threadRootId,
      status: "pending",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
  if (!placeholder) {
    await args.onAbandoned?.().catch(() => {})
    return
  }

  const run = await db
    .insert(schema.agentRun)
    .values({
      workspaceId,
      channelId,
      messageId: placeholder.id,
      threadRootId,
      triggerMessageId,
      scopeKey,
      budgetSteps: env.AGENT_RUN_MAX_STEPS,
      budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
      budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
      budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
      budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
      budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
      budgetCredits: env.AGENT_RUN_MAX_CREDITS,
    })
    .returning({ id: schema.agentRun.id })
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      if (!isUniqueViolation(err)) {
        logger.error({ err, scopeKey }, "Scope run insert failed")
      }
      return null
    })

  if (!run) {
    // Lost the scope race — fall back to riding the winner's queue. If the
    // winner settled in the meantime (or the queue insert failed), no run
    // answers this trigger either.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    if ((await queueBehindActiveRun()) !== "queued") {
      await args.onAbandoned?.().catch(() => {})
    }
    return
  }

  // Best effort: the run row exists, so the enqueue below must happen no
  // matter what — a failed broadcast only costs the live placeholder.
  try {
    const merlin = await loadAuthor(MERLIN_USER_ID)
    if (merlin) {
      const message: RealtimeMessage = {
        id: placeholder.id,
        channelId,
        content: null,
        type: "default",
        pinned: false,
        createdAt: placeholder.createdAt.toISOString(),
        author: { ...merlin, avatarColor: null },
        mentions: [],
        reactions: [],
        attachments: [],
        embeds: [],
        referencedMessage: null,
        threadRootId,
        status: "pending",
        streaming: true,
        merlinTriggerMessageId: triggerMessageId,
      }
      const io = await getEmitter()
      io.to(room).emit("message:created", message)
    }
  } catch (err) {
    logger.warn({ err, scopeKey }, "Placeholder broadcast failed")
  }

  try {
    await getRespondQueue().add(
      "respond",
      {
        merlinMessageId: placeholder.id,
        channelId,
        threadRootId,
        contextThreadRootId: threadRootId,
        triggerMessageId,
        runId: run.id,
        ...(args.resumeApprovalId
          ? { resumeApprovalId: args.resumeApprovalId }
          : {}),
      },
      {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        jobId: run.id,
      }
    )
  } catch (err) {
    logger.error({ err, scopeKey }, "Scope run enqueue failed")
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, run.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    // Clients already saw the placeholder via message:created — retract it,
    // then hand the workflow back to the caller since no run is coming.
    try {
      const io = await getEmitter()
      io.to(room).emit("message:deleted", {
        channelId,
        messageId: placeholder.id,
      })
    } catch {}
    await args.onAbandoned?.().catch(() => {})
  }
}

// Task-thread flavour: the scope is the task's card thread, and an abandoned
// run puts the task back in the team's court.
export async function startTaskContinuationRun(args: {
  task: Task
  triggerMessageId: string
  senderId: string
}): Promise<void> {
  const { task } = args
  await startScopeContinuationRun({
    workspaceId: task.workspaceId,
    channelId: task.channelId,
    scopeKey: task.cardMessageId,
    threadRootId: task.cardMessageId,
    triggerMessageId: args.triggerMessageId,
    senderId: args.senderId,
    onAbandoned: async () => {
      await db
        .update(schema.task)
        .set({ status: "waiting_for_input" })
        .where(
          and(eq(schema.task.id, task.id), eq(schema.task.status, "running"))
        )
        .returning()
        .then((rows) => (rows[0] ? emitTaskUpdated(rows[0]) : undefined))
        .catch(() => {})
    },
  })
}
