import { isWorkspaceRole } from "@repo/auth/permissions"
import {
  APPROVAL_CAPABILITY_TARGETS,
  approvalTargetKey,
  CAPABILITIES,
  parseApprovalTargetKey,
} from "@repo/connectors"
import { and, asc, db, eq, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  DeleteApprovalPolicyRoute,
  ListApprovalPoliciesRoute,
  UpsertApprovalPolicyRoute,
} from "@/routes/v1/approval-policies/routes"

type ApprovalTargetRow = {
  key: string
  label: string
  description: string
  group: "capability" | "custom_tool" | "mcp_server"
}

// Every switch the policy page can show, regardless of connection state: a
// gate on a disconnected connector is inert, not invalid, and keeping it
// listed means opting in survives a reconnect.
async function workspaceApprovalTargets(
  workspaceId: string
): Promise<ApprovalTargetRow[]> {
  const [tools, servers] = await Promise.all([
    db
      .select({ id: schema.customTool.id, name: schema.customTool.name })
      .from(schema.customTool)
      .where(eq(schema.customTool.workspaceId, workspaceId))
      .orderBy(asc(schema.customTool.name)),
    db
      .select({ id: schema.mcpServer.id, name: schema.mcpServer.name })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.workspaceId, workspaceId))
      .orderBy(asc(schema.mcpServer.name)),
  ])
  return [
    ...APPROVAL_CAPABILITY_TARGETS.map((capability) => ({
      key: approvalTargetKey({ kind: "capability", capability }),
      label: CAPABILITIES[capability].label,
      description: CAPABILITIES[capability].description,
      group: "capability" as const,
    })),
    ...tools.map((tool) => ({
      key: approvalTargetKey({ kind: "customTool", customToolId: tool.id }),
      label: tool.name,
      description: "Custom tool",
      group: "custom_tool" as const,
    })),
    ...servers.map((server) => ({
      key: approvalTargetKey({ kind: "mcpServer", mcpServerId: server.id }),
      label: server.name,
      description: "All tools from this MCP server",
      group: "mcp_server" as const,
    })),
  ]
}

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

  return c.json({ policies, targets }, HttpStatusCodes.OK)
}

export const upsertApprovalPolicy: AppRouteHandler<
  UpsertApprovalPolicyRoute
> = async (c) => {
  assertWorkspaceAuthority(c.var.authority, { approval: ["manage"] })
  const workspace = c.var.workspace
  const body = c.req.valid("json")

  const target = parseApprovalTargetKey(body.target)
  if (!target) {
    return c.json(
      { success: false as const, message: "Unknown approval target" },
      HttpStatusCodes.BAD_REQUEST
    )
  }
  // Id-shaped targets must belong to this workspace — the key alone can't
  // stop a cross-workspace id.
  if (target.kind === "customTool") {
    const owned = await db
      .select({ id: schema.customTool.id })
      .from(schema.customTool)
      .where(
        and(
          eq(schema.customTool.id, target.customToolId),
          eq(schema.customTool.workspaceId, workspace.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!owned) {
      return c.json(
        { success: false as const, message: "Unknown custom tool" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }
  if (target.kind === "mcpServer") {
    const owned = await db
      .select({ id: schema.mcpServer.id })
      .from(schema.mcpServer)
      .where(
        and(
          eq(schema.mcpServer.id, target.mcpServerId),
          eq(schema.mcpServer.workspaceId, workspace.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!owned) {
      return c.json(
        { success: false as const, message: "Unknown MCP server" },
        HttpStatusCodes.BAD_REQUEST
      )
    }
  }

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
