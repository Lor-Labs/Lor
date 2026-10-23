import { db, eq, schema } from "@repo/db"
import { deleteSessionSandbox } from "@repo/lor"
import type { DeleteSessionSandboxJobData } from "@repo/realtime-types/queues"

// Runs after the archive's undo window. Does nothing when the session was
// unarchived (or archived again, which queued its own job) in the meantime.
export async function deleteArchivedSessionSandbox(
  data: DeleteSessionSandboxJobData
): Promise<void> {
  const session = await db
    .select({ archivedAt: schema.agentSession.archivedAt })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, data.sessionId))
    .then((rows) => rows[0])
  if (session?.archivedAt?.getTime() !== Date.parse(data.archivedAt)) return
  await deleteSessionSandbox({ sessionId: data.sessionId })
}
