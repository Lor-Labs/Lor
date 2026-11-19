import { and, db, eq, inArray, schema } from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { workspaceBetaAccess } from "@repo/db/queries/beta-access"
import { ensureAgentSession } from "@repo/lor/agent-sessions"
import {
  hasPendingWake,
  loadInboxBatch,
  markInboxRead,
} from "@repo/lor/channel-agent"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import {
  AGENT_INBOX_FLUSH_JOB,
  type AgentInboxFlushJobData,
  type LorRespondJobData,
} from "@repo/realtime-types/queues"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Queue } from "bullmq"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"
import { postLorMessage } from "@/lib/lor-messages"
import { startScopeRun } from "@/lib/run-queue"

type InboxDeps = {
  emitter: Emitter<ServerToClientEvents>
  redis: ReturnType<typeof createClient>
  respondQueue: Queue<LorRespondJobData>
}

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

export type InboxFlushOutcome =
  | "started"
  | "busy"
  | "empty"
  | "skipped"
  | "failed"

// One turn of the channel's agent for everything pending in its inbox
// (reference/always-on-agents.md §3): a wake line in the agent's
// conversation carries the batch, and Lor answers it through the same run
// path as a Loop's fire. One turn at a time: while a run is going the items
// stay pending, and the run reads the inbox again when it ends.
export async function flushAgentInbox(
  deps: InboxDeps,
  channelId: string
): Promise<InboxFlushOutcome> {
  const channel = await db
    .select({
      id: schema.channel.id,
      workspaceId: schema.channel.workspaceId,
      type: schema.channel.type,
      archivedAt: schema.channel.archivedAt,
    })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
    .then((rows) => rows[0])
  if (!channel?.workspaceId || channel.type !== "text" || channel.archivedAt) {
    return "skipped"
  }
  const workspaceId = channel.workspaceId
  if ((await workspaceBetaAccess(workspaceId)).state !== "active") {
    return "skipped"
  }

  const session = await ensureAgentSession({ id: channel.id, workspaceId })
  const scopeKey = session.threadRootId
  const active = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.scopeKey, scopeKey),
        inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (active) return "busy"
  // A turn waiting on an approval holds the conversation too: a new turn
  // would reject what it asked for. The run that follows the decision reads
  // the inbox again.
  const waiting = await db
    .select({ id: schema.approval.id })
    .from(schema.approval)
    .innerJoin(schema.agentRun, eq(schema.approval.runId, schema.agentRun.id))
    .where(
      and(
        eq(schema.agentRun.scopeKey, scopeKey),
        eq(schema.approval.status, "pending")
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (waiting) return "busy"

  const batch = await loadInboxBatch(channelId)
  if (!batch) return "empty"

  const { messageId: wakeId } = await postLorMessage(deps, {
    channelId,
    threadRootId: scopeKey,
    content: batch.text,
    type: "event",
    eventType: "agent_wake",
    eventPayload: { woke: batch.woke, unread: batch.unread },
    silent: true,
  })
  const started = await startScopeRun(deps, {
    workspaceId,
    channelId,
    threadRootId: scopeKey,
    scopeKey,
    triggerMessageId: wakeId,
  })
  if (started !== "started") {
    // Another flush took the scope first: retract this line. The items stay
    // pending for the flush that follows that run.
    await db
      .delete(schema.message)
      .where(eq(schema.message.id, wakeId))
      .catch((err) =>
        logger.error({ err, wakeId }, "Retracting an agent wake line failed")
      )
    return started
  }
  await markInboxRead(batch.itemIds, wakeId)
  return "started"
}

// When a channel agent's run ends, whatever woke it meanwhile gets its turn.
export async function flushAfterAgentRun(
  queue: Queue<AgentInboxFlushJobData>,
  args: { channelId: string; threadRootId: string | null }
): Promise<void> {
  if (!args.threadRootId) return
  const session = await findAgentSessionByThreadRoot(args.threadRootId)
  if (session?.origin !== "agent") return
  if (!(await hasPendingWake(args.channelId))) return
  await queue.add(
    AGENT_INBOX_FLUSH_JOB,
    { channelId: args.channelId },
    { removeOnComplete: true, removeOnFail: 100 }
  )
}
