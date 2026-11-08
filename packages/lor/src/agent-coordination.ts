import {
  and,
  arrayOverlaps,
  db,
  desc,
  eq,
  gt,
  isNull,
  ne,
  schema,
} from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { logger } from "./logger"
import { privateAudienceFilter, userDisplayName } from "./retrieval"
import { sanitizeInlineLabel } from "./transcript"

// The shared coordination log (agent_coordination_entry): before a code
// session's agent changes files it announces what it is about to change, and
// hears about other sessions already on those files, before any edit rather
// than after. Overlap notes are logged too. People read the log in the
// session's Details panel. reference/agent-coordination.md

const RECENT_INTENT_MS = 24 * 60 * 60_000
const IDLE_CUTOFF_MS = 7 * 24 * 60 * 60_000
const MAX_PATHS = 50
const MAX_SUMMARY_CHARS = 500
const MAX_OTHERS = 10

type CoordinationScope = {
  workspaceId: string
  repoFullName: string
  sessionId: string
}

// Best-effort: a log write never fails or slows the agent's turn.
export async function recordCoordination(
  scope: CoordinationScope,
  entry: {
    kind: "intent" | "overlap"
    paths: string[]
    summary: string
    otherSessionId?: string | null
  }
) {
  try {
    await db.insert(schema.agentCoordinationEntry).values({
      workspaceId: scope.workspaceId,
      repoFullName: scope.repoFullName,
      sessionId: scope.sessionId,
      kind: entry.kind,
      paths: entry.paths.slice(0, MAX_PATHS),
      summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
      otherSessionId: entry.otherSessionId ?? null,
    })
  } catch (err) {
    logger.warn(
      { err, sessionId: scope.sessionId },
      "Coordination log write failed"
    )
  }
}

type OtherSession = {
  sessionId: string
  title: string
  owner: string | null
  // Their uncommitted edits to the announced paths.
  editing: string[]
  // What they last said they were about to change there, in the past day.
  announced: { paths: string[]; summary: string; at: string } | null
}

// Other sessions on the same repo already editing, or about to edit, any of
// these paths. Only sessions this run may read count.
async function sessionsOnPaths(
  scope: CoordinationScope & { privateContainerChannelId: string | null },
  paths: string[]
): Promise<OtherSession[]> {
  const other = schema.agentSession
  const visible = and(
    eq(other.workspaceId, scope.workspaceId),
    eq(other.repoFullName, scope.repoFullName),
    isNull(other.archivedAt),
    ne(other.id, scope.sessionId),
    gt(other.updatedAt, new Date(Date.now() - IDLE_CUTOFF_MS)),
    privateAudienceFilter(scope.privateContainerChannelId)
  )
  const [editing, announced] = await Promise.all([
    db
      .select({
        sessionId: other.id,
        title: other.title,
        owner: schema.user.name,
        paths: other.uncommittedPaths,
      })
      .from(other)
      .innerJoin(schema.channel, eq(schema.channel.id, other.channelId))
      .leftJoin(schema.user, eq(schema.user.id, other.creatorId))
      .where(and(visible, arrayOverlaps(other.uncommittedPaths, paths)))
      .limit(MAX_OTHERS),
    db
      .select({
        sessionId: other.id,
        title: other.title,
        owner: schema.user.name,
        paths: schema.agentCoordinationEntry.paths,
        summary: schema.agentCoordinationEntry.summary,
        at: schema.agentCoordinationEntry.createdAt,
      })
      .from(schema.agentCoordinationEntry)
      .innerJoin(other, eq(other.id, schema.agentCoordinationEntry.sessionId))
      .innerJoin(schema.channel, eq(schema.channel.id, other.channelId))
      .leftJoin(schema.user, eq(schema.user.id, other.creatorId))
      .where(
        and(
          visible,
          eq(schema.agentCoordinationEntry.kind, "intent"),
          gt(
            schema.agentCoordinationEntry.createdAt,
            new Date(Date.now() - RECENT_INTENT_MS)
          ),
          arrayOverlaps(schema.agentCoordinationEntry.paths, paths)
        )
      )
      .orderBy(desc(schema.agentCoordinationEntry.createdAt))
      .limit(MAX_OTHERS * 3),
  ])

  const wanted = new Set(paths)
  const byId = new Map<string, OtherSession>()
  const entryFor = (row: {
    sessionId: string
    title: string
    owner: string | null
  }) => {
    const found = byId.get(row.sessionId)
    if (found) return found
    const created: OtherSession = {
      sessionId: row.sessionId,
      title: sanitizeInlineLabel(row.title),
      owner: row.owner ? userDisplayName({ name: row.owner }) : null,
      editing: [],
      announced: null,
    }
    byId.set(row.sessionId, created)
    return created
  }
  for (const row of editing) {
    entryFor(row).editing = (row.paths ?? []).filter((p) => wanted.has(p))
  }
  for (const row of announced) {
    const session = entryFor(row)
    // Newest first, so the first one seen is the latest.
    session.announced ??= {
      paths: row.paths.filter((p) => wanted.has(p)),
      summary: row.summary,
      at: row.at.toISOString(),
    }
  }
  return [...byId.values()].slice(0, MAX_OTHERS)
}

const coordinationContext = z.object({
  workspaceId: z.string(),
  threadRootId: z.string(),
  repoFullName: z.string(),
  privateContainerChannelId: z.string().nullable().optional(),
})

export const coordinationTool = {
  announce_changes: tool({
    description:
      "Before you change files in this code session, announce which files you are about to change and why. The announcement goes into the repository's shared coordination log, which the people in every session can read and nobody can edit. The result lists other sessions already editing those files or that announced changes to them in the past day: read their changes with read_session_changes and build on them rather than against them. Announce again when your plan moves to other files.",
    inputSchema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(MAX_PATHS)
        .describe("repo-relative paths you are about to change"),
      summary: z
        .string()
        .min(1)
        .max(MAX_SUMMARY_CHARS)
        .describe(
          "one or two plain sentences: what you are about to change and why"
        ),
    }),
    contextSchema: coordinationContext,
    execute: async ({ paths, summary }, { context }) => {
      const [session] = await db
        .select({ id: schema.agentSession.id })
        .from(schema.agentSession)
        .where(
          and(
            eq(schema.agentSession.threadRootId, context.threadRootId),
            eq(schema.agentSession.workspaceId, context.workspaceId)
          )
        )
        .catch(() => [])
      if (!session) return { error: "this session can't be found" }
      const scope = {
        workspaceId: context.workspaceId,
        repoFullName: context.repoFullName,
        sessionId: session.id,
        privateContainerChannelId: context.privateContainerChannelId ?? null,
      }
      await recordCoordination(scope, { kind: "intent", paths, summary })
      const others = await sessionsOnPaths(scope, paths).catch(
        (err: unknown) => {
          logger.warn(
            { err, sessionId: session.id },
            "Coordination read failed"
          )
          return []
        }
      )
      return { announced: true, otherSessions: others }
    },
    strict: true,
  }),
}
