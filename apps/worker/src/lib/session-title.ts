import {
  and,
  asc,
  count,
  db,
  eq,
  isNull,
  LOR_USER_ID,
  ne,
  or,
  schema,
} from "@repo/db"
import { findAgentSessionByThreadRoot } from "@repo/db/queries/agent-sessions"
import { generateSessionTitle, type OnUsage } from "@repo/lor"
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, userRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"
import { logger } from "@/lib/logger"
import { notifyWorkspaceActivity } from "@/lib/workspace-activity"

// After Lor's first finished reply in a person-started or Act session, a
// small model names it, replacing the prompt's first line (or the event
// source). Web types the new title out. A person's rename (titleEditedAt)
// always wins, even mid-generation.
export async function titleSessionAfterFirstReply(input: {
  emitter: Emitter<ServerToClientEvents>
  threadRootId: string
  reply: string
  onUsage?: OnUsage
}) {
  const session = await findAgentSessionByThreadRoot(input.threadRootId)
  if (
    !session ||
    session.titleEditedAt ||
    session.archivedAt ||
    session.origin === "loop"
  ) {
    return
  }
  const [completed] = await db
    .select({ runs: count() })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.threadRootId, input.threadRootId),
        eq(schema.agentRun.state, "complete")
      )
    )
  if (completed?.runs !== 1) return

  const request = await db
    .select({ content: schema.message.content })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.threadRootId, input.threadRootId),
        or(
          ne(schema.message.authorId, LOR_USER_ID),
          eq(schema.message.eventType, "trigger_run")
        )
      )
    )
    .orderBy(asc(schema.message.createdAt))
    .limit(1)
    .then((rows) => rows[0]?.content ?? "")

  const title = await generateSessionTitle(
    { workspaceId: session.workspaceId, request, reply: input.reply },
    input.onUsage
  )
  if (!title || title === session.title) return

  const updated = await db
    .update(schema.agentSession)
    .set({ title })
    .where(
      and(
        eq(schema.agentSession.id, session.id),
        isNull(schema.agentSession.titleEditedAt)
      )
    )
    .returning()
    .then((rows) => rows[0])
  if (!updated) return

  // Subscribers get it wherever they are, so the title types out in their
  // sidebar even when the session isn't open (a refetch shows it at once).
  const subscribers = await db
    .select({ userId: schema.threadSubscription.userId })
    .from(schema.threadSubscription)
    .where(eq(schema.threadSubscription.threadRootId, updated.threadRootId))
  input.emitter
    .to([
      channelRoom(updated.channelId),
      ...subscribers.map((row) => userRoom(row.userId)),
    ])
    .emit("session:updated", { session: toRealtimeAgentSession(updated) })
  notifyWorkspaceActivity(updated.workspaceId)
  logger.info({ sessionId: updated.id }, "Session titled")
}
