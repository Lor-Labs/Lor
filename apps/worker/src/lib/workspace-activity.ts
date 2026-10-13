import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { workspaceRoom } from "@repo/realtime-types/rooms"
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
