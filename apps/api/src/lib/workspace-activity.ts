import type { UncommittedLinesUpdate } from "@repo/lor/uncommitted-lines"
import { userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
import { getEmitter } from "@/lib/bot-messages"
import { logger } from "@/lib/logger"

// Best-effort sidebar invalidation after a COMMITTED run/plan state change.
// Clients refetch an authorized snapshot on receipt; there is no poll, so a
// failed publish waits for their next refocus or reconnect. It must never
// fail the caller.
export function notifyWorkspaceActivity(workspaceId: string) {
  void getEmitter()
    .then((io) =>
      io
        .to(workspaceRoom(workspaceId))
        .emit("workspace:activity:updated", { workspaceId })
    )
    .catch((err) =>
      logger.warn({ err, workspaceId }, "Workspace activity notify failed")
    )
}

// A code session's uncommitted lines changed: its sidebar rows update in
// place. Best-effort like the above.
export function notifyUncommittedLines({
  payload,
  userIds,
}: UncommittedLinesUpdate) {
  if (userIds.length === 0) return
  void getEmitter()
    .then((io) =>
      io.to(userIds.map(userRoom)).emit("session:uncommitted:updated", payload)
    )
    .catch((err) =>
      logger.warn(
        { err, sessionId: payload.sessionId },
        "Uncommitted lines notify failed"
      )
    )
}
