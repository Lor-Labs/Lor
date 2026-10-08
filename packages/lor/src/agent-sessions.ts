import type { AgentSession } from "@repo/db/schema"
import type { RealtimeAgentSession } from "@repo/realtime-types/events"
import type { Exact, SerializedDates } from "./wire-guard"

const _realtimeAgentSessionMirrorsDbRow: Exact<
  SerializedDates<AgentSession>,
  RealtimeAgentSession
> = true
void _realtimeAgentSessionMirrorsDbRow

export function toRealtimeAgentSession(
  row: AgentSession
): RealtimeAgentSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    threadRootId: row.threadRootId,
    creatorId: row.creatorId,
    origin: row.origin,
    title: row.title,
    titleEditedAt: row.titleEditedAt?.toISOString() ?? null,
    loopId: row.loopId,
    triggerId: row.triggerId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedById: row.archivedById,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
