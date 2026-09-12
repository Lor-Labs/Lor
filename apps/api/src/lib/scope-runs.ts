import {
  and,
  db,
  eq,
  inArray,
  isNull,
  isUniqueViolation,
  MERLIN_USER_ID,
  schema,
} from "@repo/db"
import type { Plan } from "@repo/db/schema"
import { env } from "@repo/env/server"
import { toRealtimePlan } from "@repo/merlin/plans"
import { loadThreadSummary } from "@repo/messaging"
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

// Shared row→wire serializer (drift-guarded in @repo/merlin/plans);
// re-exported under the name this app's handlers already import.
export { toRealtimePlan as serializePlan }

export async function emitPlanUpdated(plan: Plan): Promise<void> {
  const io = await getEmitter()
  io.to(channelRoom(plan.channelId)).emit("plan:updated", {
    plan: toRealtimePlan(plan),
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

// Archived channels (archived projects) are write-locked everywhere; plan
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

// Thread replies posted server-side must update the channel feed's "N replies"
// footer just like gateway-sent ones: recompute the summary and broadcast it
// to the channel room. `reply` rides along only for a settled message (never a
// streaming placeholder — injecting one into a closed panel's cache would
// freeze it mid-"thinking"). Best effort; the reply row is already durable.
async function emitScopeThreadSummary(
  channelId: string,
  threadRootId: string,
  reply?: RealtimeMessage
): Promise<void> {
  try {
    const [io, summary] = await Promise.all([
      getEmitter(),
      loadThreadSummary(channelId, threadRootId),
    ])
    io.to(channelRoom(channelId)).emit(
      "message:thread:updated",
      reply ? { ...summary, reply } : summary
    )
  } catch (err) {
    logger.warn({ err, threadRootId }, "Scope thread summary emit failed")
  }
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
  let realtimeReply: RealtimeMessage | undefined
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
    realtimeReply = message
    const io = await getEmitter()
    io.to(scopeRoom(args.channelId, args.threadRootId)).emit(
      "message:created",
      message
    )
  }
  if (args.threadRootId) {
    await emitScopeThreadSummary(
      args.channelId,
      args.threadRootId,
      realtimeReply
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
// placeholder + run + enqueue, with the same race handling. Shared by plan
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
    // running plan with nothing behind it.
    let insertedId: string | null = null
    try {
      insertedId = await db
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
        .returning({ id: schema.agentRunQueue.id })
        .then((rows) => rows[0]?.id ?? null)
    } catch (err) {
      logger.error({ err, scopeKey }, "Scope queue insert failed")
      return "failed"
    }
    // Conflict: this trigger already routed (client resend) — it rides
    // whatever handled it the first time.
    if (!insertedId) return "queued"
    // The run may have gone terminal (and drained its queue) between the
    // read and the insert — recheck, mirroring routeToActiveRun in the
    // realtime service, or the row strands with nothing left to start it.
    const nowState = await db
      .select({ state: schema.agentRun.state })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, active.id))
      .then((rows) => rows[0]?.state)
      .catch(() => undefined)
    if (
      !nowState ||
      nowState === "complete" ||
      nowState === "failed" ||
      nowState === "stopped"
    ) {
      const undone = await db
        .delete(schema.agentRunQueue)
        .where(
          and(
            eq(schema.agentRunQueue.id, insertedId),
            eq(schema.agentRunQueue.state, "queued")
          )
        )
        .returning({ id: schema.agentRunQueue.id })
        .catch(() => [])
      // Undone: start a fresh run instead. Not undone: the terminal drain
      // swept the row first, so it's riding a follow-up run.
      if (undone.length > 0) return "no_active_run"
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
    // The pending placeholder counts as a reply on purpose (that "1 reply" is
    // the working signal); no `reply` attached — it's still streaming.
    if (threadRootId) {
      await emitScopeThreadSummary(channelId, threadRootId)
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
        // Must exceed the run lease TTL (60s) or the retry can never reclaim
        // a crashed attempt — it sees a live lease and skips.
        backoff: { type: "fixed", delay: 90_000 },
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
    if (threadRootId) {
      await emitScopeThreadSummary(channelId, threadRootId)
    }
    await args.onAbandoned?.().catch(() => {})
  }
}

// Plan-thread flavour: the scope is the plan's anchor thread, and an
// abandoned run puts the plan back in the team's court.
export async function startPlanContinuationRun(args: {
  plan: Plan
  triggerMessageId: string
  senderId: string
}): Promise<void> {
  const { plan } = args
  await startScopeContinuationRun({
    workspaceId: plan.workspaceId,
    channelId: plan.channelId,
    scopeKey: plan.threadRootId,
    threadRootId: plan.threadRootId,
    triggerMessageId: args.triggerMessageId,
    senderId: args.senderId,
    onAbandoned: async () => {
      await db
        .update(schema.plan)
        .set({ status: "waiting_for_input" })
        .where(
          and(
            eq(schema.plan.id, plan.id),
            eq(schema.plan.status, "running"),
            // Only when no run owns the plan — a newer continuation may have
            // claimed it between this run's creation and its abandonment.
            isNull(schema.plan.activeRunId)
          )
        )
        .returning()
        .then((rows) => (rows[0] ? emitPlanUpdated(rows[0]) : undefined))
        .catch(() => {})
    },
  })
}
