import type { UncommittedLinesUpdate } from "@repo/lor/uncommitted-lines"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { threadRoom, userRoom, workspaceRoom } from "@repo/realtime-types/rooms"
import type { Emitter } from "@socket.io/redis-emitter"

// Set once at worker bootstrap; run/plan lifecycle code deep in the call tree
// (run-events, agent-run, sweeps) invalidates sidebar activity without every
// signature threading the emitter through.
let emitter: Emitter<ServerToClientEvents> | null = null

export function setWorkspaceActivityEmitter(e: Emitter<ServerToClientEvents>) {
  emitter = e
}

// Best-effort sidebar invalidation after a COMMITTED run/plan state change.
// Clients refetch an authorized snapshot on receipt; there is no poll, so a
// missed emit waits for their next refocus or reconnect. A publish failure
// must never turn a committed transition into a failed job.
export function notifyWorkspaceActivity(workspaceId: string) {
  try {
    emitter
      ?.to(workspaceRoom(workspaceId))
      .emit("workspace:activity:updated", { workspaceId })
  } catch {
    // swallow: delivery is best-effort by design
  }
}

// A thread's run became terminal: open code session panels refresh their
// changes and "Lor is working" lock. Best-effort like the above.
export function notifyRunSettled(threadRootId: string) {
  try {
    emitter?.to(threadRoom(threadRootId)).emit("run:settled", { threadRootId })
  } catch {
    // swallow: delivery is best-effort by design
  }
}

// A code session's uncommitted lines changed: its sidebar rows update in
// place. Best-effort like the above.
export function notifyUncommittedLines({
  payload,
  userIds,
}: UncommittedLinesUpdate) {
  if (userIds.length === 0) return
  try {
    emitter
      ?.to(userIds.map(userRoom))
      .emit("session:uncommitted:updated", payload)
  } catch {
    // swallow: delivery is best-effort by design
  }
}
