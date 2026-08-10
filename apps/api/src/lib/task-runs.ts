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
import type { RealtimeMessage, RealtimeTask } from "@repo/realtime-types"
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

export function serializeTask(row: Task): RealtimeTask {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    cardMessageId: row.cardMessageId,
    creatorId: row.creatorId,
    title: row.title,
    goal: row.goal,
    status: row.status,
    plan: row.plan,
    summary: row.summary,
    activeRunId: row.activeRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function emitTaskUpdated(task: Task): Promise<void> {
  const io = await getEmitter()
  io.to(channelRoom(task.channelId)).emit("task:updated", {
    task: serializeTask(task),
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

// Post a message into the task thread (e.g. an approval resolution, authored
// by the resolver) and broadcast it. Returns the message id.
export async function postTaskThreadMessage(args: {
  task: Task
  authorId: string
  content: string
}): Promise<string | null> {
  const inserted = await db
    .insert(schema.message)
    .values({
      channelId: args.task.channelId,
      authorId: args.authorId,
      content: args.content,
      threadRootId: args.task.cardMessageId,
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
    .catch((err) => {
      logger.error({ err, taskId: args.task.id }, "Task thread post failed")
      return null
    })
  if (!inserted) return null

  // The message is committed; a failed author lookup only costs the live
  // broadcast (clients catch up on refetch) — never the caller's 200.
  const author = await loadAuthor(args.authorId).catch(() => null)
  if (author) {
    const message: RealtimeMessage = {
      id: inserted.id,
      channelId: args.task.channelId,
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
      threadRootId: args.task.cardMessageId,
      status: "complete",
    }
    const io = await getEmitter()
    io.to(threadRoom(args.task.cardMessageId)).emit("message:created", message)
  }
  return inserted.id
}

// Start the task's next run, answering `triggerMessageId`. Mirrors the
// worker's completion-drain shape: if the scope is busy, the message rides
// the scope queue (the drain starts it when the active run settles);
// otherwise placeholder + run + enqueue, with the same race handling.
export async function startTaskContinuationRun(args: {
  task: Task
  triggerMessageId: string
  senderId: string
}): Promise<void> {
  const { task, triggerMessageId, senderId } = args
  const scopeKey = task.cardMessageId

  const queueBehindActiveRun = async (): Promise<boolean> => {
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
    if (!active) return false
    await db
      .insert(schema.agentRunQueue)
      .values({
        scopeKey,
        runId: active.id,
        messageId: triggerMessageId,
        senderId,
        state: "queued",
      })
      .onConflictDoNothing({ target: schema.agentRunQueue.messageId })
    const io = await getEmitter()
    io.to(threadRoom(scopeKey)).emit("message:routed", {
      channelId: task.channelId,
      threadRootId: scopeKey,
      messageId: triggerMessageId,
      outcome: "queued",
      runId: active.id,
      merlinMessageId: active.messageId,
    })
    return true
  }

  if (await queueBehindActiveRun()) return

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId: task.channelId,
      authorId: MERLIN_USER_ID,
      threadRootId: scopeKey,
      status: "pending",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
  if (!placeholder) return

  const run = await db
    .insert(schema.agentRun)
    .values({
      workspaceId: task.workspaceId,
      channelId: task.channelId,
      messageId: placeholder.id,
      threadRootId: scopeKey,
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
        logger.error({ err, taskId: task.id }, "Task run insert failed")
      }
      return null
    })

  if (!run) {
    // Lost the scope race — fall back to riding the winner's queue.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    await queueBehindActiveRun()
    return
  }

  // Best effort: the run row exists, so the enqueue below must happen no
  // matter what — a failed broadcast only costs the live placeholder.
  try {
    const merlin = await loadAuthor(MERLIN_USER_ID)
    if (merlin) {
      const message: RealtimeMessage = {
        id: placeholder.id,
        channelId: task.channelId,
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
        threadRootId: scopeKey,
        status: "pending",
        streaming: true,
        merlinTriggerMessageId: triggerMessageId,
      }
      const io = await getEmitter()
      io.to(threadRoom(scopeKey)).emit("message:created", message)
    }
  } catch (err) {
    logger.warn({ err, taskId: task.id }, "Placeholder broadcast failed")
  }

  try {
    await getRespondQueue().add(
      "respond",
      {
        merlinMessageId: placeholder.id,
        channelId: task.channelId,
        threadRootId: scopeKey,
        contextThreadRootId: scopeKey,
        triggerMessageId,
        runId: run.id,
      },
      {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        jobId: run.id,
      }
    )
  } catch (err) {
    logger.error({ err, taskId: task.id }, "Task run enqueue failed")
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, run.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    // Clients already saw the placeholder via message:created — retract it,
    // and put the task back in the team's court since no run is coming.
    try {
      const io = await getEmitter()
      io.to(threadRoom(scopeKey)).emit("message:deleted", {
        channelId: task.channelId,
        messageId: placeholder.id,
      })
    } catch {}
    await db
      .update(schema.task)
      .set({ status: "waiting_for_input" })
      .where(
        and(eq(schema.task.id, task.id), eq(schema.task.status, "running"))
      )
      .returning()
      .then((rows) => (rows[0] ? emitTaskUpdated(rows[0]) : undefined))
      .catch(() => {})
  }
}
