import { randomUUID } from "node:crypto"
import {
  and,
  count,
  db,
  eq,
  inArray,
  isNotNull,
  isNull,
  schema,
  sql,
} from "@repo/db"
import type { AgentSession } from "@repo/db/schema"
import { createSession } from "./agent-sessions"
import {
  branchCheckpoint,
  type SessionCheckpointRow,
  turnCheckpoint,
} from "./code-checkpoints"
import { loadHarnessState, turnEndChunk, turnEndEntryId } from "./harness-store"
import { SESSION_WORK_DIR } from "./sandbox/session-sandbox"
import type { SavedHarnessState } from "./session-core"
import {
  branchClaudeLog,
  lastEntryUuid,
  rewindClaudeLog,
} from "./session-core/claude-branch"
import { branchCodexLog, rewindCodexLog } from "./session-core/codex-branch"
import { branchPiLog, rewindPiLog } from "./session-core/pi-branch"
import { piWorkDir } from "./session-core/work-dir"

// Fork and rewind at one of Lor's replies, on the same harness with its
// native state (code-sessions-runbook.md chunks 6, 7e and 8e): Pi's log,
// Claude Code's conversation file or Codex's rollout up to that turn and, in
// a code session, that turn's files.

export class BranchRefusedError extends Error {}

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

// Where a turn ended in the saved conversation: Pi's entry, Claude Code's
// last entry and the save's last byte, or Codex's last byte.
type TurnPoint =
  | { harness: "pi"; entryId: string }
  | { harness: "claude_code"; entryUuid: string; endOffset: number }
  | { harness: "codex"; endOffset: number }

async function turnPoint(
  session: AgentSession,
  runId: string
): Promise<TurnPoint | null> {
  if (session.harness === "pi") {
    const entryId = await turnEndEntryId(session.id, runId)
    return entryId ? { harness: "pi", entryId } : null
  }
  const chunk = await turnEndChunk(session.id, runId)
  if (!chunk) return null
  const endOffset = chunk.byteOffset + Buffer.byteLength(chunk.content, "utf8")
  if (session.harness === "codex") return { harness: "codex", endOffset }
  const entryUuid = lastEntryUuid(chunk.content)
  return entryUuid ? { harness: "claude_code", entryUuid, endOffset } : null
}

// Where one of Lor's replies left the session: the saved conversation, the
// point in it where the turn ended and, in a code session, the turn's
// checkpoint.
async function turnEnd(
  session: AgentSession,
  messageId: string,
  action: "fork" | "rewind"
) {
  const [run] = await db
    .select({
      id: schema.agentRun.id,
      state: schema.agentRun.state,
      stopReason: schema.agentRun.stopReason,
    })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.messageId, messageId),
        eq(schema.agentRun.threadRootId, session.threadRootId)
      )
    )
    .limit(1)
  if (!run) throw new BranchRefusedError("That isn't one of Lor's replies here")
  if ((ACTIVE_RUN_STATES as readonly string[]).includes(run.state)) {
    throw new BranchRefusedError("Lor is still working on that reply")
  }
  if (run.stopReason === "awaiting_approval") {
    throw new BranchRefusedError(
      `That turn waited on an approval. ${action === "fork" ? "Fork from" : "Rewind to"} a later reply`
    )
  }

  const [saved, point] = await Promise.all([
    loadHarnessState({ sessionId: session.id }, session.workspaceId),
    turnPoint(session, run.id),
  ])
  if (!saved || !point) {
    throw new BranchRefusedError(
      `That reply has no saved conversation to ${action}`
    )
  }
  const code =
    session.mode === "code" && session.repoFullName && session.baseBranch
      ? { repoFullName: session.repoFullName, baseBranch: session.baseBranch }
      : null
  const checkpoint = code ? await turnCheckpoint(session.id, run.id) : null
  if (code && !checkpoint) {
    throw new BranchRefusedError(
      `That turn's files weren't saved, so it can't be ${action === "fork" ? "forked" : "rewound to"}`
    )
  }
  return { saved, point, code, checkpoint }
}

// A Claude Code fork's file and its saved format.
function forkClaudeLog(
  saved: SavedHarnessState,
  endOffset: number,
  sourceSessionId: string,
  forkSessionId: string
) {
  const branched = branchClaudeLog({
    log: saved.log,
    endOffset,
    head: saved.head,
    sourceSessionId,
    forkSessionId,
  })
  if (!branched) {
    throw new BranchRefusedError("That reply's conversation can't be forked")
  }
  return { ...branched, formatVersion: saved.binding.formatVersion }
}

function forkCodexLog(saved: SavedHarnessState, endOffset: number) {
  const branched = branchCodexLog(saved.log, endOffset, saved.head)
  if (!branched) {
    throw new BranchRefusedError("That reply's conversation can't be forked")
  }
  return { ...branched, formatVersion: saved.binding.formatVersion }
}

// A new session from that turn; the source session is unchanged, and Lor may
// keep working there: only saved state is read.
export async function forkSession(input: {
  source: AgentSession
  // The Lor reply whose turn the fork starts from.
  messageId: string
  userId: string
}): Promise<AgentSession> {
  const { source } = input
  const { saved, point, code, checkpoint } = await turnEnd(
    source,
    input.messageId,
    "fork"
  )

  // "X (fork)", then "X (fork 2)"... until Lor's first reply in it names it.
  const [earlier] = await db
    .select({ forks: count() })
    .from(schema.agentSession)
    .where(
      and(
        eq(schema.agentSession.sourceSessionId, source.id),
        isNotNull(schema.agentSession.forkedFromMessageId)
      )
    )
  const forks = earlier?.forks ?? 0
  const title = `${source.title} (fork${forks > 0 ? ` ${forks + 1}` : ""})`

  const id = randomUUID()
  const branched =
    point.harness === "pi"
      ? await branchPiLog(
          saved.log,
          point.entryId,
          piWorkDir(SESSION_WORK_DIR, id)
        )
      : point.harness === "codex"
        ? forkCodexLog(saved, point.endOffset)
        : forkClaudeLog(saved, point.endOffset, source.id, id)
  // Before the rows: a failed transaction leaves only a branch, which the
  // daily checkpoint sweep deletes.
  if (checkpoint) await branchCheckpoint(checkpoint, id)

  return db.transaction(async (tx) => {
    const session = await createSession(tx, {
      id,
      workspaceId: source.workspaceId,
      channelId: source.channelId,
      authorId: input.userId,
      creatorId: input.userId,
      origin: "new",
      ...(code ? { code } : {}),
      harness: source.harness,
      sourceSessionId: source.id,
      forkedFromMessageId: input.messageId,
      title,
      subscriberIds: [input.userId],
    })
    // No last run: the first turn's prompt is everything said in the fork.
    const [state] = await tx
      .insert(schema.harnessState)
      .values({
        workspaceId: source.workspaceId,
        sessionId: id,
        kind: saved.binding.kind,
        adapterVersion: saved.binding.adapterVersion,
        formatVersion: branched.formatVersion,
        ...branched.head,
        chunkCount: 1,
        continuation: null,
        lastRunId: null,
      })
      .returning({ id: schema.harnessState.id })
    if (!state) throw new Error("Fork harness state insert returned no row")
    await tx.insert(schema.harnessLog).values({
      harnessStateId: state.id,
      seq: 0,
      byteOffset: 0,
      content: branched.log,
      runId: null,
    })
    if (checkpoint) {
      const { id: _id, createdAt: _createdAt, ...files } = checkpoint
      await tx
        .insert(schema.sessionCheckpoint)
        .values({ ...files, sessionId: id, runId: null })
    }
    return session
  })
}

// The session itself goes back to that turn, for everyone in it: Pi's log
// gets the label entry that moves Lor's position there, Codex's rollout a
// rollback event. The later turns stay in the log and the transcript
// (collapsed) and can still be forked. The caller puts back the turn's files
// (rewindWorkFolder) and posts the event row, which also bounds the next
// turn's prompt.
export async function rewindSession(input: {
  session: AgentSession
  // The Lor reply whose turn the session goes back to.
  messageId: string
}): Promise<{ checkpoint: SessionCheckpointRow | null }> {
  const { session } = input
  if (session.archivedAt) {
    throw new BranchRefusedError("Unarchive the session to rewind it")
  }
  const { saved, point, checkpoint } = await turnEnd(
    session,
    input.messageId,
    "rewind"
  )
  if (saved.continuation !== null) {
    throw new BranchRefusedError(
      "Lor is waiting on an approval. Answer it or stop the turn first"
    )
  }
  // Claude Code's file is unchanged: only the entry its next turn resumes
  // from moves.
  const rewound =
    point.harness === "pi"
      ? await rewindPiLog(saved.log, point.entryId, {
          logFileName: saved.head.logFileName,
          formatVersion: saved.binding.formatVersion,
        })
      : point.harness === "codex"
        ? rewindCodexLog(saved.log, point.endOffset, saved.head)
        : rewindClaudeLog(saved.log, point.entryUuid, saved.head)
  if (rewound.kind === "off_branch") {
    throw new BranchRefusedError(
      "That reply was already rewound. Fork from it instead"
    )
  }
  if (rewound.kind === "current") {
    throw new BranchRefusedError("Nothing to rewind: that's Lor's newest turn")
  }
  if (rewound.kind === "old_format") {
    throw new BranchRefusedError(
      "Lor was updated since this session's last turn. Send a message, then rewind"
    )
  }
  if (rewound.kind === "compacted") {
    throw new BranchRefusedError(
      "Codex compacted the conversation after that reply. Fork from it instead"
    )
  }

  const expected = saved.head
  await db.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: schema.agentRun.id })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.threadRootId, session.threadRootId),
          inArray(schema.agentRun.state, [...ACTIVE_RUN_STATES])
        )
      )
      .limit(1)
    if (active) {
      throw new BranchRefusedError(
        "Lor is working in this session. Try again when it finishes"
      )
    }
    // Only from the head this was built on; a turn's save or another rewind
    // in between wins.
    const appended = rewound.appended
    const [state] = await tx
      .update(schema.harnessState)
      .set({
        entryCount: rewound.head.entryCount,
        headEntryId: rewound.head.headEntryId,
        byteLength: rewound.head.byteLength,
        sha256: rewound.head.sha256,
        ...(appended !== null
          ? { chunkCount: sql`${schema.harnessState.chunkCount} + 1` }
          : {}),
      })
      .where(
        and(
          eq(schema.harnessState.sessionId, session.id),
          eq(schema.harnessState.sha256, expected.sha256),
          eq(schema.harnessState.byteLength, expected.byteLength),
          eq(schema.harnessState.headEntryId, expected.headEntryId),
          isNull(schema.harnessState.continuation)
        )
      )
      .returning({
        id: schema.harnessState.id,
        chunkCount: schema.harnessState.chunkCount,
      })
    if (!state) {
      throw new BranchRefusedError("Lor's conversation just changed. Try again")
    }
    if (appended !== null) {
      await tx.insert(schema.harnessLog).values({
        harnessStateId: state.id,
        seq: state.chunkCount - 1,
        byteOffset: expected.byteLength,
        content: appended,
        runId: null,
      })
    }
  })
  return { checkpoint }
}
