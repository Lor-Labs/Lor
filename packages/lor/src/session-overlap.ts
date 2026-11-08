import {
  and,
  arrayOverlaps,
  db,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  schema,
  sql,
} from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { recordCoordination } from "./agent-coordination"
import { attachCodeSandbox, readChanges, readFileDiff } from "./code-changes"
import { readCheckpointChanges } from "./code-checkpoints"
import { logger } from "./logger"
import { privateAudienceFilter, userDisplayName } from "./retrieval"
import { sanitizeInlineLabel } from "./transcript"

// Overlap notes: when code sessions on the same repo have uncommitted edits to
// the same files, each session's agent is told about the other and reads its
// changes with read_session_changes, so the agents coordinate without the
// people being alerted. Paths are agent_session.uncommitted_paths
// (uncommitted-lines.ts): a commit clears them, and archived sessions and ones
// idle past a week don't count, so nothing needs purging.

const IDLE_CUTOFF_MS = 7 * 24 * 60 * 60_000
const MAX_NOTE_PATHS = 10
const MAX_LISTED_FILES = 200
const MAX_PATCH_CHARS = 40_000

export type OverlapScope = {
  sessionId: string
  workspaceId: string
  repoFullName: string
  // The run's private container: only sessions this run may read count.
  privateContainerChannelId: string | null
}

export type SessionOverlap = {
  sessionId: string
  title: string
  ownerName: string | null
  paths: string[]
}

// True the first time a session's agent is told about another session's
// edits to a path; the worker dedupes in Redis with keys that expire.
export type ClaimOverlapNotice = (key: string) => Promise<boolean>

// Best-effort, like every overlap check: a failure sends no note.
export async function findSessionOverlaps(
  scope: OverlapScope
): Promise<SessionOverlap[]> {
  try {
    const [me] = await db
      .select({
        paths: schema.agentSession.uncommittedPaths,
        sourceSessionId: schema.agentSession.sourceSessionId,
      })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, scope.sessionId))
    const mine = me?.paths ?? []
    if (!me || mine.length === 0) return []
    const other = schema.agentSession
    const rows = await db
      .select({
        sessionId: other.id,
        title: other.title,
        ownerName: schema.user.name,
        paths: other.uncommittedPaths,
      })
      .from(other)
      .innerJoin(schema.channel, eq(schema.channel.id, other.channelId))
      .leftJoin(schema.user, eq(schema.user.id, other.creatorId))
      .where(
        and(
          eq(other.workspaceId, scope.workspaceId),
          eq(other.repoFullName, scope.repoFullName),
          isNull(other.archivedAt),
          ne(other.id, scope.sessionId),
          gt(other.updatedAt, new Date(Date.now() - IDLE_CUTOFF_MS)),
          arrayOverlaps(other.uncommittedPaths, mine),
          privateAudienceFilter(scope.privateContainerChannelId),
          // A fork starts with its source's files: a session, its forks and
          // their siblings never count as overlapping.
          sql`${other.sourceSessionId} is distinct from ${scope.sessionId}`,
          ...(me.sourceSessionId
            ? [
                ne(other.id, me.sourceSessionId),
                sql`${other.sourceSessionId} is distinct from ${me.sourceSessionId}`,
              ]
            : [])
        )
      )
    const mineSet = new Set(mine)
    return rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      ownerName: row.ownerName,
      paths: (row.paths ?? []).filter((path) => mineSet.has(path)),
    }))
  } catch (err) {
    logger.warn({ err, sessionId: scope.sessionId }, "Overlap check failed")
    return []
  }
}

// One note per other session, naming only the paths this session's agent
// hasn't been told about yet. With a scope, each note also goes into the
// shared coordination log.
export async function overlapNotes(
  sessionId: string,
  overlaps: SessionOverlap[],
  claim?: ClaimOverlapNotice,
  scope?: OverlapScope | null
): Promise<string[]> {
  const notes: string[] = []
  for (const overlap of overlaps) {
    const claimed = await Promise.all(
      overlap.paths.map((path) =>
        claim
          ? claim(`${sessionId}:${overlap.sessionId}:${path}`).catch(
              (err: unknown) => {
                logger.warn({ err, sessionId }, "Overlap notice claim failed")
                return false
              }
            )
          : true
      )
    )
    const paths = overlap.paths.filter((_, i) => claimed[i])
    if (paths.length === 0) continue
    notes.push(overlapNote({ ...overlap, paths }))
    if (scope) {
      void recordCoordination(scope, {
        kind: "overlap",
        paths,
        summary: `Told about "${sanitizeInlineLabel(overlap.title)}", which also has uncommitted edits to these files.`,
        otherSessionId: overlap.sessionId,
      })
    }
  }
  return notes
}

function overlapNote({ sessionId, title, ownerName, paths }: SessionOverlap) {
  const shown = paths.slice(0, MAX_NOTE_PATHS).join(", ")
  const more = paths.length - MAX_NOTE_PATHS
  const files = more > 0 ? `${shown} and ${more} more files` : shown
  const session = ownerName
    ? `${userDisplayName({ name: ownerName })}'s session`
    : "The session"
  return `${session} "${sanitizeInlineLabel(title)}" (sessionId ${sessionId}) also has uncommitted edits to ${files}. Before you change these files, read its changes with read_session_changes and build on them rather than against them. Mention it in your reply only when both sessions' changes can't go in as they are.`
}

const sessionChangesContext = z.object({
  workspaceId: z.string(),
  privateContainerChannelId: z.string().nullable().optional(),
})

type ChangesTarget = {
  id: string
  title: string
  baseBranch: string
  uncommittedPaths: string[] | null
}

type ListedFile = {
  path: string
  oldPath: string | null
  status: string
  additions: number | null
  deletions: number | null
}

const listed = ({
  path,
  oldPath,
  status,
  additions,
  deletions,
}: ListedFile) => ({
  path,
  ...(oldPath ? { oldPath } : {}),
  status,
  additions,
  deletions,
})

const cutPatch = (patch: string) =>
  patch.length > MAX_PATCH_CHARS
    ? `${patch.slice(0, MAX_PATCH_CHARS)}\n… (cut)`
    : patch

async function turnRunning(threadRootId: string) {
  const [run] = await db
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.threadRootId, threadRootId),
        inArray(schema.agentRun.state, ["working", "finalizing"])
      )
    )
    .limit(1)
  return Boolean(run)
}

// Null when the checkpoint can't answer: storage is off, there is none, or the
// session's files changed after it (a stopped turn, the terminal), which its
// saved uncommitted paths show.
async function changesFromCheckpoint(target: ChangesTarget, path?: string) {
  const stored = await readCheckpointChanges(
    target.id,
    path ? [path] : undefined
  )
  if (!stored) return null
  const files: (ListedFile & { diff: string | null })[] = [
    ...stored.files.map((f) => ({
      path: f.path,
      oldPath: f.oldPath ?? null,
      status: f.state,
      additions: f.additions,
      deletions: f.deletions,
      diff: f.raw,
    })),
    ...stored.filteredFiles.map((f) => ({
      path: f.path,
      oldPath: f.oldPath ?? null,
      status: f.state,
      additions: null,
      deletions: null,
      diff: null,
    })),
  ]
  const storedPaths = new Set(
    files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
  )
  const live = target.uncommittedPaths ?? []
  const current = path
    ? storedPaths.has(path) === live.includes(path)
    : live.length === storedPaths.size && live.every((p) => storedPaths.has(p))
  if (!current) return null

  const asOf = stored.at.toISOString()
  if (!path) {
    return {
      title: target.title,
      branch: stored.branch,
      asOf,
      files: files.slice(0, MAX_LISTED_FILES).map(listed),
      totalFiles: files.length,
    }
  }
  const file = files.find((f) => f.path === path || f.oldPath === path)
  if (!file) {
    return { error: `${path} has no uncommitted changes in that session` }
  }
  return file.diff === null
    ? { path: file.path, asOf, diff: "binary or too large to show" }
    : {
        path: file.path,
        ...(file.oldPath ? { oldPath: file.oldPath } : {}),
        asOf,
        patch: cutPatch(file.diff),
      }
}

// Reads take no index lock, so they never block that session's own git.
async function changesFromSandbox(target: ChangesTarget, path?: string) {
  const sandbox = await attachCodeSandbox(target.id).catch(() => null)
  if (!sandbox) {
    return {
      error: "that session's sandbox is gone; its changes can't be read",
    }
  }
  try {
    const changes = await readChanges(sandbox, target.baseBranch)
    if (!path) {
      return {
        title: target.title,
        branch: changes.branch,
        files: changes.files.slice(0, MAX_LISTED_FILES).map(listed),
        totalFiles: changes.files.length,
      }
    }
    const file = changes.files.find(
      (f) => f.path === path || f.oldPath === path
    )
    if (!file) {
      return { error: `${path} has no uncommitted changes in that session` }
    }
    const diff = await readFileDiff(sandbox, file, file.status === "untracked")
    if (diff.kind !== "patch") {
      return {
        path: file.path,
        diff: diff.kind === "binary" ? "binary file" : "too large to show",
      }
    }
    return {
      path: file.path,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      patch: cutPatch(diff.patch),
    }
  } finally {
    sandbox.close()
  }
}

export const sessionChangesTool = {
  read_session_changes: tool({
    description:
      "Read another code session's uncommitted changes, as its Changes panel shows them. Without a path: its branch and changed files with line counts. With a path: that file's diff against the session's last commit. Use it when a note says another session is editing the same files as you. A session that isn't working right now is read from its last checkpoint, and asOf says when that was taken; one in the middle of a turn is read live.",
    inputSchema: z.object({
      sessionId: z.string().describe("the session's id, from an overlap note"),
      path: z
        .string()
        .optional()
        .describe("a changed file's repo-relative path, to read its diff"),
    }),
    contextSchema: sessionChangesContext,
    execute: async ({ sessionId, path }, { context }) => {
      const session = await db
        .select({
          id: schema.agentSession.id,
          title: schema.agentSession.title,
          baseBranch: schema.agentSession.baseBranch,
          threadRootId: schema.agentSession.threadRootId,
          uncommittedPaths: schema.agentSession.uncommittedPaths,
        })
        .from(schema.agentSession)
        .innerJoin(
          schema.channel,
          eq(schema.channel.id, schema.agentSession.channelId)
        )
        .where(
          and(
            eq(schema.agentSession.id, sessionId),
            eq(schema.agentSession.workspaceId, context.workspaceId),
            isNull(schema.agentSession.archivedAt),
            isNotNull(schema.agentSession.repoFullName),
            privateAudienceFilter(context.privateContainerChannelId ?? null)
          )
        )
        .then((rows) => rows[0])
        .catch(() => undefined)
      if (!session?.baseBranch) {
        return { error: "code session not found or not accessible" }
      }
      const target = { ...session, baseBranch: session.baseBranch }
      try {
        // An idle session's checkpoint holds its files, so Code Storage
        // answers without waking its sandbox. A running turn has the sandbox
        // open already, with edits the checkpoint doesn't have yet.
        if (!(await turnRunning(session.threadRootId))) {
          const stored = await changesFromCheckpoint(target, path).catch(
            (err: unknown) => {
              logger.warn({ err, sessionId }, "Checkpoint changes read failed")
              return null
            }
          )
          if (stored) return stored
        }
        return await changesFromSandbox(target, path)
      } catch (err) {
        logger.warn({ err, sessionId }, "Session changes read failed")
        return { error: "couldn't read that session's changes" }
      }
    },
    strict: true,
  }),
}
