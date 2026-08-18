import { db, desc, inArray } from "@repo/db"
import { agentRun } from "@repo/db/schema"

// "Merlin's last run" for Act-enabled triggers: the newest agent_run per
// trigger, with the handoff note it left. Shared by the webhook and
// integration-event surfaces, which both list many triggers at once.
// See reference/automation-primitives.md §5.
export type LastAct = {
  note: string | null
  state: string
  stopReason: string | null
  at: string
}

// One DISTINCT ON instead of a query per trigger.
export async function lastActByTrigger(
  triggerIds: string[]
): Promise<Map<string, LastAct>> {
  const byTrigger = new Map<string, LastAct>()
  if (triggerIds.length === 0) return byTrigger
  const rows = await db
    .selectDistinctOn([agentRun.triggerId], {
      triggerId: agentRun.triggerId,
      note: agentRun.handoffNote,
      state: agentRun.state,
      stopReason: agentRun.stopReason,
      createdAt: agentRun.createdAt,
    })
    .from(agentRun)
    .where(inArray(agentRun.triggerId, triggerIds))
    .orderBy(agentRun.triggerId, desc(agentRun.createdAt))
  for (const row of rows) {
    if (!row.triggerId) continue
    byTrigger.set(row.triggerId, {
      note: row.note,
      state: row.state,
      stopReason: row.stopReason,
      at: row.createdAt.toISOString(),
    })
  }
  return byTrigger
}
