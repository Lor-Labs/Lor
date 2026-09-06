import { db, eq, isUniqueViolation, MERLIN_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { settleAbandonedRunTask, toRealtimeTask } from "@repo/merlin/tasks"
import { loadThreadSummary } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { MerlinRespondJobData } from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
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
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!task) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, cardId))
      .catch(() => {})
    throw new Error("Task insert returned no row")
  }
  // Without this the card renders its degraded no-status fallback until the
  // channel-tasks query refetches (the gateway's createTaskWithCard emits it;
  // this path previously didn't).
  deps.emitter
    .to(channelRoom(input.channelId))
    .emit("task:updated", { task: toRealtimeTask(task) })

  // A task stranded at its born-"running" default with no run behind it can
  // never settle — fail it on every path that bails before the enqueue.
  const failTask = () =>
    settleAbandonedRunTask({ threadRootId: cardId }, "failed", (row) =>
      deps.emitter
        .to(channelRoom(input.channelId))
        .emit("task:updated", { task: toRealtimeTask(row) })
    ).catch((err) =>
      logger.error({ err, taskId: task.id }, "Task fail-settle failed")
    )

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
  if (!placeholder) {
    await failTask()
    return { taskId: task.id }
  }

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
    await failTask()
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
  // Channel viewers see the card via message:created; the pending reply only
  // reaches them through the thread summary (nobody has joined the new thread).
  void loadThreadSummary(input.channelId, cardId)
    .then((summary) =>
      deps.emitter
        .to(channelRoom(input.channelId))
        .emit("message:thread:updated", summary)
    )
    .catch((err) =>
      logger.warn({ err, taskId: task.id }, "Task thread summary emit failed")
    )

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
        // Must exceed the run lease TTL (60s) or the retry can never reclaim
        // a crashed attempt — it sees a live lease and skips.
        backoff: { type: "fixed", delay: 90_000 },
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
    await failTask()
  }
  return { taskId: task.id }
}
