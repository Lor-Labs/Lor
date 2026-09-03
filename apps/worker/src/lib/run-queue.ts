import {
  and,
  asc,
  db,
  eq,
  inArray,
  isUniqueViolation,
  MERLIN_USER_ID,
  schema,
  sql,
} from "@repo/db"
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

const TERMINAL_RUN_STATES = ["complete", "failed", "stopped"] as const

// In-flight drains, so shutdown can wait out the insert-run→enqueue-job
// window instead of exiting in the middle of it.
const inflightDrains = new Set<Promise<void>>()

export function awaitInflightDrains(): Promise<void> {
  return Promise.allSettled([...inflightDrains]).then(() => {})
}

// Drain the scope's queue once a run goes terminal: pop the FIRST queued
// message (steered/promoted rows first), reauthorize its sender at dequeue
// time, and start one follow-up run answering just that message. The rest
// stay queued — each completion drains the next, so every queued message
// gets its own run and answer. Best-effort: a failure here must never
// affect the finished run.
export function drainScopeQueue(args: {
  runId: string
  emitter: Emitter<ServerToClientEvents>
  respondQueue: Queue<MerlinRespondJobData>
}): Promise<void> {
  const drain = runDrain(args)
  inflightDrains.add(drain)
  void drain.catch(() => {}).finally(() => inflightDrains.delete(drain))
  return drain
}

async function runDrain(args: {
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

  // Steered rows jump the line: promoted first (FIFO among promoted), then
  // arrival order. Each drain pops exactly ONE message — every queued message
  // gets its own run and its own answer, never collapsed into a batch.
  const rows = await db
    .select({
      id: schema.agentRunQueue.id,
      messageId: schema.agentRunQueue.messageId,
      senderId: schema.agentRunQueue.senderId,
      resumeApprovalId: schema.agentRunQueue.resumeApprovalId,
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
    .orderBy(
      sql`${schema.agentRunQueue.promotedAt} asc nulls last`,
      asc(schema.agentRunQueue.createdAt)
    )
  if (rows.length === 0) return

  const threadRootId = run.scopeKey === run.channelId ? null : run.scopeKey
  const scopeRoom = threadRootId
    ? threadRoom(threadRootId)
    : channelRoom(run.channelId)
  // Clients drop drained/rejected messages from the queued pill.
  const emitQueueUpdate = (
    messageIds: string[],
    state: "consumed" | "rejected"
  ) => {
    for (const messageId of messageIds) {
      args.emitter.to(scopeRoom).emit("run:queue:updated", {
        channelId: run.channelId,
        threadRootId,
        messageId,
        state,
      })
    }
  }

  // Dequeue reauthorization: queued work never rides send-time authorization.
  // The sender must still be a member of the run's workspace, and the message
  // must live in the run's channel (tenant binding). Walk in drain order to
  // the first authorized row; unauthorized rows ahead of it are rejected,
  // rows behind it stay queued for the next drain.
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
  const rejected: typeof rows = []
  let winner: (typeof rows)[number] | undefined
  for (const row of rows) {
    if (memberIds.has(row.senderId) && row.messageChannelId === run.channelId) {
      winner = row
      break
    }
    rejected.push(row)
  }
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
    emitQueueUpdate(
      rejected.map((r) => r.messageId),
      "rejected"
    )
    logger.warn(
      { scopeKey: run.scopeKey, count: rejected.length },
      "Rejected queued run messages at dequeue reauthorization"
    )
  }
  if (!winner) return

  const triggerMessageId = winner.messageId

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
    .catch((err) => {
      // Only the one-active-run-per-scope unique index is expected contention;
      // anything else is a real failure worth surfacing (rows stay queued
      // either way, so the next terminal retries).
      if (!isUniqueViolation(err)) {
        logger.error(
          { err, scopeKey: run.scopeKey },
          "Follow-up run insert failed"
        )
      }
      return null
    })

  if (!newRun) {
    // The scope was re-occupied first (a fresh mention won the race). Queued
    // rows are excluded from every run's context until their own drain, so
    // nothing to consume — everything stays queued for the next terminal.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    return
  }

  // Release exactly this message: it leaves the pill, materializes in the
  // transcript, and the new run's snapshot picks it up as the question.
  // Deliberately BEFORE the enqueue — loadConversation excludes still-queued
  // rows, so if the job started before this committed, the run would answer
  // without its own question. The enqueue-failure catch below compensates.
  await db
    .update(schema.agentRunQueue)
    .set({ state: "consumed" })
    .where(eq(schema.agentRunQueue.id, winner.id))
  emitQueueUpdate([winner.messageId], "consumed")

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
    merlinTriggerMessageId: triggerMessageId,
  }
  // Thread footer counts refresh with the next real reply; the worker skips
  // the summary recompute the realtime service does on its own placeholders.
  args.emitter
    .to(threadRootId ? threadRoom(threadRootId) : channelRoom(run.channelId))
    .emit("message:created", realtimePlaceholder)

  try {
    await args.respondQueue.add(
      "respond",
      {
        merlinMessageId: placeholder.id,
        channelId: run.channelId,
        threadRootId,
        contextThreadRootId: threadRootId,
        triggerMessageId,
        runId: newRun.id,
        // A queued approval resolution keeps its resume: the follow-up run
        // replays the parked transcript instead of building a delta.
        ...(winner.resumeApprovalId
          ? { resumeApprovalId: winner.resumeApprovalId }
          : {}),
      },
      {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        jobId: newRun.id,
      }
    )
  } catch (err) {
    // No job means nothing will ever work this run — unwind so the message
    // goes back to queued (next terminal retries) instead of being consumed
    // by a run that never starts.
    logger.error(
      { err, scopeKey: run.scopeKey, runId: newRun.id },
      "Follow-up run enqueue failed; requeuing message"
    )
    await db
      .update(schema.agentRunQueue)
      .set({ state: "queued" })
      .where(eq(schema.agentRunQueue.id, winner.id))
      .catch(() => {})
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, newRun.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    args.emitter.to(scopeRoom).emit("message:deleted", {
      channelId: run.channelId,
      messageId: placeholder.id,
    })
    return
  }
  logger.info(
    {
      scopeKey: run.scopeKey,
      runId: newRun.id,
      messageId: winner.messageId,
      remaining: rows.length - rejected.length - 1,
    },
    "Drained next queued message into follow-up run"
  )
}
