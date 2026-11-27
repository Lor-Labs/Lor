import { db, eq, schema, sql } from "../index"

export type RunConversation =
  | { kind: "conversation"; id: string }
  | { kind: "session" }
  // An agent's turn whose conversation was deleted with its request's root
  // message: nothing is left to continue.
  | { kind: "gone" }

// An agent's own turn is a run in one of its conversations
// (schemas/agent-conversations.ts). Its approvals continue through that
// conversation's inbox, not a session run. A turn has no placeholder
// message or thread and its scope is its conversation's id, so a turn whose
// conversation is gone (conversation_id set null) is told apart from a
// session's run.
export async function agentRunConversation(
  runId: string
): Promise<RunConversation> {
  const [row] = await db
    .select({
      conversationId: schema.agentRun.conversationId,
      scopeKey: schema.agentRun.scopeKey,
      channelId: schema.agentRun.channelId,
      messageId: schema.agentRun.messageId,
      threadRootId: schema.agentRun.threadRootId,
      triggerId: schema.agentRun.triggerId,
      loopId: schema.agentRun.loopId,
      // A voice request's run is scoped to its call.
      voice: sql<boolean>`exists (select 1 from voice_session v where v.id = ${schema.agentRun.scopeKey})`,
    })
    .from(schema.agentRun)
    .where(eq(schema.agentRun.id, runId))
  if (!row) return { kind: "session" }
  if (row.conversationId)
    return { kind: "conversation", id: row.conversationId }
  const gone =
    !row.messageId &&
    !row.threadRootId &&
    !row.triggerId &&
    row.scopeKey !== row.channelId &&
    row.scopeKey !== row.loopId &&
    !row.voice
  return gone ? { kind: "gone" } : { kind: "session" }
}
