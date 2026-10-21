import { createHash } from "node:crypto"
import { and, asc, db, eq, inArray, schema, sql } from "@repo/db"
import {
  type HarnessOwner,
  type HarnessStateStore,
  type SavedHarnessState,
  type SaveHarnessStateInput,
  SessionCoreError,
} from "@repo/lor/session-core"
import { WORKER_ID } from "@/lib/worker-id"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function ownerWhere(owner: HarnessOwner) {
  return "sessionId" in owner
    ? eq(schema.harnessState.sessionId, owner.sessionId)
    : eq(schema.harnessState.voiceSessionId, owner.voiceSessionId)
}

function ownerColumns(owner: HarnessOwner) {
  return "sessionId" in owner
    ? { sessionId: owner.sessionId }
    : { voiceSessionId: owner.voiceSessionId }
}

// Rebuilds the harness log from its chunks and checks it against the saved
// head. A gap, reorder or hash mismatch throws: the run fails visibly instead
// of letting Pi start a blank conversation.
export async function loadHarnessState(
  owner: HarnessOwner,
  workspaceId: string
): Promise<SavedHarnessState | null> {
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
  }
}

// Writes one save inside the caller's transaction, so the turn's counters and
// stop reason commit with it. Guards: the claiming run still holds its lease
// at the same attempt, and the saved head is still the one this turn loaded.
// "replace" (after Pi converted an older format) swaps in the whole log.
export async function writeHarnessState(
  tx: Tx,
  input: SaveHarnessStateInput
): Promise<void> {
  const { log, expected } = input
  const replace = log.kind === "replace"
  const textBytes = Buffer.byteLength(log.text, "utf8")
  const priorBytes = replace ? 0 : (expected?.byteLength ?? 0)
  if (priorBytes + textBytes !== input.head.byteLength) {
    throw new SessionCoreError(
      "corrupt_state",
      "Harness log bytes do not match the new head length"
    )
  }

  const lease = await tx
    .select({ id: schema.agentRun.id })
    .from(schema.agentRun)
    .where(
      and(
        eq(schema.agentRun.id, input.claim.runId),
        eq(schema.agentRun.leaseOwner, WORKER_ID),
        eq(schema.agentRun.attempt, input.claim.attempt),
        inArray(schema.agentRun.state, ["working", "finalizing"])
      )
    )
    .for("update")
    .then((r) => r[0])
  if (!lease) {
    throw new SessionCoreError(
      "lease_lost",
      `Run ${input.claim.runId} no longer holds its lease`
    )
  }

  const values = {
    adapterVersion: input.binding.adapterVersion,
    formatVersion: input.binding.formatVersion,
    harnessSessionId: input.head.harnessSessionId,
    logFileName: input.head.logFileName,
    entryCount: input.head.entryCount,
    headEntryId: input.head.headEntryId,
    byteLength: input.head.byteLength,
    sha256: input.head.sha256,
    continuation: input.continuation,
    lastRunId: input.claim.runId,
  }
  const addedChunks = textBytes > 0 ? 1 : 0
  const returning = {
    id: schema.harnessState.id,
    chunkCount: schema.harnessState.chunkCount,
  }

  const state = expected
    ? await tx
        .update(schema.harnessState)
        .set({
          ...values,
          chunkCount: replace
            ? addedChunks
            : sql`${schema.harnessState.chunkCount} + ${addedChunks}`,
        })
        .where(
          and(
            ownerWhere(input.owner),
            eq(schema.harnessState.workspaceId, input.workspaceId),
            eq(schema.harnessState.kind, input.binding.kind),
            eq(schema.harnessState.sha256, expected.sha256),
            eq(schema.harnessState.byteLength, expected.byteLength)
          )
        )
        .returning(returning)
        .then((r) => r[0])
    : await tx
        .insert(schema.harnessState)
        .values({
          ...values,
          ...ownerColumns(input.owner),
          workspaceId: input.workspaceId,
          kind: input.binding.kind,
          chunkCount: addedChunks,
        })
        .onConflictDoNothing()
        .returning(returning)
        .then((r) => r[0])
  if (!state) {
    throw new SessionCoreError(
      "head_conflict",
      "The saved head changed since this turn loaded it"
    )
  }

  if (replace && expected) {
    await tx
      .delete(schema.harnessLog)
      .where(eq(schema.harnessLog.harnessStateId, state.id))
  }
  if (addedChunks > 0) {
    await tx.insert(schema.harnessLog).values({
      harnessStateId: state.id,
      seq: state.chunkCount - 1,
      byteOffset: priorBytes,
      content: log.text,
      runId: input.claim.runId,
    })
  }
}

export const harnessStateStore: HarnessStateStore = {
  load: loadHarnessState,
  save: (input) => db.transaction((tx) => writeHarnessState(tx, input)),
}
