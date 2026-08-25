import { db, eq, isUniqueViolation, MERLIN_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { MerlinRespondJobData } from "@repo/realtime-types/queues"
import { threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import {
  loadMerlinAuthor,
  postMerlinMessage as postMerlinChannelMessage,
} from "@/lib/merlin-messages"

type RedisClient = ReturnType<typeof createClient>

export type MerlinTaskDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
  respondQueue: Queue<MerlinRespondJobData>
}

// Card + task row + the task's first run — the same card-is-thread-root
// shape as createTaskWithCard + the follow-up-run pattern in run-queue.ts,
// so the created task lives entirely on existing task rails. Used by the
// unattended processors (Act triggers, loops) when Merlin's disposition is
// create_task; `originRunId` records which run spawned it.
export async function createMerlinTask(
  deps: MerlinTaskDeps,
  input: {
    workspaceId: string
    channelId: string
    title: string
    goal: string
    originRunId?: string
  }
): Promise<{ taskId: string }> {
  const postMerlinMessage = (msg: {
    channelId: string
    content: string
    type?: "default" | "task_card"
  }) =>
    postMerlinChannelMessage({ emitter: deps.emitter, redis: deps.redis }, msg)

  const { messageId: cardId } = await postMerlinMessage({
    channelId: input.channelId,
    content: input.goal,
    type: "task_card",
  })
  const task = await db
    .insert(schema.task)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      cardMessageId: cardId,
      creatorId: MERLIN_USER_ID,
      title: input.title,
      goal: input.goal,
      originRunId: input.originRunId ?? null,
    })
    .returning({ id: schema.task.id })
    .then((rows) => rows[0] ?? null)
  if (!task) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, cardId))
      .catch(() => {})
    throw new Error("Task insert returned no row")
  }

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId: input.channelId,
      authorId: MERLIN_USER_ID,
      threadRootId: cardId,
      status: "pending",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
  if (!placeholder) return { taskId: task.id }

  const taskRun = await db
    .insert(schema.agentRun)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      messageId: placeholder.id,
      threadRootId: cardId,
      triggerMessageId: cardId,
      scopeKey: cardId,
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
        logger.error({ err, taskId: task.id }, "Task first-run insert failed")
      }
      return null
    })
  if (!taskRun) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    return { taskId: task.id }
  }

  const author = await loadMerlinAuthor()
  if (author) {
    deps.emitter.to(threadRoom(cardId)).emit("message:created", {
      id: placeholder.id,
      channelId: input.channelId,
      content: null,
      type: "default",
      pinned: false,
      createdAt: placeholder.createdAt.toISOString(),
      author: { ...author, avatarColor: null },
      mentions: [],
      reactions: [],
      attachments: [],
      embeds: [],
      referencedMessage: null,
      threadRootId: cardId,
      status: "pending",
      streaming: true,
      merlinTriggerMessageId: cardId,
    })
  }

  try {
    await deps.respondQueue.add(
      "respond",
      {
        merlinMessageId: placeholder.id,
        channelId: input.channelId,
        threadRootId: cardId,
        contextThreadRootId: cardId,
        triggerMessageId: cardId,
        runId: taskRun.id,
      },
      {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        jobId: taskRun.id,
      }
    )
  } catch (err) {
    logger.error({ err, taskId: task.id }, "Task first-run enqueue failed")
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, taskRun.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
  }
  return { taskId: task.id }
}
