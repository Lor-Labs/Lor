import { and, db, eq, schema, sql } from "@repo/db"
import type { HarnessCommandList } from "@repo/db/schema"
import { toRealtimeAgentSession } from "@repo/lor/agent-sessions"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"

// The session's "/" and "$" menus follow its harness's last turn
// (reference/skills-and-commands.md). Written only when the list changed, so
// most turns send nothing.
export async function saveSessionCommands(input: {
  emitter: Emitter<ServerToClientEvents>
  sessionId: string
  list: HarnessCommandList
}) {
  const json = JSON.stringify(input.list)
  const updated = await db
    .update(schema.agentSession)
    .set({ harnessCommands: input.list })
    .where(
      and(
        eq(schema.agentSession.id, input.sessionId),
        sql`${schema.agentSession.harnessCommands} is distinct from ${json}::jsonb`
      )
    )
    .returning()
    .then((rows) => rows[0])
  if (!updated) return
  input.emitter
    .to(channelRoom(updated.channelId))
    .emit("session:updated", { session: toRealtimeAgentSession(updated) })
}
