import {
  type ApprovalResolverSpec,
  approvalPolicyResolverSpec,
  canResolveApproval,
} from "@repo/auth/permissions"
import { and, db, eq, inArray, schema, sql } from "@repo/db"
import type { Approval } from "@repo/db/schema"
import { resolveWorkspaceAuthority } from "@/lib/permissions"

export function serializeApproval(row: Approval) {
  return {
    id: row.id,
    planId: row.planId,
    action: row.action,
    description: row.description,
    status: row.status,
    target: row.target,
    toolName: row.toolName,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

// Same rule as the resolve endpoint (the caller already checked the channel).
async function canResolveAll(
  run: { workspaceId: string; claudeCodeUserId: string | null },
  pending: Pick<Approval, "id" | "kind" | "target">[],
  userId: string
): Promise<boolean> {
  const row = await db
    .select({
      role: schema.workspaceMember.role,
      userId: schema.workspaceMember.userId,
      ownerId: schema.workspace.ownerId,
    })
    .from(schema.workspaceMember)
    .innerJoin(
      schema.workspace,
      eq(schema.workspace.id, schema.workspaceMember.workspaceId)
    )
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, run.workspaceId),
        eq(schema.workspaceMember.userId, userId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return false
  const authority = await resolveWorkspaceAuthority(row, {
    id: run.workspaceId,
    ownerId: row.ownerId,
  })
  const specs = await loadApprovalResolvers(run.workspaceId, pending)
  return pending.every((approval) => {
    if (approval.kind === "claude_code") return run.claudeCodeUserId === userId
    const spec = specs.get(approval.id)
    return spec
      ? canResolveApproval(authority, spec, userId)
      : authority.isOwner
  })
}

// Stop on a turn paused on approvals (chat Stop, or cancel in a call): the turn
// just ends, with no reply. Its pending rows close and the paused run is
// marked stopped, so the session's next run drops the turn instead of
// finishing it. Empty when nothing was pending: a decided set already resumes.
// A rejecting stopper who couldn't resolve every row still ends the turn, but
// the rows close as expired with no resolver, not as their rejection.
export async function stopPausedTurn(
  runId: string,
  userId: string,
  status: "rejected" | "expired"
): Promise<Approval[]> {
  return db.transaction(async (tx) => {
    // Serializes with resolutions of the same set (the resolve endpoint).
    const run = await tx
      .select({
        workspaceId: schema.agentRun.workspaceId,
        claudeCodeUserId: sql<
          string | null
        >`${schema.agentRun.context} ->> 'claudeCodeUserId'`,
      })
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, runId))
      .for("update")
      .then((rows) => rows[0])
    let outcome: { status: Approval["status"]; resolvedBy: string | null } = {
      status,
      resolvedBy: userId,
    }
    if (status === "rejected") {
      const pending = await tx
        .select({
          id: schema.approval.id,
          kind: schema.approval.kind,
          target: schema.approval.target,
        })
        .from(schema.approval)
        .where(
          and(
            eq(schema.approval.runId, runId),
            eq(schema.approval.status, "pending")
          )
        )
      if (!run || !(await canResolveAll(run, pending, userId))) {
        outcome = { status: "expired", resolvedBy: null }
      }
    }
    const closed = await tx
      .update(schema.approval)
      .set({ ...outcome, resolvedAt: new Date() })
      .where(
        and(
          eq(schema.approval.runId, runId),
          eq(schema.approval.status, "pending")
        )
      )
      .returning()
    if (closed.length > 0) {
      await tx
        .update(schema.agentRun)
        .set({
          stopRequestedAt: sql`coalesce(${schema.agentRun.stopRequestedAt}, now())`,
          stopRequestedBy: userId,
        })
        .where(eq(schema.agentRun.id, runId))
    }
    return closed
  })
}

// Resolver specs for a batch of approvals, keyed by approval id — one policy
// query for the page instead of one per row. Same fallbacks as
// loadApprovalResolver: no row → any_member (the gate was turned off, so the
// action needs no restriction), dangling named resolver → null (owner-only).
export async function loadApprovalResolvers(
  workspaceId: string,
  approvals: Pick<Approval, "id" | "target">[]
): Promise<Map<string, ApprovalResolverSpec | null>> {
  const targets = [
    ...new Set(
      approvals
        .map((a) => a.target)
        .filter((t): t is string => typeof t === "string")
    ),
  ]
  const policies =
    targets.length > 0
      ? await db
          .select({
            target: schema.approvalPolicy.target,
            resolverKind: schema.approvalPolicy.resolverKind,
            resolverRole: schema.approvalPolicy.resolverRole,
            resolverUserId: schema.approvalPolicy.resolverUserId,
          })
          .from(schema.approvalPolicy)
          .where(
            and(
              eq(schema.approvalPolicy.workspaceId, workspaceId),
              inArray(schema.approvalPolicy.target, targets)
            )
          )
      : []
  const byTarget = new Map(policies.map((p) => [p.target, p]))

  const out = new Map<string, ApprovalResolverSpec | null>()
  for (const approval of approvals) {
    if (!approval.target) {
      out.set(approval.id, { kind: "any_member" })
      continue
    }
    const policy = byTarget.get(approval.target)
    if (!policy) {
      out.set(approval.id, { kind: "any_member" })
      continue
    }
    out.set(approval.id, approvalPolicyResolverSpec(policy))
  }
  return out
}

// Who may resolve this approval. A null target means the agent asked for a
// one-off approval itself (request_approval), which any member of the channel
// may answer — only policy gates carry a configured resolver.
// Returns null when the policy row is present but its named resolver is gone
// (custom role deleted, resolver user removed): the gate then falls back to
// owner-only rather than silently opening up.
export async function loadApprovalResolver(
  workspaceId: string,
  target: string | null
): Promise<ApprovalResolverSpec | null> {
  if (!target) return { kind: "any_member" }
  const policy = await db
    .select({
      resolverKind: schema.approvalPolicy.resolverKind,
      resolverRole: schema.approvalPolicy.resolverRole,
      resolverUserId: schema.approvalPolicy.resolverUserId,
    })
    .from(schema.approvalPolicy)
    .where(
      and(
        eq(schema.approvalPolicy.workspaceId, workspaceId),
        eq(schema.approvalPolicy.target, target)
      )
    )
    .limit(1)
    .then((rows) => rows[0])
  // The gate was turned off while this approval was open: the workspace no
  // longer restricts the action, so anyone may wave the stale row through.
  if (!policy) return { kind: "any_member" }
  return approvalPolicyResolverSpec(policy)
}
