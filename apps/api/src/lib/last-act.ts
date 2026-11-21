import { and, db, desc, eq, inArray } from "@repo/db"
import { agentRun, triggerDelivery } from "@repo/db/schema"

// "Lor's last run" for Act-enabled triggers: the newest agent_run per
// trigger, with the handoff note it left. Shared by the webhook and
// integration-event surfaces, which both list many triggers at once.
// See reference/automation-primitives.md §5.
export type LastAct = {
  note: string | null
  state: string
  stopReason: string | null
  at: string
}

// One DISTINCT ON instead of a query per trigger. Found through the delivery
// log: a delivery points at the run that handled it, an Act run of its own
// before channel agents and the agent's turn since
// (reference/always-on-agents.md §3).
export async function lastActByTrigger(
  triggerIds: string[],
  readableChannelIds: string[]
): Promise<Map<string, LastAct>> {
  const byTrigger = new Map<string, LastAct>()
  if (triggerIds.length === 0 || readableChannelIds.length === 0)
    return byTrigger
  const rows = await db
    .selectDistinctOn([triggerDelivery.triggerId], {
      triggerId: triggerDelivery.triggerId,
      note: agentRun.handoffNote,
      state: agentRun.state,
      stopReason: agentRun.stopReason,
      createdAt: agentRun.createdAt,
    })
    .from(triggerDelivery)
    .innerJoin(agentRun, eq(agentRun.id, triggerDelivery.runId))
    .where(
      and(
        inArray(triggerDelivery.triggerId, triggerIds),
        inArray(agentRun.channelId, readableChannelIds)
      )
    )
    .orderBy(triggerDelivery.triggerId, desc(agentRun.createdAt))
  for (const row of rows) {
    byTrigger.set(row.triggerId, {
      note: row.note,
      state: row.state,
      stopReason: row.stopReason,
      at: row.createdAt.toISOString(),
    })
  }
  return byTrigger
}
