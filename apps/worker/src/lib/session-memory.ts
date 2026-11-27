import { and, db, desc, eq, gt, inArray, ne, not, or, schema } from "@repo/db"
import { channelAgentId } from "@repo/db/queries/agents"
import { sessionMemoryNote } from "@repo/lor/agent-memory"

// What a code session's turn is told of its channel's agent
// (reference/agents-and-chats.md, decision 25): the agent's facts and
// journal on the session's first turn, then what the agent noted elsewhere
// since the session's last one. Null in a channel with no agent.
export async function sessionMemory(input: {
  channelId: string
  sessionId: string
  threadRootId: string | null | undefined
  runId: string | null | undefined
  // The person this turn is for: their journal entries come first.
  people: string[]
}): Promise<{ agentId: string; note: string | null } | null> {
  const agentId = await channelAgentId(input.channelId)
  if (!agentId) return null
  const [[agent], [previous]] = await Promise.all([
    db
      .select({ name: schema.agent.name })
      .from(schema.agent)
      .where(eq(schema.agent.id, agentId)),
    input.threadRootId
      ? db
          .select({ at: schema.agentRun.createdAt })
          .from(schema.agentRun)
          .where(
            and(
              eq(schema.agentRun.scopeKey, input.threadRootId),
              input.runId ? ne(schema.agentRun.id, input.runId) : undefined,
              // Only a turn that ran: one refused at the account or credit
              // gate never sent the agent's memory.
              or(
                not(inArray(schema.agentRun.state, ["failed", "stopped"])),
                gt(schema.agentRun.steps, 0)
              )
            )
          )
          .orderBy(desc(schema.agentRun.createdAt))
          .limit(1)
      : [],
  ])
  if (!agent) return null
  return {
    agentId,
    note: await sessionMemoryNote({
      agentId,
      agentName: agent.name,
      sessionId: input.sessionId,
      since: previous?.at ?? null,
      people: input.people,
    }),
  }
}
