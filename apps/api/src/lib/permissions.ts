import {
  type CustomRoleGrants,
  canManageWorkspaceAuthority,
  isWorkspaceRole,
  type PermissionRequest,
  parseRolePermission,
  type StatementKey,
  type WorkspaceAuthority,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import { db } from "@repo/db"
import { workspaceRole } from "@repo/db/schema"
import { and, eq } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { Workspace, WorkspaceMember } from "@/lib/types/app-types"

// ── Type-Safe Permission Types ──────────────────────────────────────

export type { StatementKey }

export type PermissionForStatement<T extends StatementKey> = NonNullable<
  PermissionRequest[T]
>[number]

// Ownership derives from workspace.ownerId, never from the role string.
// customGrants are the parsed workspace_role grants for custom roles; null
// means static role, or a deleted/dangling custom role that degrades to
// member-tier base access (fail-safe, not a lockout).
export function toWorkspaceAuthority(
  member: Pick<WorkspaceMember, "role" | "userId">,
  workspace: Pick<Workspace, "ownerId">,
  customGrants: CustomRoleGrants | null = null
): WorkspaceAuthority {
  return {
    role: member.role,
    isOwner: workspace.ownerId === member.userId,
    customGrants: isWorkspaceRole(member.role) ? null : customGrants,
  }
}

// Full resolution including the workspace_role lookup for custom roles.
// workspaceAuthMiddleware uses this to populate c.var.authority; handlers
// outside that middleware (e.g. OAuth callbacks) call it directly.
export async function resolveWorkspaceAuthority(
  member: Pick<WorkspaceMember, "role" | "userId">,
  workspace: Pick<Workspace, "id" | "ownerId">
): Promise<WorkspaceAuthority> {
  let customGrants: CustomRoleGrants | null = null
  if (!isWorkspaceRole(member.role)) {
    const roleRecord = await db
      .select({ permission: workspaceRole.permission })
      .from(workspaceRole)
      .where(
        and(
          eq(workspaceRole.workspaceId, workspace.id),
          eq(workspaceRole.role, member.role)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    // Deleted/dangling custom role degrades to member-tier base access
    customGrants = roleRecord
      ? parseRolePermission(roleRecord.permission)
      : null
  }
  return toWorkspaceAuthority(member, workspace, customGrants)
}

// ── Permission Checks ──────────────────────────────────────

export function assertWorkspaceAuthority(
  authority: WorkspaceAuthority,
  requestedPermissions: PermissionRequest
) {
  if (!workspaceAuthorityHasPermissions(authority, requestedPermissions)) {
    throw new HTTPException(HttpStatusCodes.FORBIDDEN, {
      message: "You do not have permission to perform this action",
    })
  }

  return authority
}

export function hasWorkspaceAuthority(
  authority: WorkspaceAuthority,
  requestedPermissions: PermissionRequest
): boolean {
  return workspaceAuthorityHasPermissions(authority, requestedPermissions)
}

export function assertCanManageWorkspaceMember(
  actor: Pick<WorkspaceMember, "role" | "userId">,
  target: Pick<WorkspaceMember, "role" | "userId"> & { isBot: boolean },
  workspace: Pick<Workspace, "ownerId">
) {
  if (target.isBot) {
    throw new HTTPException(HttpStatusCodes.FORBIDDEN, {
      message: "Bots cannot be moderated",
    })
  }

  if (actor.userId === target.userId) {
    throw new HTTPException(HttpStatusCodes.FORBIDDEN, {
      message: "You cannot moderate yourself",
    })
  }

  const actorAuthority = toWorkspaceAuthority(actor, workspace)
  const targetAuthority = toWorkspaceAuthority(target, workspace)

  if (!canManageWorkspaceAuthority(actorAuthority, targetAuthority)) {
    throw new HTTPException(HttpStatusCodes.FORBIDDEN, {
      message: "You cannot moderate this member",
    })
  }

  return {
    actorAuthority,
    targetAuthority,
  }
}
