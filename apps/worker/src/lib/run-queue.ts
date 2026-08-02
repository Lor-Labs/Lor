import { and, asc, db, eq, inArray, lt, MERLIN_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import type {
  MerlinRespondJobData,
  RealtimeMessage,
} from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const
const TERMINAL_RUN_STATES = ["complete", "failed", "stopped"] as const

// Drain the scope's queue once a run goes terminal: reauthorize each sender
// at dequeue time, then start one follow-up run — its conversation snapshot
// at claim covers all the queued messages, so no explicit seeding is needed.
// Best-effort: a failure here must never affect the finished run.
export async function drainScopeQueue(args: {
  runId: string
  emitter: Emitter<ServerToClientEvents>
  respondQueue: Queue<MerlinRespondJobData>
}): Promise<void> {
  const run = await db
    .select({
      scopeKey: schema.agentRun.scopeKey,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
      workspaceId: schema.agentRun.workspaceId,
    })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.id, args.runId))
    .then((r) => r[0])
  if (!run) return

  // Steered rows an ended run never injected are queued work, never dropped.
  // Scope-wide over terminal runs so a crashed run's leftovers get swept by
  // the next completion here too.
  await db
    .update(schema.agentRunQueue)
    .set({ state: "queued" })
    .where(
      and(
        eq(schema.agentRunQueue.scopeKey, run.scopeKey),
        eq(schema.agentRunQueue.state, "steered"),
        inArray(
          schema.agentRunQueue.runId,
          db
            .select({ id: schema.agentRun.id })
            .from(schema.agentRun)
            .where(inArray(schema.agentRun.state, [...TERMINAL_RUN_STATES]))
        )
      )
    )

  const rows = await db
    .select({
      id: schema.agentRunQueue.id,
      messageId: schema.agentRunQueue.messageId,
      senderId: schema.agentRunQueue.senderId,
      messageChannelId: schema.message.channelId,
    })
    .from(schema.agentRunQueue)
    .innerJoin(
      schema.message,
      eq(schema.agentRunQueue.messageId, schema.message.id)
    )
    .where(
      and(
        eq(schema.agentRunQueue.scopeKey, run.scopeKey),
        eq(schema.agentRunQueue.state, "queued")
      )
    )
    .orderBy(asc(schema.agentRunQueue.createdAt))
  if (rows.length === 0) return

  // Dequeue reauthorization: queued work never rides send-time authorization.
  // The sender must still be a member of the run's workspace, and the message
  // must live in the run's channel (tenant binding).
  const senderIds = [...new Set(rows.map((r) => r.senderId))]
  const members = await db
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, run.workspaceId),
        inArray(schema.workspaceMember.userId, senderIds)
      )
    )
  const memberIds = new Set(members.map((m) => m.userId))
  const authorized = rows.filter(
    (r) => memberIds.has(r.senderId) && r.messageChannelId === run.channelId
  )
  const rejected = rows.filter((r) => !authorized.includes(r))
  if (rejected.length > 0) {
    await db
      .update(schema.agentRunQueue)
      .set({ state: "rejected" })
      .where(
        inArray(
          schema.agentRunQueue.id,
          rejected.map((r) => r.id)
        )
      )
    logger.warn(
      { scopeKey: run.scopeKey, count: rejected.length },
      "Rejected queued run messages at dequeue reauthorization"
    )
  }
  if (authorized.length === 0) return

  const threadRootId = run.scopeKey === run.channelId ? null : run.scopeKey
  const triggerMessageId = authorized[authorized.length - 1]?.messageId
  if (!triggerMessageId) return

  const merlinUser = await db
    .select({
      name: schema.user.name,
      username: schema.user.username,
      displayUsername: schema.user.displayUsername,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.id, MERLIN_USER_ID))
    .then((r) => r[0])
  if (!merlinUser) return

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId: run.channelId,
      authorId: MERLIN_USER_ID,
      threadRootId,
      status: "pending",
    })
    .returning({
      id: schema.message.id,
      createdAt: schema.message.createdAt,
    })
    .then((r) => r[0])
  if (!placeholder) return

  const newRun = await db
    .insert(schema.agentRun)
    .values({
      workspaceId: run.workspaceId,
      channelId: run.channelId,
      messageId: placeholder.id,
      threadRootId,
      triggerMessageId,
      scopeKey: run.scopeKey,
      budgetSteps: env.AGENT_RUN_MAX_STEPS,
      budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
      budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
      budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
      budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
      budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
      budgetCredits: env.AGENT_RUN_MAX_CREDITS,
    })
    .returning({ id: schema.agentRun.id })
    .then((r) => r[0] ?? null)
    .catch(() => null)

  if (!newRun) {
    // The scope was re-occupied first (a fresh mention won the race). That
    // run's snapshot covers messages older than it — consume those; anything
    // newer stays queued for the next drain.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    const active = await db
      .select({ createdAt: schema.agentRun.createdAt })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.scopeKey, run.scopeKey),
          inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
        )
      )
      .then((r) => r[0])
    if (active) {
      await db
        .update(schema.agentRunQueue)
        .set({ state: "consumed" })
        .where(
          and(
            inArray(
              schema.agentRunQueue.id,
              authorized.map((r) => r.id)
            ),
            lt(schema.agentRunQueue.createdAt, active.createdAt)
          )
        )
        .catch(() => {})
    }
    return
  }

  // The new run's snapshot at claim covers these messages.
  await db
    .update(schema.agentRunQueue)
    .set({ state: "consumed" })
    .where(
      inArray(
        schema.agentRunQueue.id,
        authorized.map((r) => r.id)
      )
    )

  const realtimePlaceholder: RealtimeMessage = {
    id: placeholder.id,
    channelId: run.channelId,
    content: null,
    type: "default",
    pinned: false,
    createdAt: placeholder.createdAt.toISOString(),
    author: {
      id: MERLIN_USER_ID,
      name: merlinUser.name,
      username: merlinUser.username,
      displayUsername: merlinUser.displayUsername,
      image: merlinUser.image,
      avatarColor: null,
    },
    mentions: [],
    reactions: [],
    attachments: [],
    embeds: [],
    referencedMessage: null,
    threadRootId,
    status: "pending",
    streaming: true,
  }
  // Thread footer counts refresh with the next real reply; the worker skips
  // the summary recompute the realtime service does on its own placeholders.
  args.emitter
    .to(threadRootId ? threadRoom(threadRootId) : channelRoom(run.channelId))
    .emit("message:created", realtimePlaceholder)

  await args.respondQueue.add(
    "respond",
    {
      merlinMessageId: placeholder.id,
      channelId: run.channelId,
      threadRootId,
      contextThreadRootId: threadRootId,
      triggerMessageId,
      runId: newRun.id,
    },
    {
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      jobId: newRun.id,
    }
  )
  logger.info(
    { scopeKey: run.scopeKey, runId: newRun.id, seeded: authorized.length },
    "Drained scope queue into follow-up run"
  )
}
