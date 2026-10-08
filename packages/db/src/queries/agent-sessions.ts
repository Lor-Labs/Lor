import { and, eq, isNull, ne } from "drizzle-orm"
import { db } from "../index"
import { agentSession } from "../schemas/agent-sessions"
import { message } from "../schemas/messages"

// The channel chat feed: top-level messages minus Lor session anchors, which
// are blank thread roots that never show in chat.
export function chatFeedMessage() {
  return and(isNull(message.threadRootId), ne(message.type, "agent_session"))
}

// Whether a thread is a Lor session. Looks up the row instead of the root's
// message type: backfilled legacy sessions have ordinary chat roots.
export async function findAgentSessionByThreadRoot(threadRootId: string) {
  const [row] = await db
    .select({ id: agentSession.id, archivedAt: agentSession.archivedAt })
    .from(agentSession)
    .where(eq(agentSession.threadRootId, threadRootId))
    .limit(1)
  return row ?? null
}
