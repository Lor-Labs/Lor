import {
  and,
  asc,
  db,
  eq,
  inArray,
  isUniqueViolation,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { env } from "@repo/env/server"
import { loadThreadSummary } from "@repo/messaging"
import type { LorRespondJobData, RealtimeMessage } from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import { logger } from "@/lib/logger"
import { resumeStillPending } from "@/lib/paused-turn"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

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
  respondQueue: Queue<LorRespondJobData>
}): Promise<void> {
  const drain = runDrain(args)
  inflightDrains.add(drain)
  void drain.catch(() => {}).finally(() => inflightDrains.delete(drain))
  return drain
}

async function runDrain(args: {
  runId: string
  emitter: Emitter<ServerToClientEvents>
  respondQueue: Queue<LorRespondJobData>
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

  // An archived session takes no more Lor turns: its queue is dropped.
  if (threadRootId) {
    const session = await findAgentSessionByThreadRoot(threadRootId)
    if (session?.archivedAt) {
      await db
        .update(schema.agentRunQueue)
        .set({ state: "rejected" })
        .where(
          inArray(
            schema.agentRunQueue.id,
            rows.map((r) => r.id)
          )
        )
      emitQueueUpdate(
        rows.map((r) => r.messageId),
        "rejected"
      )
      return
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
  // Queued resumes whose paused turn another run already finished.
  const finished: typeof rows = []
  let winner: (typeof rows)[number] | undefined
  for (const row of rows) {
    if (
      row.resumeApprovalId &&
      !(await resumeStillPending(row.resumeApprovalId))
    ) {
      finished.push(row)
      continue
    }
    if (memberIds.has(row.senderId) && row.messageChannelId === run.channelId) {
      winner = row
      break
    }
    rejected.push(row)
  }
  if (finished.length > 0) {
    await db
      .update(schema.agentRunQueue)
      .set({ state: "consumed" })
      .where(
        inArray(
          schema.agentRunQueue.id,
          finished.map((r) => r.id)
        )
      )
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

  const started = await startScopeRun(
    { emitter: args.emitter, respondQueue: args.respondQueue },
    {
      workspaceId: run.workspaceId,
      channelId: run.channelId,
      threadRootId,
      scopeKey: run.scopeKey,
      triggerMessageId: winner.messageId,
      // A queued approval resolution keeps its resume: the follow-up run
      // finishes the paused turn instead of building a delta.
      resumeApprovalId: winner.resumeApprovalId,
    },
    {
      // Release exactly this message: it leaves the pill, materializes in the
      // transcript, and the new run's snapshot picks it up as the question.
      // Deliberately BEFORE the enqueue — loadConversation excludes
      // still-queued rows, so if the job started before this committed, the
      // run would answer without its own question.
      beforeEnqueue: async () => {
        await db
          .update(schema.agentRunQueue)
          .set({ state: "consumed" })
          .where(eq(schema.agentRunQueue.id, winner.id))
        emitQueueUpdate([winner.messageId], "consumed")
      },
      // No job means nothing will ever work this run — the message goes back
      // to queued (the next terminal retries).
      onUnwind: async () => {
        await db
          .update(schema.agentRunQueue)
          .set({ state: "queued" })
          .where(eq(schema.agentRunQueue.id, winner.id))
          .catch(() => {})
      },
    }
  )
  // Busy: the scope was re-occupied first (a fresh mention won the race).
  // Queued rows stay out of every run's context until their own drain, so
  // everything stays queued for the next terminal.
  if (started !== "started") return

  logger.info(
    {
      scopeKey: run.scopeKey,
      messageId: winner.messageId,
      remaining: rows.length - rejected.length - 1,
    },
    "Drained next queued message into follow-up run"
  )
}

export type ScopeRunStart = {
  workspaceId: string
  channelId: string
  threadRootId: string | null
  scopeKey: string
  triggerMessageId: string
  // Loop fires carry their loop: pause stops runs by it, history lists by it.
  loopId?: string
  scheduledFor?: Date
  resumeApprovalId?: string | null
  // An Act run created before its session (its deliveries point at it) is
  // moved into the scope instead of inserting a new run.
  queuedRunId?: string
}

// Placeholder + run + respond job answering one trigger message in an idle
// scope. "busy" means another run holds the scope (one active run per scope)
// and nothing was started. `beforeEnqueue` runs once the run row commits;
// if the enqueue then fails, everything unwinds and `onUnwind` runs. Shared
// by the queue drain, loop fires and Act sessions.
export async function startScopeRun(
  deps: {
    emitter: Emitter<ServerToClientEvents>
    respondQueue: Queue<LorRespondJobData>
  },
  args: ScopeRunStart,
  hooks: {
    beforeEnqueue?: () => Promise<void>
    onUnwind?: () => Promise<void>
  } = {}
): Promise<"started" | "busy" | "failed"> {
  const { channelId, threadRootId, scopeKey } = args
  const room = threadRootId ? threadRoom(threadRootId) : channelRoom(channelId)

  const lorUser = await db
    .select({ name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, LOR_USER_ID))
    .then((r) => r[0])
  if (!lorUser) return "failed"

  const placeholder = await db
    .insert(schema.message)
    .values({
      channelId,
      authorId: LOR_USER_ID,
      threadRootId,
      status: "pending",
    })
    .returning({ id: schema.message.id, createdAt: schema.message.createdAt })
    .then((r) => r[0])
  if (!placeholder) return "failed"

  let busy = false
  const placement = {
    messageId: placeholder.id,
    threadRootId,
    triggerMessageId: args.triggerMessageId,
    scopeKey,
  }
  const placed: Promise<{ id: string }[]> = args.queuedRunId
    ? db
        .update(schema.agentRun)
        .set(placement)
        .where(
          and(
            eq(schema.agentRun.id, args.queuedRunId),
            eq(schema.agentRun.state, "queued")
          )
        )
        .returning({ id: schema.agentRun.id })
    : db
        .insert(schema.agentRun)
        .values({
          ...placement,
          workspaceId: args.workspaceId,
          channelId,
          loopId: args.loopId ?? null,
          scheduledFor: args.scheduledFor ?? null,
          budgetSteps: env.AGENT_RUN_MAX_STEPS,
          budgetInputTokens: env.AGENT_RUN_MAX_INPUT_TOKENS,
          budgetOutputTokens: env.AGENT_RUN_MAX_OUTPUT_TOKENS,
          budgetToolCalls: env.AGENT_RUN_MAX_TOOL_CALLS,
          budgetToolOutputBytes: env.AGENT_RUN_MAX_TOOL_OUTPUT_BYTES,
          budgetWallMs: env.AGENT_RUN_MAX_WALL_MS,
          budgetCredits: env.AGENT_RUN_MAX_CREDITS,
        })
        .returning({ id: schema.agentRun.id })
  const newRun = await placed
    .then((r) => r[0] ?? null)
    .catch((err) => {
      // Only the one-active-run-per-scope unique index is expected contention.
      if (isUniqueViolation(err)) busy = true
      else logger.error({ err, scopeKey }, "Scope run insert failed")
      return null
    })
  if (!newRun) {
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    return busy ? "busy" : "failed"
  }

  notifyWorkspaceActivity(args.workspaceId)
  await hooks.beforeEnqueue?.()

  const realtimePlaceholder: RealtimeMessage = {
    id: placeholder.id,
    channelId,
    content: null,
    type: "default",
    pinned: false,
    createdAt: placeholder.createdAt.toISOString(),
    author: {
      id: LOR_USER_ID,
      name: lorUser.name,
      image: lorUser.image,
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
    lorTriggerMessageId: args.triggerMessageId,
  }
  deps.emitter.to(room).emit("message:created", realtimePlaceholder)
  try {
    await deps.respondQueue.add(
      "respond",
      {
        lorMessageId: placeholder.id,
        channelId,
        threadRootId,
        contextThreadRootId: threadRootId,
        triggerMessageId: args.triggerMessageId,
        runId: newRun.id,
        ...(args.resumeApprovalId
          ? { resumeApprovalId: args.resumeApprovalId }
          : {}),
      },
      {
        attempts: 2,
        // Must exceed the run lease TTL (60s) or the retry can never reclaim
        // a crashed attempt — it sees a live lease and skips.
        backoff: { type: "fixed", delay: 90_000 },
        jobId: newRun.id,
      }
    )
  } catch (err) {
    logger.error(
      { err, scopeKey, runId: newRun.id },
      "Scope run enqueue failed; unwinding"
    )
    await hooks.onUnwind?.()
    await db
      .delete(schema.agentRun)
      .where(eq(schema.agentRun.id, newRun.id))
      .catch(() => {})
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, placeholder.id))
      .catch(() => {})
    deps.emitter
      .to(room)
      .emit("message:deleted", { channelId, messageId: placeholder.id })
    // The queued run's indicator must clear now that the row is gone.
    notifyWorkspaceActivity(args.workspaceId)
    return "failed"
  }
  // Channel feeds only learn about threaded activity via
  // message:thread:updated — without this, a new run bumps nothing for
  // viewers outside the thread until reload.
  if (threadRootId) {
    await loadThreadSummary(channelId, threadRootId)
      .then((summary) =>
        deps.emitter
          .to(channelRoom(channelId))
          .emit("message:thread:updated", summary)
      )
      .catch((err) =>
        logger.warn({ err, threadRootId }, "Scope run thread summary failed")
      )
  }
  return "started"
}
