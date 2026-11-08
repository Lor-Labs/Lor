import { db, schema } from "@repo/db"
import { listAccessibleChannelIds } from "@repo/db/queries/channel-access"
import type { AgentSession } from "@repo/db/schema"
import { and, arrayOverlaps, desc, eq, or } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"

// A code session's view of the shared coordination log
// (agent_coordination_entry, reference/agent-coordination.md): its own
// entries, entries that name it, and other sessions' entries on files it
// announced or is editing. Entries from sessions in channels the viewer
// can't see are left out.

const ENTRIES_MAX = 50

export type CoordinationEntry = {
  id: string
  kind: "intent" | "overlap"
  at: string
  paths: string[]
  summary: string
  own: boolean
  session: { id: string; title: string; ownerName: string | null }
  otherSession: { id: string; title: string } | null
}

export async function fetchSessionCoordination(args: {
  session: AgentSession
  userId: string
}): Promise<CoordinationEntry[]> {
  const { session } = args
  if (!session.repoFullName) return []
  const entry = schema.agentCoordinationEntry

  const ownPaths = await db
    .select({ paths: entry.paths })
    .from(entry)
    .where(eq(entry.sessionId, session.id))
  const paths = [
    ...new Set([
      ...ownPaths.flatMap((row) => row.paths),
      ...(session.uncommittedPaths ?? []),
    ]),
  ]

  const author = schema.agentSession
  const other = alias(schema.agentSession, "other_session")
  const rows = await db
    .select({
      id: entry.id,
      kind: entry.kind,
      at: entry.createdAt,
      paths: entry.paths,
      summary: entry.summary,
      sessionId: author.id,
      sessionTitle: author.title,
      sessionChannelId: author.channelId,
      ownerName: schema.user.name,
      otherId: other.id,
      otherTitle: other.title,
      otherChannelId: other.channelId,
    })
    .from(entry)
    .innerJoin(author, eq(author.id, entry.sessionId))
    .leftJoin(schema.user, eq(schema.user.id, author.creatorId))
    .leftJoin(other, eq(other.id, entry.otherSessionId))
    .where(
      and(
        eq(entry.workspaceId, session.workspaceId),
        eq(entry.repoFullName, session.repoFullName),
        or(
          eq(entry.sessionId, session.id),
          eq(entry.otherSessionId, session.id),
          ...(paths.length > 0 ? [arrayOverlaps(entry.paths, paths)] : [])
        )
      )
    )
    .orderBy(desc(entry.createdAt))
    .limit(ENTRIES_MAX)
  if (rows.length === 0) return []

  const accessible = await listAccessibleChannelIds(
    args.userId,
    session.workspaceId
  )
  return rows
    .filter((row) => accessible.has(row.sessionChannelId))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      at: row.at.toISOString(),
      paths: row.paths,
      summary: row.summary,
      own: row.sessionId === session.id,
      session: {
        id: row.sessionId,
        title: row.sessionTitle,
        ownerName: row.ownerName,
      },
      otherSession:
        row.otherId &&
        row.otherTitle !== null &&
        row.otherChannelId &&
        accessible.has(row.otherChannelId)
          ? { id: row.otherId, title: row.otherTitle }
          : null,
    }))
}
