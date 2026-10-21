import { canResolveApproval } from "@repo/auth/permissions"
import { and, db, eq, isNotNull, schema } from "@repo/db"
import { resolveChannelAccess } from "@repo/db/queries/channel-access"
import type { Approval } from "@repo/db/schema"
import type { ApprovalDecision, PausedTurnDrop } from "@repo/lor"
import { loadResolverSpec } from "@/lib/approval-notify"

// A Pi turn paused on an approval set finishes with one decision per row
// (reference/planned/pi-harness-runbook.md §4.2). The last decision starts a
// resume run; any other run in the session finishes the turn first, after
// it rejects what is still pending (writing instead of deciding is a "no").
// A turn someone stopped, or one saved by another adapter version, is
// dropped instead, so Lor never replies to it.

function decisionReason(
  status: Approval["status"],
  resolverName: string | null
): string {
  if (status === "rejected") {
    // No resolver: the call's watcher rejected it when nobody who could
    // approve was left.
    return resolverName
      ? `${resolverName} rejected this, so it was not run. Do not take this action.`
      : "Nobody who could approve this was available, so it was not run."
  }
  if (status === "expired") return "Nobody decided in time, so it was not run."
  return "No decision was recorded for this action, so it was not run."
}

export async function loadPausedDecisions(
  pausedRunId: string,
  // Set for a run that is not the set's resume: who wrote instead.
  steer: { userId: string | null; name: string } | null,
  // Another adapter version saved the paused turn (pausedTurnExpired).
  upgraded: boolean
): Promise<{
  decisions: ApprovalDecision[]
  // Rows this run closed, for the approval:updated broadcast.
  closed: Approval[]
  dropped: PausedTurnDrop | null
}> {
  const [pausedRun] = await db
    .select({
      stoppedAt: schema.agentRun.stopRequestedAt,
      stopperName: schema.user.name,
    })
    .from(schema.agentRun)
    .leftJoin(schema.user, eq(schema.user.id, schema.agentRun.stopRequestedBy))
    .where(eq(schema.agentRun.id, pausedRunId))
  if (pausedRun?.stoppedAt) {
    return {
      decisions: [],
      closed: [],
      dropped: { reason: "stopped", by: pausedRun.stopperName ?? "Someone" },
    }
  }
  if (upgraded) {
    const closed = await db
      .update(schema.approval)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(
        and(
          eq(schema.approval.runId, pausedRunId),
          eq(schema.approval.status, "pending")
        )
      )
      .returning()
    return { decisions: [], closed, dropped: { reason: "upgraded" } }
  }
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
      workspaceId: schema.approval.workspaceId,
      channelId: schema.agentRun.channelId,
      harnessApprovalId: schema.approval.harnessApprovalId,
      status: schema.approval.status,
      toolName: schema.approval.toolName,
      kind: schema.approval.kind,
      target: schema.approval.target,
      inputSha256: schema.approval.inputSha256,
      resolvedBy: schema.approval.resolvedBy,
      resolverName: schema.user.name,
    })
    .from(schema.approval)
    .innerJoin(schema.agentRun, eq(schema.agentRun.id, schema.approval.runId))
    .leftJoin(schema.user, eq(schema.user.id, schema.approval.resolvedBy))
    .where(eq(schema.approval.runId, pausedRunId))
  const decisions = await Promise.all(
    rows.map(async (row): Promise<ApprovalDecision | null> => {
      if (!row.harnessApprovalId || !row.toolName) return null
      const allowed =
        row.status === "approved" &&
        row.resolvedBy !== null &&
        (await resolverStillAllowed({ ...row, userId: row.resolvedBy }))
      return {
        harnessApprovalId: row.harnessApprovalId,
        approved: allowed,
        reason:
          steer && steeredIds.has(row.id)
            ? `${steer.name} sent a new message instead of deciding, so this was not run. Do not retry it now; their message follows.`
            : row.status === "approved"
              ? `${row.resolverName ?? "The approver"} can no longer approve this, so it was not run.`
              : decisionReason(row.status, row.resolverName),
        toolName: row.toolName,
        kind: row.kind,
        target: row.target,
        inputSha256: row.inputSha256,
      }
    })
  )
  return {
    decisions: decisions.filter((d): d is ApprovalDecision => d !== null),
    closed: steered,
    dropped: null,
  }
}

// An approval stands only while its approver could still give it: write
// access to the channel, and the gate's resolver rule for policy rows (the
// same rule the resolve endpoint applies).
async function resolverStillAllowed(input: {
  userId: string
  workspaceId: string
  channelId: string
  kind: Approval["kind"]
  target: string | null
}): Promise<boolean> {
  const access = await resolveChannelAccess(input.userId, input.channelId)
  if (!access.ok || !access.access.canWrite) return false
  if (input.kind === "request") return true
  const [member] = await db
    .select({
      role: schema.workspaceMember.role,
      ownerId: schema.workspace.ownerId,
    })
    .from(schema.workspaceMember)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.workspaceMember.workspaceId)
    )
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, input.workspaceId),
        eq(schema.workspaceMember.userId, input.userId)
      )
    )
    .limit(1)
  if (!member) return false
  const authority = {
    role: member.role,
    isOwner: member.ownerId === input.userId,
  }
  const spec = await loadResolverSpec(input.workspaceId, input.target)
  return spec
    ? canResolveApproval(authority, spec, input.userId)
    : authority.isOwner
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
