import type { ApprovalResolverSpec } from "@repo/auth/permissions"
import { and, db, eq, inArray, schema } from "@repo/db"
import type { Approval } from "@repo/db/schema"

export function serializeApproval(row: Approval) {
  return {
    id: row.id,
    taskId: row.taskId,
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

// Resolver specs for a batch of approvals, keyed by approval id — one policy
// query for the page instead of one per row. Same fallbacks as
// loadApprovalResolver: no row → permission, dangling named resolver → null
// (owner-only).
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
      out.set(approval.id, { kind: "permission" })
      continue
    }
    switch (policy.resolverKind) {
      case "permission":
        out.set(approval.id, { kind: "permission" })
        break
      case "any_member":
        out.set(approval.id, { kind: "any_member" })
        break
      case "role":
        out.set(
          approval.id,
          policy.resolverRole
            ? { kind: "role", role: policy.resolverRole }
            : null
        )
        break
      case "user":
        out.set(
          approval.id,
          policy.resolverUserId
            ? { kind: "user", userId: policy.resolverUserId }
            : null
        )
        break
    }
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
  // The gate was turned off while this approval was open. The pending row
  // still has to be answerable, so fall back to the column default.
  if (!policy) return { kind: "permission" }
  switch (policy.resolverKind) {
    case "permission":
      return { kind: "permission" }
    case "any_member":
      return { kind: "any_member" }
    case "role":
      return policy.resolverRole
        ? { kind: "role", role: policy.resolverRole }
        : null
    case "user":
      return policy.resolverUserId
        ? { kind: "user", userId: policy.resolverUserId }
        : null
  }
}
