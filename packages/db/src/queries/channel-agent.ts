import { db, eq, schema } from "../index"

// An agent's own turn is a run in one of its conversations
// (schemas/agent-conversations.ts). Its approvals continue through that
// conversation's inbox, not a session run. The conversation, or null for a
// session's run.
export async function agentRunConversation(
  runId: string
): Promise<string | null> {
  const [row] = await db
    .select({ conversationId: schema.agentRun.conversationId })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.id, runId))
  return row?.conversationId ?? null
}
