import {
  and,
  db,
  eq,
  inArray,
  isNull,
  LOR_USER_ID,
  schema,
  sql,
} from "@repo/db"
import { ownConversation } from "@repo/db/queries/agent-conversations"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { isAgentInChannel, pauseLoopsAgentLeft } from "@repo/db/queries/agents"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import type { Loop } from "@repo/db/schema"
import type { RunLoopContext } from "@repo/lor"
import {
  ensureLoopSession,
  toRealtimeAgentSession,
} from "@repo/lor/agent-sessions"
import {
  addInboxNote,
  type CompleteAgentLoop,
  loopFireSourceId,
  loopInboxNote,
} from "@repo/lor/channel-agent"
import { describeLoopSchedule } from "@repo/lor/loop-schedule"
import { loopEventTargets, toRealtimeLoop } from "@repo/lor/loops"
import { channelEventContent } from "@repo/messaging"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_FLUSH_JOB,
  type LorRespondJobData,
} from "@repo/realtime-types/queues"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import type { AgentQueueData } from "@/lib/agent-inbox"
import { logger } from "@/lib/logger"
import { postLorMessage } from "@/lib/lor-messages"
import { startScopeRun } from "@/lib/run-queue"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type LoopDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
}

// Consecutive terminal failures (incl. out_of_credits) before a loop pauses
// itself and says so in its session. See reference/loops.md.
export const LOOP_AUTO_PAUSE_FAILURES = 5

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

export function emitLoopUpdated(
  emitter: Emitter<ServerToClientEvents>,
  row: Loop,
  // The chat it reported in until this change, which lists it no more.
  leftChannelId?: string | null
) {
  void loopEventTargets(row)
    .then(({ rooms, cardChannelId }) => {
      const to = leftChannelId ? [...rooms, channelRoom(leftChannelId)] : rooms
      if (to.length === 0) return
      emitter
        .to(to)
        .emit("loop:updated", { loop: toRealtimeLoop(row), cardChannelId })
    })
    .catch((err: unknown) =>
      logger.warn({ err, loopId: row.id }, "Loop update emit failed")
    )
}

type FireOutcome = "started" | "queued" | "skipped" | "failed"

// A Loop's fire in a chat wakes the Loop's own agent in its own
// conversation, through its inbox (reference/always-on-agents.md §3,
// agents-and-chats.md decisions 15 and 27): the turn that reads it is the
// fire's run and is about the chat the Loop reports in. A Loop with no chat
// is a scheduled wake and nothing more: its turn is about no chat, and an
// agent in no chat at all runs it too. A Loop with no agent runs for
// nobody, and one whose agent left its chat pauses. A fire of the same Loop
// still unread or running skips this one.
async function fireLoopToInbox(
  deps: LoopDeps & { agentInboxQueue: Queue<AgentQueueData> },
  loop: Loop,
  scheduledFor: Date
): Promise<FireOutcome> {
  if (!loop.agentId) return "skipped"
  const loopChannelId = loop.channelId
  if (loopChannelId && !(await isAgentInChannel(loop.agentId, loopChannelId))) {
    // The API pauses them when the agent is taken out; this covers one that
    // slipped past it, with the same line in the chat.
    for (const paused of await pauseLoopsAgentLeft(
      loop.agentId,
      loopChannelId
    )) {
      emitLoopUpdated(deps.emitter, paused)
      if (!paused.channelId) continue
      await postLorMessage(deps, {
        channelId: paused.channelId,
        content: channelEventContent({
          eventType: "loop_paused",
          loopName: paused.name,
          reason: "agent_left",
        }),
        type: "event",
        eventType: "loop_paused",
        eventPayload: {
          loopId: paused.id,
          loopName: paused.name,
          reason: "agent_left",
        },
        silent: true,
      }).catch((err) =>
        logger.error({ err, loopId: paused.id }, "Loop pause note failed")
      )
    }
    return "skipped"
  }
  const [[waiting], [running], [creator]] = await Promise.all([
    db
      .select({ conversationId: schema.agentInbox.conversationId })
      .from(schema.agentInbox)
      .where(
        and(
          eq(schema.agentInbox.loopId, loop.id),
          eq(schema.agentInbox.status, "pending")
        )
      )
      .limit(1),
    db
      .select({ id: schema.agentRun.id })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.loopId, loop.id),
          inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
        )
      )
      .limit(1),
    loop.creatorId
      ? db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, loop.creatorId))
      : Promise.resolve([]),
  ])
  if (running) return "skipped"
  // A fire still unread gets a flush, not a second note: a lost flush must
  // not strand it.
  if (waiting) {
    await deps.agentInboxQueue.add(AGENT_INBOX_FLUSH_JOB, {
      conversationId: waiting.conversationId,
    })
    return "skipped"
  }
  // The check-in is the agent's own now (lib/agent-inbox.ts sweepCheckIns):
  // a check-in Loop left from before does nothing.
  if (loop.kind === "check_in") return "skipped"
  const own = await ownConversation({
    workspaceId: loop.workspaceId,
    agentId: loop.agentId,
  })
  const conversationId = await addInboxNote({
    workspaceId: loop.workspaceId,
    channelId: loopChannelId,
    conversationId: own.id,
    source: "loop",
    sourceId: loopFireSourceId(loop.id, scheduledFor),
    loopId: loop.id,
    lane: "wake",
    note: loopInboxNote({
      loopId: loop.id,
      name: loop.name,
      scheduleDescription: describeLoopSchedule(loop.schedule, loop.timezone),
      instructions: loop.instructions,
      endCondition: loop.endCondition,
      setUpBy: creator?.name ?? null,
      hasChat: loop.channelId !== null,
    }),
  })
  if (!conversationId) return "skipped"
  await deps.agentInboxQueue.add(AGENT_INBOX_FLUSH_JOB, { conversationId })
  return "queued"
}

// One fire of a loop outside a text channel is one turn in its session
// (reference/workspace-model.md, decision 1): a "ran on schedule" line, then
// Lor's reply under it, through the same run path as a person's message. A
// person's turn holding the session makes the fire wait in its queue; the
// loop's own previous run still going skips the fire. A fire unarchives the
// session.
export async function fireLoop(
  deps: LoopDeps & {
    respondQueue: Queue<LorRespondJobData>
    agentInboxQueue: Queue<AgentQueueData>
  },
  loop: Loop,
  scheduledFor: Date
): Promise<FireOutcome> {
  if ((await workspaceBetaAccess(loop.workspaceId)).state !== "active")
    return "skipped"
  // No chat, or a text chat: the Loop's agent runs it.
  const channelId = loop.channelId
  if (!channelId) return fireLoopToInbox(deps, loop, scheduledFor)
  const [channel] = await db
    .select({ type: schema.channel.type })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (channel?.type === "text") return fireLoopToInbox(deps, loop, scheduledFor)
  const session = await ensureLoopSession({ ...loop, channelId })
  deps.emitter
    .to(channelRoom(channelId))
    .emit("session:updated", { session: toRealtimeAgentSession(session) })
  notifyWorkspaceActivity(loop.workspaceId)
  const scopeKey = session.threadRootId

  const activeRun = () =>
    db
      .select({ id: schema.agentRun.id, loopId: schema.agentRun.loopId })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.scopeKey, scopeKey),
          inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

  let active = await activeRun()
  if (active?.loopId === loop.id) return "skipped"

  const { messageId: fireId } = await postLorMessage(deps, {
    channelId,
    threadRootId: scopeKey,
    content: channelEventContent({
      eventType: "loop_run",
      loopName: loop.name,
    }),
    type: "event",
    eventType: "loop_run",
    eventPayload: { loopId: loop.id, loopName: loop.name },
    silent: true,
  })
  const start = () =>
    startScopeRun(deps, {
      workspaceId: loop.workspaceId,
      channelId,
      threadRootId: scopeKey,
      scopeKey,
      triggerMessageId: fireId,
      loopId: loop.id,
      scheduledFor,
    })

  // Two tries cover a run starting or ending between the read and the write.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!active) {
      const started = await start()
      if (started !== "busy") return started
      active = await activeRun()
      continue
    }
    const queuedId = await db
      .insert(schema.agentRunQueue)
      .values({
        scopeKey,
        runId: active.id,
        messageId: fireId,
        senderId: LOR_USER_ID,
        state: "queued",
      })
      .onConflictDoNothing({ target: schema.agentRunQueue.messageId })
      .returning({ id: schema.agentRunQueue.id })
      .then((rows) => rows[0]?.id ?? null)
    if (!queuedId) return "queued"
    // The holder may have settled (and drained) before the row landed.
    const stillActive = await activeRun()
    if (stillActive?.id === active.id) return "queued"
    await db
      .delete(schema.agentRunQueue)
      .where(
        and(
          eq(schema.agentRunQueue.id, queuedId),
          eq(schema.agentRunQueue.state, "queued")
        )
      )
    active = stillActive
  }
  logger.warn({ loopId: loop.id }, "Loop fire could not start or queue")
  return "failed"
}

// The loop behind a run in a loop's session, and whether this run answers
// one of its fires (its trigger is the "ran on schedule" line).
export async function loadLoopRun(
  threadRootId: string | null,
  triggerMessageId: string
): Promise<{ loop: Loop; isFire: boolean } | null> {
  if (!threadRootId) return null
  const session = await findAgentSessionByThreadRoot(threadRootId)
  if (!session?.loopId) return null
  const [loop, trigger] = await Promise.all([
    db
      .select()
      .from(schema.loop)
      .where(eq(schema.loop.id, session.loopId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ eventType: schema.message.eventType })
      .from(schema.message)
      .where(eq(schema.message.id, triggerMessageId))
      .then((rows) => rows[0] ?? null),
  ])
  if (!loop) return null
  return { loop, isFire: trigger?.eventType === "loop_run" }
}

// A fire that waited in the session queue was started by the drain, which
// knows nothing of loops: tag the run so pause stops it and history lists it.
export async function markLoopFireRun(runId: string, loopId: string) {
  await db
    .update(schema.agentRun)
    .set({
      loopId,
      scheduledFor: sql`coalesce(${schema.agentRun.scheduledFor}, now())`,
    })
    .where(and(eq(schema.agentRun.id, runId), isNull(schema.agentRun.loopId)))
}

// complete_loop's effect: the Loop ends, and in its session a line says so.
// In the channel's chat (null) no line: the card shows the Loop completed and
// the agent says what it stopped in its own words, so nothing shows a Loop
// driving it (reference/always-on-agents.md, decision 30).
async function completeLoopByLor(
  deps: LoopDeps,
  loopId: string,
  closingNote: string,
  threadRootId: string | null,
  // The end condition the run judged.
  endCondition: string
): Promise<void> {
  const completed = await db
    .update(schema.loop)
    .set({
      status: "completed",
      completedNote: closingNote,
      pausedReason: null,
      nextRunAt: null,
    })
    // An end condition someone cleared or edited meanwhile no longer lets it
    // end.
    .where(
      and(
        eq(schema.loop.id, loopId),
        eq(schema.loop.status, "active"),
        eq(schema.loop.endCondition, endCondition)
      )
    )
    .returning()
    .then((rows) => rows[0] ?? null)
  // Paused/completed since this run started — the tool must not report
  // success for a transition that didn't happen.
  if (!completed) {
    throw new Error("Loop is no longer active or its end condition changed")
  }
  logger.info({ loopId }, "Loop completed by complete_loop")
  emitLoopUpdated(deps.emitter, completed)
  if (!threadRootId || !completed.channelId) return
  await postLorMessage(deps, {
    channelId: completed.channelId,
    threadRootId,
    content: channelEventContent({
      eventType: "loop_completed",
      actorName: "Lor",
      loopName: completed.name,
    }),
    type: "event",
    eventType: "loop_completed",
    eventPayload: { loopId: completed.id, loopName: completed.name },
    silent: true,
  }).catch((err) => logger.error({ err, loopId }, "Loop completed note failed"))
}

// An agent's complete_loop: any Loop of its own that has an end condition to
// judge. Date and manual ends are mechanical.
export function agentCompleteLoop(
  deps: LoopDeps,
  agentId: string
): CompleteAgentLoop {
  // The end conditions as the turn starts: what the agent judges. An edit
  // during the turn makes complete_loop refuse.
  const judged = db
    .select({ id: schema.loop.id, endCondition: schema.loop.endCondition })
    .from(schema.loop)
    .where(eq(schema.loop.agentId, agentId))
    .then(
      (rows) => new Map(rows.map((row) => [row.id, row.endCondition])),
      (err: unknown) => {
        logger.warn({ err, agentId }, "Loop end condition snapshot failed")
        return null
      }
    )
  return async ({ loopId, closingNote }) => {
    const [loop] = await db
      .select({
        status: schema.loop.status,
        endCondition: schema.loop.endCondition,
      })
      .from(schema.loop)
      .where(and(eq(schema.loop.id, loopId), eq(schema.loop.agentId, agentId)))
    if (!loop) {
      return { ok: false, error: "You have no Loop with that id" }
    }
    if (!loop.endCondition) {
      return {
        ok: false,
        error: "This Loop has no end condition to judge. The team ends it.",
      }
    }
    if (loop.status !== "active") {
      return { ok: false, error: `This Loop is ${loop.status}, not active` }
    }
    const conditions = await judged
    // Without the snapshot the judged condition is unknown: the Loop stays
    // active for a later turn.
    if (!conditions) {
      return {
        ok: false,
        error:
          "Couldn't confirm the end condition this turn judged. Judge it again on the Loop's next run.",
      }
    }
    const endCondition = conditions.get(loopId) ?? null
    if (endCondition !== loop.endCondition) {
      return {
        ok: false,
        error:
          "This Loop's end condition changed during this turn. Judge the new one on its next run.",
      }
    }
    try {
      await completeLoopByLor(deps, loopId, closingNote, null, endCondition)
      return { ok: true }
    } catch {
      return { ok: false, error: "Failed to complete the Loop" }
    }
  }
}

// The loop's brief for every run in its session. complete_loop only exists
// when there is an end condition to judge: date and manual ends are
// mechanical, and one live loop got wrongly completed without one.
export function loopRunContext(
  deps: LoopDeps,
  loop: Loop,
  threadRootId: string
): RunLoopContext {
  const endCondition = loop.endCondition
  return {
    name: loop.name,
    scheduleDescription: describeLoopSchedule(loop.schedule, loop.timezone),
    instructions: loop.instructions,
    endCondition,
    ...(endCondition
      ? {
          completeLoop: ({ closingNote }) =>
            completeLoopByLor(
              deps,
              loop.id,
              closingNote,
              threadRootId,
              endCondition
            ),
        }
      : {}),
  }
}

// Failure accounting at fire settlement. `stopped` (pause, user stop) says
// nothing about the loop's health. Enough failures in a row pause the loop
// and say so in its session, or (null) in the channel's chat.
export async function settleLoopRun(
  deps: LoopDeps,
  loopId: string,
  threadRootId: string | null,
  settlement: {
    outcome: "complete" | "failed" | "stopped"
    stopReason?: string
  }
): Promise<void> {
  if (settlement.outcome === "stopped") return

  if (settlement.outcome === "complete") {
    const row = await db
      .update(schema.loop)
      .set({ consecutiveFailures: 0 })
      .where(
        and(
          eq(schema.loop.id, loopId),
          sql`${schema.loop.consecutiveFailures} <> 0`
        )
      )
      .returning()
      .then((rows) => rows[0] ?? null)
    // Emitted either way: it is what refreshes the run history people have
    // open.
    const current =
      row ??
      (await db
        .select()
        .from(schema.loop)
        .where(eq(schema.loop.id, loopId))
        .then((rows) => rows[0] ?? null))
    if (current) emitLoopUpdated(deps.emitter, current)
    return
  }

  // Only active loops accrue failures — a loop paused/completed mid-run
  // (kill switch raced) must not be re-touched.
  const failed = await db
    .update(schema.loop)
    .set({ consecutiveFailures: sql`${schema.loop.consecutiveFailures} + 1` })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!failed) return
  if (failed.consecutiveFailures < LOOP_AUTO_PAUSE_FAILURES) {
    emitLoopUpdated(deps.emitter, failed)
    return
  }

  const reason =
    settlement.stopReason === "out_of_credits" ? "out_of_credits" : "failures"
  const paused = await db
    .update(schema.loop)
    .set({ status: "paused", pausedReason: reason, nextRunAt: null })
    .where(and(eq(schema.loop.id, loopId), eq(schema.loop.status, "active")))
    .returning()
    .then((rows) => rows[0] ?? null)
  if (!paused) return

  logger.warn(
    { loopId, failures: paused.consecutiveFailures },
    "Loop auto-paused after consecutive failures"
  )
  emitLoopUpdated(deps.emitter, paused)
  // A Loop with no chat has nowhere to say so: its panel shows the reason.
  if (!paused.channelId) return
  await postLorMessage(deps, {
    channelId: paused.channelId,
    ...(threadRootId ? { threadRootId } : {}),
    content: channelEventContent({
      eventType: "loop_paused",
      loopName: paused.name,
      reason,
    }),
    type: "event",
    eventType: "loop_paused",
    eventPayload: { loopId: paused.id, loopName: paused.name, reason },
    silent: true,
  }).catch((err) =>
    logger.error({ err, loopId }, "Loop auto-pause session note failed")
  )
}
