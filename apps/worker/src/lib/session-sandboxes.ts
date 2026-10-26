import { and, db, eq, inArray, schema } from "@repo/db"
import { deleteSessionSandbox, stopParkedBridges } from "@repo/lor"
import type { DeleteSessionSandboxJobData } from "@repo/realtime-types/queues"
import { logger } from "@/lib/logger"

// Runs after the archive's undo window. Does nothing when the session was
// unarchived (or archived again, which queued its own job) in the meantime.
export async function deleteArchivedSessionSandbox(
  data: DeleteSessionSandboxJobData
): Promise<void> {
  const session = await db
    .select({ archivedAt: schema.agentSession.archivedAt })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.id, data.sessionId))
    .then((rows) => rows[0])
  if (session?.archivedAt?.getTime() !== Date.parse(data.archivedAt)) return
  await deleteSessionSandbox({ sessionId: data.sessionId })
}

// A paused turn's bridge keeps the sandbox running (billed) while it waits,
// so it stays live this long; then the next decision drops the turn with a
// note (code-sessions-runbook.md 7d-4a, Jacob 2026-10-26).
export const PARKED_BRIDGE_LIVE_MS = 30 * 60 * 1000
export const RELEASE_PARKED_BRIDGE_JOB = "release-parked-bridge"
export type ReleaseParkedBridgeJobData = { runId: string; threadRootId: string }

// Stops the bridge only while the turn still waits: its approvals pending, no
// run in the session, and the saved state still that run's. The paused run's
// row lock is the one the approval endpoint and Stop take, so a decision
// lands either before (nothing to stop) or after (no bridge: dropped).
export async function releaseParkedBridge(
  data: ReleaseParkedBridgeJobData
): Promise<void> {
  const [session] = await db
    .select({
      id: schema.agentSession.id,
      harness: schema.agentSession.harness,
    })
    .from(schema.agentSession)
    .where(eq(schema.agentSession.threadRootId, data.threadRootId))
  if (session?.harness !== "claude_code") return
  const stopped = await db.transaction(async (tx) => {
    await tx
      .select({ id: schema.agentRun.id })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, data.runId))
      .for("update")
    const [pending] = await tx
      .select({ id: schema.approval.id })
      .from(schema.approval)
      .where(
        and(
          eq(schema.approval.runId, data.runId),
          eq(schema.approval.status, "pending")
        )
      )
      .limit(1)
    const [active] = await tx
      .select({ id: schema.agentRun.id })
      .from(schema.agentRun)
      .where(
        and(
          eq(schema.agentRun.threadRootId, data.threadRootId),
          inArray(schema.agentRun.state, ["queued", "working", "finalizing"])
        )
      )
      .limit(1)
    const [state] = await tx
      .select({
        lastRunId: schema.harnessState.lastRunId,
        continuation: schema.harnessState.continuation,
      })
      .from(schema.harnessState)
      .where(eq(schema.harnessState.sessionId, session.id))
    if (!pending || active || state?.lastRunId !== data.runId) return 0
    if (!state.continuation) return 0
    return stopParkedBridges({ sessionId: session.id })
  })
  if (stopped > 0) {
    logger.info(
      { runId: data.runId, sessionId: session.id, stopped },
      "Stopped a parked Claude Code bridge after its live window"
    )
  }
}
