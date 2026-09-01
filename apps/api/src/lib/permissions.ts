import {
  type CustomRoleGrants,
  canManageWorkspaceAuthority,
  isWorkspaceRole,
  type PermissionRequest,
  type StatementKey,
  type WorkspaceAuthority,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
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

export function assertWorkspacePermission(
  member: Pick<WorkspaceMember, "role" | "userId">,
  workspace: Pick<Workspace, "ownerId">,
  requestedPermissions: PermissionRequest
) {
  // Static-role resolution only — custom-role grants ride on c.var.authority.
  // Handlers should call assertWorkspaceAuthority(c.var.authority, …) as
  // their first statement; this wrapper is deleted once S3 migrates them.
  return assertWorkspaceAuthority(
    toWorkspaceAuthority(member, workspace),
    requestedPermissions
  )
}

export function hasWorkspaceAuthority(
  authority: WorkspaceAuthority,
  requestedPermissions: PermissionRequest
): boolean {
  return workspaceAuthorityHasPermissions(authority, requestedPermissions)
}

// Non-throwing variant for handlers that shape (rather than gate) a response
// by permission.
export function hasWorkspacePermission(
  member: Pick<WorkspaceMember, "role" | "userId">,
  workspace: Pick<Workspace, "ownerId">,
  requestedPermissions: PermissionRequest
): boolean {
  return workspaceAuthorityHasPermissions(
    toWorkspaceAuthority(member, workspace),
    requestedPermissions
  )
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
