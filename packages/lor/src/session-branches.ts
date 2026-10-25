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
import { loadHarnessState, turnEndEntryId } from "./harness-store"
import { SESSION_WORK_DIR } from "./sandbox/session-sandbox"
import { branchPiLog, rewindPiLog } from "./session-core/pi-branch"
import { piWorkDir } from "./session-core/work-dir"

// Fork and rewind at one of Lor's replies, on the same harness with its
// native state (code-sessions-runbook.md chunk 6): Pi's log up to that turn
// and, in a code session, that turn's files.

export class BranchRefusedError extends Error {}

const ACTIVE_RUN_STATES = ["queued", "working", "finalizing"] as const

// Where one of Lor's replies left the session: the saved conversation, Pi's
// entry at the turn's end and, in a code session, the turn's checkpoint.
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

  const [saved, entryId] = await Promise.all([
    loadHarnessState({ sessionId: session.id }, session.workspaceId),
    turnEndEntryId(session.id, run.id),
  ])
  if (!saved || !entryId) {
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
  return { saved, entryId, code, checkpoint }
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
  const { saved, entryId, code, checkpoint } = await turnEnd(
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
  const branched = await branchPiLog(
    saved.log,
    entryId,
    piWorkDir(SESSION_WORK_DIR, id)
  )
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
// gets the label entry that moves Lor's position there. The later turns stay
// in the log and the transcript (collapsed) and can still be forked. The
// caller puts back the turn's files (rewindWorkFolder) and posts the event
// row, which also bounds the next turn's prompt.
export async function rewindSession(input: {
  session: AgentSession
  // The Lor reply whose turn the session goes back to.
  messageId: string
}): Promise<{ checkpoint: SessionCheckpointRow | null }> {
  const { session } = input
  if (session.archivedAt) {
    throw new BranchRefusedError("Unarchive the session to rewind it")
  }
  const { saved, entryId, checkpoint } = await turnEnd(
    session,
    input.messageId,
    "rewind"
  )
  if (saved.continuation !== null) {
    throw new BranchRefusedError(
      "Lor is waiting on an approval. Answer it or stop the turn first"
    )
  }
  const rewound = await rewindPiLog(saved.log, entryId, {
    logFileName: saved.head.logFileName,
    formatVersion: saved.binding.formatVersion,
  })
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
    // Only from the head this was built on; a turn's save in between wins.
    const [state] = await tx
      .update(schema.harnessState)
      .set({
        entryCount: rewound.head.entryCount,
        headEntryId: rewound.head.headEntryId,
        byteLength: rewound.head.byteLength,
        sha256: rewound.head.sha256,
        chunkCount: sql`${schema.harnessState.chunkCount} + 1`,
      })
      .where(
        and(
          eq(schema.harnessState.sessionId, session.id),
          eq(schema.harnessState.sha256, expected.sha256),
          eq(schema.harnessState.byteLength, expected.byteLength),
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
    await tx.insert(schema.harnessLog).values({
      harnessStateId: state.id,
      seq: state.chunkCount - 1,
      byteOffset: expected.byteLength,
      content: rewound.appended,
      runId: null,
    })
  })
  return { checkpoint }
}
