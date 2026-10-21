import { and, db, eq, isNotNull, schema } from "@repo/db"
import type { Approval } from "@repo/db/schema"
import type { ApprovalDecision } from "@repo/lor"

// A Pi turn paused on an approval set finishes with one decision per row
// (reference/planned/pi-harness-runbook.md §4.2). The last decision starts a
// resume run; any other run in the session finishes the turn first, after
// it rejects what is still pending (writing instead of deciding is a "no").

function decisionReason(
  status: Approval["status"],
  resolverName: string | null
): string {
  if (status === "rejected") {
    return `${resolverName ?? "A person"} rejected this, so it was not run. Do not take this action.`
  }
  if (status === "expired") return "Nobody decided in time, so it was not run."
  return "No decision was recorded for this action, so it was not run."
}

export async function loadPausedDecisions(
  pausedRunId: string,
  // Set for a run that is not the set's resume: who wrote instead.
  steer: { userId: string | null; name: string } | null
): Promise<{ decisions: ApprovalDecision[]; steered: Approval[] }> {
  const steered = steer
    ? await db
        .update(schema.approval)
        .set({
          status: "rejected",
          resolvedBy: steer.userId,
          resolvedAt: new Date(),
        })
        .where(
          and(
            eq(schema.approval.runId, pausedRunId),
            eq(schema.approval.status, "pending")
          )
        )
        .returning()
    : []
  const steeredIds = new Set(steered.map((row) => row.id))
  const rows = await db
    .select({
      id: schema.approval.id,
      harnessApprovalId: schema.approval.harnessApprovalId,
      status: schema.approval.status,
      toolName: schema.approval.toolName,
      kind: schema.approval.kind,
      target: schema.approval.target,
      inputSha256: schema.approval.inputSha256,
      resolverName: schema.user.name,
    })
    .from(schema.approval)
    .leftJoin(schema.user, eq(schema.user.id, schema.approval.resolvedBy))
    .where(eq(schema.approval.runId, pausedRunId))
  const decisions = rows.flatMap((row): ApprovalDecision[] =>
    row.harnessApprovalId && row.toolName
      ? [
          {
            harnessApprovalId: row.harnessApprovalId,
            approved: row.status === "approved",
            reason:
              steer && steeredIds.has(row.id)
                ? `${steer.name} sent a new message instead of deciding, so this was not run. Do not retry it now; their message follows.`
                : decisionReason(row.status, row.resolverName),
            toolName: row.toolName,
            kind: row.kind,
            target: row.target,
            inputSha256: row.inputSha256,
          },
        ]
      : []
  )
  return { decisions, steered }
}

// Whether a queued resume still has a paused turn to finish: another run may
// have finished it first.
export async function resumeStillPending(approvalId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.harnessState.id })
    .from(schema.approval)
    .innerJoin(
      schema.harnessState,
      eq(schema.harnessState.lastRunId, schema.approval.runId)
    )
    .where(
      and(
        eq(schema.approval.id, approvalId),
        isNotNull(schema.harnessState.continuation)
      )
    )
    .limit(1)
  return rows.length > 0
}
