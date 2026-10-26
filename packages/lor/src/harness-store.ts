import { createHash } from "node:crypto"
import { and, asc, db, desc, eq, schema } from "@repo/db"
import {
  type HarnessOwner,
  type SavedHarnessState,
  SessionCoreError,
} from "./session-core/harness-state"

// Reads of the saved harness state, shared by the worker (turns) and the API
// (fork and rewind). Writes stay with the worker's lease-guarded save.

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function ownerWhere(owner: HarnessOwner) {
  return "sessionId" in owner
    ? eq(schema.harnessState.sessionId, owner.sessionId)
    : eq(schema.harnessState.voiceSessionId, owner.voiceSessionId)
}

// Rebuilds the harness log from its chunks and checks it against the saved
// head. A gap, reorder or hash mismatch throws: the run fails visibly instead
// of letting Pi start a blank conversation.
export async function loadHarnessState(
  owner: HarnessOwner,
  workspaceId: string
): Promise<(SavedHarnessState & { lastRunId: string | null }) | null> {
  const row = await db
    .select()
    .from(schema.harnessState)
    .where(
      and(ownerWhere(owner), eq(schema.harnessState.workspaceId, workspaceId))
    )
    .then((r) => r[0])
  if (!row) return null

  const chunks = await db
    .select({
      seq: schema.harnessLog.seq,
      byteOffset: schema.harnessLog.byteOffset,
      content: schema.harnessLog.content,
    })
    .from(schema.harnessLog)
    .where(eq(schema.harnessLog.harnessStateId, row.id))
    .orderBy(asc(schema.harnessLog.seq))

  let log = ""
  let byteLength = 0
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.seq !== index || chunk.byteOffset !== byteLength) {
      throw new SessionCoreError(
        "corrupt_state",
        `Harness log chunk ${chunk.seq} of ${row.id} is out of order`
      )
    }
    log += chunk.content
    byteLength += Buffer.byteLength(chunk.content, "utf8")
  }
  if (
    chunks.length !== row.chunkCount ||
    byteLength !== row.byteLength ||
    sha256(log) !== row.sha256
  ) {
    throw new SessionCoreError(
      "corrupt_state",
      `Harness log of ${row.id} does not match its saved head`
    )
  }

  return {
    binding: {
      kind: row.kind,
      adapterVersion: row.adapterVersion,
      formatVersion: row.formatVersion,
    },
    head: {
      harnessSessionId: row.harnessSessionId,
      logFileName: row.logFileName,
      entryCount: row.entryCount,
      headEntryId: row.headEntryId,
      byteLength: row.byteLength,
      sha256: row.sha256,
    },
    log,
    continuation: row.continuation ?? null,
    lastRunId: row.lastRunId,
  }
}

// Where a run's turn ended in a session's Pi log: the last entry of the run's
// last save. Null when the run saved nothing, or a later format conversion
// stored the whole log as one chunk under another run.
export async function turnEndEntryId(
  sessionId: string,
  runId: string
): Promise<string | null> {
  const [chunk] = await db
    .select({ content: schema.harnessLog.content })
    .from(schema.harnessLog)
    .innerJoin(
      schema.harnessState,
      eq(schema.harnessLog.harnessStateId, schema.harnessState.id)
    )
    .where(
      and(
        eq(schema.harnessState.sessionId, sessionId),
        eq(schema.harnessLog.runId, runId)
      )
    )
    .orderBy(desc(schema.harnessLog.seq))
    .limit(1)
  const last = chunk?.content.trimEnd().split("\n").at(-1)
  if (!last) return null
  const entry = JSON.parse(last) as { id?: unknown }
  return typeof entry.id === "string" ? entry.id : null
}
