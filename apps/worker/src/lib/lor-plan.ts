import { db, eq, isUniqueViolation, LOR_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { settleAbandonedRunPlan, toRealtimePlan } from "@repo/lor/plans"
import { loadThreadSummary } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import type { LorRespondJobData } from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import {
  loadLorAuthor,
  postLorMessage as postLorChannelMessage,
} from "@/lib/lor-messages"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type RedisClient = ReturnType<typeof createClient>

export type LorPlanDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: RedisClient
  respondQueue: Queue<LorRespondJobData>
}

// Card + plan row + the plan's first run — the same card-is-thread-root
// shape + the follow-up-run pattern in run-queue.ts,
// so the created plan lives entirely on existing plan rails. Used by the
// unattended processors (Act triggers, loops) when Lor's disposition is
// create_plan; `originRunId` records which run spawned it.
export async function createLorPlan(
  deps: LorPlanDeps,
  input: {
    workspaceId: string
    channelId: string
    title: string
    goal: string
    originRunId?: string
  }
): Promise<{ planId: string }> {
  const postLorMessage = (msg: {
    channelId: string
    content: string
    type?: "default" | "plan_card"
  }) => postLorChannelMessage({ emitter: deps.emitter, redis: deps.redis }, msg)

  const { messageId: cardId } = await postLorMessage({
    channelId: input.channelId,
    content: input.goal,
    type: "plan_card",
  })
  const plan = await db
    .insert(schema.plan)
    .values({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      // Spawned plans keep card-as-root: no human root message exists.
      threadRootId: cardId,
      cardMessageId: cardId,
      creatorId: LOR_USER_ID,
      title: input.title,
      goal: input.goal,
      originRunId: input.originRunId ?? null,
    })
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!plan) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, cardId))
      .catch(() => {})
    throw new Error("Plan insert returned no row")
  }
  // Without this the card renders its degraded no-status fallback until the
  // channel-plans query refetches (nothing else emits for spawned cards;
  // this path previously didn't).
  deps.emitter
    .to(channelRoom(input.channelId))
    .emit("plan:updated", { plan: toRealtimePlan(plan) })

  // A plan stranded at its born-"running" default with no run behind it can
  // never settle — fail it on every path that bails before the enqueue.
  const failPlan = () =>
    settleAbandonedRunPlan({ threadRootId: cardId }, "failed", (row) => {
      deps.emitter
        .to(channelRoom(input.channelId))
        .emit("plan:updated", { plan: toRealtimePlan(row) })
      notifyWorkspaceActivity(row.workspaceId)
    }).catch((err) =>
      logger.error({ err, planId: plan.id }, "Plan fail-settle failed")
    )

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId: input.channelId,
      authorId: LOR_USER_ID,
      threadRootId: cardId,
      status: "pending",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((rows) => rows[0] ?? null)
  if (!placeholder) {
    await failPlan()
    return { planId: plan.id }
  }

  const planRun = await db
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
        logger.error({ err, planId: plan.id }, "Plan first-run insert failed")
      }
      return null
    })
  if (!planRun) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    await failPlan()
    return { planId: plan.id }
  }

  notifyWorkspaceActivity(input.workspaceId)

  const author = await loadLorAuthor()
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
      lorTriggerMessageId: cardId,
    })
  }
  try {
    await deps.respondQueue.add(
      "respond",
      {
        lorMessageId: placeholder.id,
        channelId: input.channelId,
        threadRootId: cardId,
        contextThreadRootId: cardId,
        triggerMessageId: cardId,
        runId: planRun.id,
      },
      {
        attempts: 2,
        // Must exceed the run lease TTL (60s) or the retry can never reclaim
        // a crashed attempt — it sees a live lease and skips.
        backoff: { type: "fixed", delay: 90_000 },
        jobId: planRun.id,
      }
    )
    // Channel viewers see the card via message:created; the pending reply only
    // reaches them through the thread summary (nobody has joined the new thread).
    await loadThreadSummary(input.channelId, cardId)
      .then((summary) =>
        deps.emitter
          .to(channelRoom(input.channelId))
          .emit("message:thread:updated", summary)
      )
      .catch((err) =>
        logger.warn({ err, planId: plan.id }, "Plan thread summary emit failed")
      )
  } catch (err) {
    logger.error({ err, planId: plan.id }, "Plan first-run enqueue failed")
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, planRun.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    deps.emitter.to(threadRoom(cardId)).emit("message:deleted", {
      channelId: input.channelId,
      messageId: placeholder.id,
    })
    // The deleted queued run's indicator must clear.
    notifyWorkspaceActivity(input.workspaceId)
    await failPlan()
  }
  return { planId: plan.id }
}
