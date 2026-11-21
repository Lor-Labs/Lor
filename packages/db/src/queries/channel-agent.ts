import { db, eq, schema } from "../index"

// A channel agent's turn is a run with steps (reference/always-on-agents.md
// §4). Its approvals continue through the agent's inbox, not a session run.
export async function isChannelAgentRun(runId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.agentStep.id })
    .from(schema.agentStep)
    .where(eq(schema.agentStep.runId, runId))
    .limit(1)
  return Boolean(row)
}
