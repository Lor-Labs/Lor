import { and, db, eq, inArray, isNotNull, lt, schema } from "@repo/db"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import { logger } from "@/lib/logger"

export const RUN_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const RUN_EVENT_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000 // q 6 hrs
export const DEAD_RUN_SWEEP_EVERY_MS = 10 * 60 * 1000 // q 10 min
// Grace past the wall-clock deadline; an alive attempt errors out at the
// deadline itself, so anything still non-terminal this far past it is dead.
const DEAD_RUN_GRACE_MS = 10 * 60 * 1000

const DEAD_RUN_MESSAGE =
  "⚠️ I ran into an error answering that. Please try again."

// Run events are replay data for in-flight runs; once a run is terminal the
// message row holds the durable trail, so prune old terminal runs' events.
// Idempotent — safe to run from any number of worker replicas.
export async function pruneRunEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_EVENT_RETENTION_MS)
  const stale = db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        isNotNull(schema.agentRun.finishedAt),
        lt(schema.agentRun.finishedAt, cutoff)
      )
    )
  await db
    .delete(schema.agentRunEvent)
    .where(inArray(schema.agentRunEvent.runId, stale))
  logger.info("Pruned expired agent run events")
}

// Safety net for the double-crash case (initial attempt and its one recovery
// both died): nothing else will ever finalize the run or its stuck pending
// placeholder, so fail both once the run is unambiguously past its deadline.
export async function sweepDeadRuns(
  emitter: Emitter<ServerToClientEvents>
): Promise<void> {
  const cutoff = new Date(Date.now() - DEAD_RUN_GRACE_MS)
  const dead = await db
    .update(schema.agentRun)
    .set({ state: "failed", stopReason: "error", finishedAt: new Date() })
    .where(
      and(
        inArray(schema.agentRun.state, ["queued", "working", "finalizing"]),
        isNotNull(schema.agentRun.deadlineAt),
        lt(schema.agentRun.deadlineAt, cutoff)
      )
    )
    .returning({
      id: schema.agentRun.id,
      messageId: schema.agentRun.messageId,
      channelId: schema.agentRun.channelId,
      threadRootId: schema.agentRun.threadRootId,
    })
  for (const run of dead) {
    const settled = await db
      .update(schema.message)
      .set({ content: DEAD_RUN_MESSAGE, status: "failed" })
      .where(
        and(
          eq(schema.message.id, run.messageId),
          eq(schema.message.status, "pending")
        )
      )
      .returning({ id: schema.message.id })
      .then((r) => r[0])
      .catch(() => undefined)
    if (settled) {
      const room = run.threadRootId
        ? threadRoom(run.threadRootId)
        : channelRoom(run.channelId)
      emitter.to(room).emit("message:stream", {
        channelId: run.channelId,
        threadRootId: run.threadRootId,
        messageId: run.messageId,
        delta: DEAD_RUN_MESSAGE,
        done: true,
        status: "failed",
        replace: true,
      })
    }
  }
  if (dead.length > 0) {
    logger.warn(
      { count: dead.length, runIds: dead.map((r) => r.id) },
      "Swept dead agent runs past their deadline"
    )
  }
}
