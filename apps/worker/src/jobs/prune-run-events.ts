import { and, db, inArray, isNotNull, lt, schema } from "@repo/db"
import { logger } from "@/lib/logger"

export const RUN_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const RUN_EVENT_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000 // q 6 hrs

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
