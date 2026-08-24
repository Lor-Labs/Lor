import type { schema } from "@repo/db"
import type { RealtimeLoop } from "@repo/realtime-types/events"
import type { Exact, SerializedDates } from "./wire-guard"

// The single loop-row → wire-type mapping. Every loop:updated emit goes
// through this, so the event payload can't drift per call site.
type LoopRow = typeof schema.loop.$inferSelect

// Drift guard (see wire-guard.ts) — RealtimeLoop must stay the exact
// date-serialized mirror of the loop row, minus deliberate omissions.
type OffWireLoopColumns =
  // Consent audit trail — server-side concern, no card renders it.
  "highFrequencyConfirmedAt" | "highFrequencyConfirmedBy"
const _realtimeLoopMirrorsDbRow: Exact<
  Omit<SerializedDates<LoopRow>, OffWireLoopColumns>,
  RealtimeLoop
> = true
void _realtimeLoopMirrorsDbRow

export function toRealtimeLoop(row: LoopRow): RealtimeLoop {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    cardMessageId: row.cardMessageId,
    creatorId: row.creatorId,
    name: row.name,
    instructions: row.instructions,
    schedule: row.schedule,
    timezone: row.timezone,
    endCondition: row.endCondition,
    status: row.status,
    pausedReason: row.pausedReason,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    consecutiveFailures: row.consecutiveFailures,
    completedNote: row.completedNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
