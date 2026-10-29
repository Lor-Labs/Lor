import { randomUUID } from "node:crypto"
import { and, db, desc, eq, inArray, LOR_USER_ID, schema } from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { listChannelAudienceUserIds } from "@repo/db/queries/channel-access"
import type { ActSessionMode, AgentSession } from "@repo/db/schema"
import type { RunTriggerContext } from "@repo/lor"
import {
  actRunBriefing,
  openActWindow,
  releaseActRunDeliveries,
} from "@repo/lor/act-runs"
import { createSession, toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import { channelCodeRepo, isSafeBranch } from "@repo/lor/code-repo"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  ACT_FLUSH_JOB,
  type ActFlushJobData,
  type LorRespondJobData,
  type TriggeredRunJobData,
} from "@repo/realtime-types/queues"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { isValidNewBranchName } from "@repo/utils/github"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postLorMessage } from "@/lib/lor-messages"
import { startScopeRun } from "@/lib/run-queue"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

type ActSessionDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
  respondQueue: Queue<LorRespondJobData>
  triggeredQueue: Queue<TriggeredRunJobData | ActFlushJobData>
}

type ActSessionInput = {
  runId: string
  workspaceId: string
  channelId: string
  triggerId: string
  sessionMode: ActSessionMode
  windowSeconds: number
  // Code mode: new sessions are code sessions on this repo.
  code: { repoFullName: string; baseBranch: string } | null
  connectedById: string | null
  label: string
  payload: string
}

// A waiting event looks again after at least this long.
const SESSION_BUSY_RETRY_SECONDS = 30

// An Act event becomes a session turn (reference/act-sessions-runbook.md):
// a new session in per_event mode, else the subject's or the trigger's
// ongoing session when one exists. Lor answers it like any session turn. The
// person who connected the source follows a new session when they can see
// the channel; Lor mentions anyone else who should know.
export async function startActSession(
  deps: ActSessionDeps,
  input: ActSessionInput
): Promise<"started" | "waiting" | "failed"> {
  const subject =
    input.sessionMode === "per_subject" ? await runSubject(input.runId) : null
  const existing = await findActSession(input, subject)
  if (existing) {
    if (await sessionBusy(existing.threadRootId)) {
      await waitForSession(deps, input, existing.threadRootId)
      return "waiting"
    }
    const session = existing.archivedAt
      ? await reviveSession(existing.id)
      : existing
    deps.emitter
      .to(channelRoom(input.channelId))
      .emit("session:updated", { session: toRealtimeAgentSession(session) })
    notifyWorkspaceActivity(input.workspaceId)
    return runEventInSession(deps, input, session)
  }

  const audience = input.connectedById
    ? await listChannelAudienceUserIds(input.channelId)
    : []
  const subscriberIds =
    input.connectedById && audience.includes(input.connectedById)
      ? [input.connectedById]
      : []
  const sessionId = randomUUID()
  const code = input.code ? await actCodeStart(input, sessionId) : null
  const session = await db.transaction((tx) =>
    createSession(tx, {
      id: sessionId,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      authorId: LOR_USER_ID,
      creatorId: null,
      origin: "trigger",
      title: input.label,
      triggerId: input.triggerId,
      triggerSubject: subject,
      ...(code?.code ? { code: code.code } : {}),
      subscriberIds,
    })
  )
  deps.emitter
    .to(channelRoom(input.channelId))
    .emit("session:updated", { session: toRealtimeAgentSession(session) })
  notifyWorkspaceActivity(input.workspaceId)
  return runEventInSession(
    deps,
    code?.note
      ? { ...input, payload: `${code.note}\n\n${input.payload}` }
      : input,
    session
  )
}

// Checked again at fire time: the channel's tools or the GitHub connection
// can change after setup. Unavailable: a chat session whose event says why,
// so the event is not lost. Each code session gets its own branch, so its
// work can become its own pull request.
async function actCodeStart(
  input: ActSessionInput,
  sessionId: string
): Promise<{
  code?: { repoFullName: string; baseBranch: string; newBranch: string }
  note: string | null
}> {
  if (!input.code) return { note: null }
  const allowed = await channelCodeRepo(
    input.workspaceId,
    input.channelId,
    input.code.repoFullName
  ).catch(() => null)
  if (!allowed || !isSafeBranch(input.code.baseBranch)) {
    return {
      note: `Note: this automation is set to start code sessions on ${input.code.repoFullName}, but that repository is not available for code sessions in this channel now, so this session cannot change code.`,
    }
  }
  const slug = input.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  const named = `lor/${slug || "event"}-${sessionId.slice(0, 6)}`
  return {
    code: {
      repoFullName: allowed.repo.fullName,
      baseBranch: input.code.baseBranch,
      newBranch: isValidNewBranchName(named)
        ? named
        : `lor/event-${sessionId.slice(0, 6)}`,
    },
    note: null,
  }
}

async function runEventInSession(
  deps: ActSessionDeps,
  input: ActSessionInput,
  session: AgentSession
): Promise<"started" | "waiting" | "failed"> {
  const { messageId: eventId } = await postLorMessage(deps, {
    channelId: input.channelId,
    threadRootId: session.threadRootId,
    content: input.payload,
    type: "event",
    eventType: "trigger_run",
    eventPayload: { triggerId: input.triggerId, label: input.label },
    silent: true,
  })
  const started = await startScopeRun(
    deps,
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      threadRootId: session.threadRootId,
      scopeKey: session.threadRootId,
      triggerMessageId: eventId,
      queuedRunId: input.runId,
    },
    {
      // The unwind deletes the run; its deliveries go back to the queue.
      onUnwind: async () => {
        await releaseActRunDeliveries(input.runId).catch(() => {})
      },
    }
  )
  if (started === "busy") {
    // A person's run started after the busy check: retract the event line.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, eventId))
      .catch(() => {})
    deps.emitter.to(threadRoom(session.threadRootId)).emit("message:deleted", {
      channelId: input.channelId,
      messageId: eventId,
    })
    await waitForSession(deps, input, session.threadRootId)
    return "waiting"
  }
  if (started !== "started") {
    logger.warn(
      { runId: input.runId, sessionId: session.id, started },
      "Act session run did not start"
    )
    return "failed"
  }
  deps.emitter
    .to(threadRoom(session.threadRootId))
    .emit("session:act-waiting", {
      channelId: input.channelId,
      threadRootId: session.threadRootId,
    })
  return "started"
}

// A per_subject flush claims one subject's deliveries, so any one tells.
async function runSubject(runId: string): Promise<string | null> {
  const [row] = await db
    .select({ subject: schema.triggerDelivery.subject })
    .from(schema.triggerDelivery)
    .where(eq(schema.triggerDelivery.runId, runId))
    .limit(1)
  return row?.subject ?? null
}

async function findActSession(
  input: ActSessionInput,
  subject: string | null
): Promise<AgentSession | null> {
  if (input.sessionMode === "per_event") return null
  if (input.sessionMode === "per_subject" && !subject) return null
  const [row] = await db
    .select()
    .from(schema.agentSession)
    .where(
      and(
        eq(schema.agentSession.triggerId, input.triggerId),
        subject ? eq(schema.agentSession.triggerSubject, subject) : undefined
      )
    )
    .orderBy(desc(schema.agentSession.createdAt))
    .limit(1)
  return row ?? null
}

// People go first: a run going or a person's message waiting in the queue.
async function sessionBusy(threadRootId: string): Promise<boolean> {
  const [run] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, threadRootId),
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
      )
    )
    .limit(1)
  if (run) return true
  const [queued] = await db
    .select({ id: schema.agentRunQueue.id })
    .from(schema.agentRunQueue)
    .where(
      and(
        eq(schema.agentRunQueue.scopeKey, threadRootId),
        inArray(schema.agentRunQueue.state, ["queued", "steered"])
      )
    )
    .limit(1)
  return Boolean(queued)
}

// Archive only dismisses a trigger's session, as for Loops.
async function reviveSession(sessionId: string): Promise<AgentSession> {
  const [row] = await db
    .update(schema.agentSession)
    .set({ archivedAt: null, archivedById: null })
    .where(eq(schema.agentSession.id, sessionId))
    .returning()
  if (!row) throw new Error("Act session disappeared")
  return row
}

// The event waits in the trigger's queue: its deliveries are released, the
// run is removed (it never counts against the caps) and a flush looks again.
async function waitForSession(
  deps: ActSessionDeps,
  input: ActSessionInput,
  threadRootId: string
) {
  await releaseActRunDeliveries(input.runId)
  await db
    .delete(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.id, input.runId),
        eq(schema.agentRun.state, "queued")
      )
    )
  notifyWorkspaceActivity(input.workspaceId)
  // The session shows "N events waiting".
  deps.emitter
    .to(threadRoom(threadRootId))
    .emit("session:act-waiting", { channelId: input.channelId, threadRootId })
  const delaySeconds = Math.max(input.windowSeconds, SESSION_BUSY_RETRY_SECONDS)
  // Null: a window is open, and its flush picks the deliveries up.
  if (!(await openActWindow(input.triggerId, delaySeconds))) return
  try {
    await deps.triggeredQueue.add(
      ACT_FLUSH_JOB,
      { triggerId: input.triggerId },
      {
        delay: delaySeconds * 1000,
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        removeOnComplete: true,
      }
    )
  } catch (err) {
    // The window stays open: its deliveries were released and may get no new
    // delivery to re-arm them, so the overdue-window sweep re-arms it instead.
    logger.error(
      { err, triggerId: input.triggerId },
      "Act wait re-arm failed; the overdue-window sweep re-arms it"
    )
  }
}

// The trigger behind a run in an Act session, and whether this run answers
// the event (its trigger message is the session's trigger_run line).
export async function loadTriggerRun(
  threadRootId: string | null,
  triggerMessageId: string
): Promise<{
  triggerId: string
  context: RunTriggerContext
  isEvent: boolean
} | null> {
  if (!threadRootId) return null
  const session = await findAgentSessionByThreadRoot(threadRootId)
  if (!session?.triggerId) return null
  const [trigger, message] = await Promise.all([
    db
      .select({ actInstructions: schema.connectorTrigger.actInstructions })
      .from(schema.connectorTrigger)
      .where(eq(schema.connectorTrigger.id, session.triggerId))
      .then((rows) => rows[0] ?? null),
    db
      .select({ eventType: schema.message.eventType })
      .from(schema.message)
      .where(eq(schema.message.id, triggerMessageId))
      .then((rows) => rows[0] ?? null),
  ])
  if (!trigger) return null
  return {
    triggerId: session.triggerId,
    context: { instructions: trigger.actInstructions ?? "" },
    isEvent: message?.eventType === "trigger_run",
  }
}

// The event turn carries what earlier runs on the trigger concluded. It rides
// the turn, not the system prompt, so the session's later runs replay it
// unchanged from the run's saved context.
export async function briefActEvent<
  T extends { messageId: string; content: string },
>(
  turns: T[],
  input: {
    triggerId: string
    channelId: string
    runId: string
    eventMessageId: string
  }
): Promise<T[]> {
  const briefing = await actRunBriefing(input).catch((err) => {
    logger.warn({ err, runId: input.runId }, "Act briefing failed")
    return null
  })
  if (!briefing) return turns
  return turns.map((turn) =>
    turn.messageId === input.eventMessageId
      ? { ...turn, content: `${turn.content}\n\n${briefing}` }
      : turn
  )
}
