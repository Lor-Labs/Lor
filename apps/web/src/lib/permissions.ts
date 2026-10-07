import {
  type CustomRoleGrants,
  canManageWorkspaceAuthority,
  formatWorkspaceRole as formatWorkspaceRoleHelper,
  isWorkspaceRole,
  type PermissionRequest,
  type WorkspaceAuthority,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"

// Custom role name → parsed grants, fetched once per workspace via
// useWorkspaceRoles (react-query). Optional everywhere: without it a custom
// role resolves to member-tier affordances (the server enforces real grants
// regardless).
export type CustomRoleMap = Record<string, CustomRoleGrants>

function toAuthority(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): WorkspaceAuthority {
  return {
    role: member.role,
    isOwner: workspace.ownerId === member.userId,
    customGrants: isWorkspaceRole(member.role)
      ? null
      : (customRoles?.[member.role] ?? null),
  }
}

export function isOwner(
  member: { userId: string },
  workspace: { ownerId: string }
): boolean {
  return member.userId === workspace.ownerId
}

export function isAdmin(member: { role: string }): boolean {
  return member.role === "admin"
}

export function isAdminOrOwner(
  member: { userId: string; role: string },
  workspace: { ownerId: string }
): boolean {
  return isOwner(member, workspace) || isAdmin(member)
}

export function formatWorkspaceRole(role: string): string {
  if (!role) return "Member"
  return formatWorkspaceRoleHelper(role)
}

function hasPermissions(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  requestedPermissions: PermissionRequest,
  customRoles?: CustomRoleMap
): boolean {
  return workspaceAuthorityHasPermissions(
    toAuthority(member, workspace, customRoles),
    requestedPermissions
  )
}

export function canManageChannels(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { channel: ["update"] }, customRoles)
}

export function canCreateChannels(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { channel: ["create"] }, customRoles)
}

export function canDeleteChannels(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { channel: ["delete"] }, customRoles)
}

export function canPinMessages(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { message: ["pin"] }, customRoles)
}

export function canModerateVoice(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { voice: ["moderate"] }, customRoles)
}

export function canDeleteVoiceCalls(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(member, workspace, { voice: ["delete"] }, customRoles)
}

export function canKickWorkspaceMembers(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(
    member,
    workspace,
    { workspaceMember: ["kick"] },
    customRoles
  )
}

export function canUpdateMemberRoles(
  member: { userId: string; role: string },
  workspace: { ownerId: string },
  customRoles?: CustomRoleMap
): boolean {
  return hasPermissions(
    member,
    workspace,
    { workspaceMember: ["role:update"] },
    customRoles
  )
}

export function canManageWorkspaceMember(
  actor: { userId: string; role: string },
  target: { userId: string; role: string },
  workspace: { ownerId: string }
): boolean {
  if (actor.userId === target.userId) return false
  return canManageWorkspaceAuthority(
    toAuthority(actor, workspace),
    toAuthority(target, workspace)
  )
}
