import { isWorkspaceRole } from "@repo/auth/permissions"
import { parseApprovalTargetKey } from "@repo/connectors"
import { and, asc, db, eq, inArray, schema } from "@repo/db"
import {
  type ApprovalTargetRow,
  approvalTargetIssue,
  workspaceApprovalTargets,
} from "@/lib/approval-targets"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  BulkApprovalPoliciesRoute,
  DeleteApprovalPolicyRoute,
  ListApprovalPoliciesRoute,
  UpsertApprovalPolicyRoute,
} from "@/routes/v1/approval-policies/routes"

const policyColumns = {
  id: schema.approvalPolicy.id,
  target: schema.approvalPolicy.target,
  resolverKind: schema.approvalPolicy.resolverKind,
  resolverRole: schema.approvalPolicy.resolverRole,
  resolverUserId: schema.approvalPolicy.resolverUserId,
}

export const listApprovalPolicies: AppRouteHandler<
  ListApprovalPoliciesRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { approval: ["manage"] })
  const workspace = c.var.workspace

  const [policies, targets] = await Promise.all([
    db
      .select(policyColumns)
      .from(schema.approvalPolicy)
      .where(eq(schema.approvalPolicy.workspaceId, workspace.id))
      .orderBy(asc(schema.approvalPolicy.target)),
    workspaceApprovalTargets(workspace.id),
  ])

  const available = new Set(targets.map((target) => target.key))
  for (const policy of policies) {
    if (!available.has(policy.target))
      targets.push({
        key: policy.target,
        name: policy.target,
        label: policy.target,
        description:
          "This rule no longer matches an available tool. Remove it if no longer needed.",
        group: "unavailable",
        groupKey: "unavailable",
        groupLabel: "Unavailable tools",
      } satisfies ApprovalTargetRow)
  }
  return c.json({ policies, targets }, HttpStatusCodes.OK)
}

export const upsertApprovalPolicy: AppRouteHandler<
  UpsertApprovalPolicyRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { approval: ["manage"] })
  const workspace = c.var.workspace
  const body = c.req.valid("json")

  const issue = await approvalTargetIssue(workspace.id, body.target)
  if (issue)
    return c.json(
      { success: false as const, message: issue },
      HttpStatusCodes.BAD_REQUEST
    )

  // A named resolver must exist now; deletion later degrades to owner-only
  // (resolver_user_id set-null; a dangling role stops matching anyone).
  if (body.resolverKind === "role" && body.resolverRole) {
    if (!isWorkspaceRole(body.resolverRole)) {
      const role = await db
        .select({ id: schema.workspaceRole.id })
        .from(schema.workspaceRole)
        .where(
          and(
            eq(schema.workspaceRole.workspaceId, workspace.id),
            eq(schema.workspaceRole.role, body.resolverRole)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      if (!role) {
        return c.json(
          { success: false as const, message: "Unknown role" },
          HttpStatusCodes.BAD_REQUEST
        )
      }
    }
  }
  if (body.resolverKind === "user" && body.resolverUserId) {
    const member = await db
      .select({ userId: schema.workspaceMember.userId })
      .from(schema.workspaceMember)
      .where(
        and(
          eq(schema.workspaceMember.workspaceId, workspace.id),
          eq(schema.workspaceMember.userId, body.resolverUserId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!member) {
      return c.json(
        { success: false as const, message: "Not a workspace member" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

  const values = {
    resolverKind: body.resolverKind,
    resolverRole: body.resolverKind === "role" ? body.resolverRole : null,
    resolverUserId: body.resolverKind === "user" ? body.resolverUserId : null,
    updatedAt: new Date(),
  }
  const policy = await db
    .insert(schema.approvalPolicy)
    .values({ workspaceId: workspace.id, target: body.target, ...values })
    .onConflictDoUpdate({
      target: [schema.approvalPolicy.workspaceId, schema.approvalPolicy.target],
      set: values,
    })
    .returning(policyColumns)
    .then((rows) => rows[0] ?? null)

  if (!policy) {
    return c.json(
      { success: false as const, message: "Failed to save policy" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
  return c.json({ policy }, HttpStatusCodes.OK)
}

export const deleteApprovalPolicy: AppRouteHandler<
  DeleteApprovalPolicyRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { approval: ["manage"] })
  const workspace = c.var.workspace
  const { policyId } = c.req.valid("param")

  const deleted = await db
    .delete(schema.approvalPolicy)
    .where(
      and(
        eq(schema.approvalPolicy.id, policyId),
        eq(schema.approvalPolicy.workspaceId, workspace.id)
      )
    )
    .returning({ id: schema.approvalPolicy.id })
    .then((rows) => rows[0] ?? null)

  if (!deleted) {
    return c.json(
      { success: false as const, message: "Policy not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const bulkApprovalPolicies: AppRouteHandler<
  BulkApprovalPoliciesRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { approval: ["manage"] })
  const workspaceId = c.var.workspace.id
  const body = c.req.valid("json")
  const targets = [...new Set(body.targets)]
  const issue = await db.transaction(async (tx) => {
    if (body.required) {
      const available = new Set(
        (await workspaceApprovalTargets(workspaceId, tx)).map(
          (target) => target.key
        )
      )
      if (
        targets.some(
          (target) => !available.has(target) || !parseApprovalTargetKey(target)
        )
      )
        return "Unknown approval target"
      // Existing gates keep their resolver. Bulk enabling only adds missing rules.
      await tx
        .insert(schema.approvalPolicy)
        .values(
          targets.map((target) => ({
            workspaceId,
            target,
            resolverKind: "any_member" as const,
          }))
        )
        .onConflictDoNothing()
    } else {
      await tx
        .delete(schema.approvalPolicy)
        .where(
          and(
            eq(schema.approvalPolicy.workspaceId, workspaceId),
            inArray(schema.approvalPolicy.target, targets)
          )
        )
    }
    return null
  })
  if (issue)
    return c.json(
      { success: false as const, message: issue },
      HttpStatusCodes.BAD_REQUEST
    )
  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
