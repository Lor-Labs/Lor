import { and, db, eq, inArray, schema, sql } from "@repo/db"
import { AGENT_RUN_STOP_CHANNEL } from "@repo/realtime-types/queues"
import { getRedisClient } from "@/lib/redis"

const { agentRun } = schema

// Stops a cancelled voice request's run. A run no worker has claimed yet
// settles here; a working one is flagged and its worker signalled, like a
// stop from chat. Voice runs have no placeholder message to settle.
export async function stopVoiceRun(runId: string, userId: string) {
  const now = new Date()
  const [settled] = await db
    .update(agentRun)
    .set({
      state: "stopped",
      stopReason: "stopped_by_user",
      stopRequestedAt: now,
      stopRequestedBy: userId,
      finishedAt: now,
    })
    .where(and(eq(agentRun.id, runId), eq(agentRun.state, "queued")))
    .returning({ id: agentRun.id })
  if (settled) return

  const [flagged] = await db
    .update(agentRun)
    .set({
      stopRequestedAt: sql`coalesce(${agentRun.stopRequestedAt}, now())`,
      stopRequestedBy: userId,
    })
    .where(
      and(
        eq(agentRun.id, runId),
        inArray(agentRun.state, ["working", "finalizing"])
      )
    )
    .returning({ id: agentRun.id })
  if (!flagged) return
  // Best effort: the flag is the durable fallback.
  await getRedisClient()
    .then((redis) => redis.publish(AGENT_RUN_STOP_CHANNEL, runId))
    .catch(() => {})
}
