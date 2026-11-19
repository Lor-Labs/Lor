import { and, eq, isNull, ne, notExists, or } from "drizzle-orm"
import { LOR_USER_ID } from "../constants"
import { db } from "../index"
import { agentSession } from "../schemas/agent-sessions"
import { message } from "../schemas/messages"

// The channel chat feed: top-level messages people wrote (plus event feeds
// they set up). Of Lor's own, only what the channel agent sent with
// send_message and the sessions it started show
// (reference/always-on-agents.md): its old posts
// and cards stay hidden, and so does every session root, blank anchors and
// old Lor threads the backfill turned into sessions alike. Hidden, never
// deleted: deleting a message cascades its runs and their history.
export function chatFeedMessage() {
  return and(
    isNull(message.threadRootId),
    ne(message.type, "agent_session"),
    or(
      ne(message.authorId, LOR_USER_ID),
      eq(message.type, "agent_post"),
      eq(message.eventType, "agent_session_started")
    ),
    notExists(
      db
        .select({ id: agentSession.id })
        .from(agentSession)
        .where(eq(agentSession.threadRootId, message.id))
    )
  )
}

// Whether a thread is a Lor session. Looks up the row instead of the root's
// message type: backfilled legacy sessions have ordinary chat roots.
export async function findAgentSessionByThreadRoot(threadRootId: string) {
  const [row] = await db
    .select()
    .from(agentSession)
    .where(eq(agentSession.threadRootId, threadRootId))
    .limit(1)
  return row ?? null
}
