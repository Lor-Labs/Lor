import { createAccessControl } from "better-auth/plugins/access"
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access"
import { workspaceGrants, workspaceStatements } from "./workspace-statements"

const statement = {
  ...defaultStatements,
  ...workspaceStatements,
} as const

const ac = createAccessControl(statement)

const owner = ac.newRole({
  ...workspaceGrants,
  ...ownerAc.statements,
})

const admin = ac.newRole({
  ...workspaceGrants,
  ...adminAc.statements,
})

// Member — basic access, plus creating channels: small teams expect everyone
// to make channels (reference/onboarding.md, Permissions).
const member = ac.newRole({
  ...memberAc.statements,
  channel: ["create"],
})

const roles = { owner, admin, member }

const workspaceRoleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const satisfies Record<keyof typeof roles, string>

const workspaceRolePositions = {
  owner: 0,
  admin: 10,
  member: 20,
} as const satisfies Record<keyof typeof roles, number>

// Custom (workspace_role) roles all share one hierarchy slot: below admin,
// above member. No per-role ordering in v1.
const CUSTOM_ROLE_POSITION = 15

const workspaceMessageRateLimitsPerMinute = {
  owner: 120,
  admin: 120,
  member: 30,
} as const satisfies Record<keyof typeof roles, number>

const assignableWorkspaceRoles = [
  "admin",
  "member",
] as const satisfies ReadonlyArray<Exclude<keyof typeof roles, "owner">>

export type WorkspaceRole = keyof typeof roles
// Role strings from the DB may also name a workspace_role (custom role)
export type MemberRoleName = WorkspaceRole | (string & {})
export type CustomRoleGrants = Record<string, readonly string[]>
export type AssignableWorkspaceRole = (typeof assignableWorkspaceRoles)[number]
export type StatementKey = keyof typeof statement
export type PermissionRequest = {
  [K in StatementKey]?: readonly (typeof statement)[K][number][]
}
export type WorkspaceAuthority = {
  role: MemberRoleName
  // Ownership derives from workspace.ownerId — never from the role string
  isOwner?: boolean
  // Parsed workspace_role.permission grants when role is a custom role
  customGrants?: CustomRoleGrants | null
}

export function normalizeWorkspaceAuthority(
  authority: WorkspaceAuthority
): WorkspaceAuthority & { isOwner: boolean } {
  return {
    ...authority,
    // A stale or forged owner role must never confer ownership.
    role:
      authority.role === "owner" && !authority.isOwner
        ? "member"
        : authority.role,
    isOwner: authority.isOwner ?? false,
  }
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return Object.hasOwn(roles, value)
}

export function formatWorkspaceRole(role: MemberRoleName) {
  if (isWorkspaceRole(role)) return workspaceRoleLabels[role]
  return role // custom roles display their given name
}

export function getWorkspaceRolePosition(role: MemberRoleName) {
  if (isWorkspaceRole(role)) return workspaceRolePositions[role]
  return CUSTOM_ROLE_POSITION
}

export function getWorkspaceAuthorityPosition(authority: WorkspaceAuthority) {
  const normalizedAuthority = normalizeWorkspaceAuthority(authority)
  if (normalizedAuthority.isOwner) return workspaceRolePositions.owner
  return getWorkspaceRolePosition(normalizedAuthority.role)
}

export function canManageWorkspaceAuthority(
  actor: WorkspaceAuthority,
  target: WorkspaceAuthority
) {
  const normalizedActor = normalizeWorkspaceAuthority(actor)
  const normalizedTarget = normalizeWorkspaceAuthority(target)

  if (normalizedTarget.isOwner) {
    return normalizedActor.isOwner
  }

  return (
    getWorkspaceAuthorityPosition(normalizedActor) <
    getWorkspaceAuthorityPosition(normalizedTarget)
  )
}

function grantsHavePermissions(
  grantedStatements: Record<string, readonly string[] | undefined>,
  requestedPermissions: PermissionRequest
) {
  for (const [resource, actions] of Object.entries(requestedPermissions)) {
    if (!actions || actions.length === 0) continue

    const grantedActionSet = new Set(grantedStatements[resource] ?? [])

    for (const action of actions) {
      if (!grantedActionSet.has(action)) {
        return false
      }
    }
  }

  return true
}

export function roleHasPermissions(
  role: WorkspaceRole,
  requestedPermissions: PermissionRequest
) {
  return grantsHavePermissions(
    roles[role].statements as Record<string, readonly string[] | undefined>,
    requestedPermissions
  )
}

export function workspaceAuthorityHasPermissions(
  authority: WorkspaceAuthority,
  requestedPermissions: PermissionRequest
) {
  const normalizedAuthority = normalizeWorkspaceAuthority(authority)
  if (normalizedAuthority.isOwner) return true
  // Static role names shadow same-named custom roles (better-auth semantics)
  if (isWorkspaceRole(normalizedAuthority.role)) {
    return roleHasPermissions(normalizedAuthority.role, requestedPermissions)
  }
  if (!normalizedAuthority.customGrants) return false
  return grantsHavePermissions(
    normalizedAuthority.customGrants,
    requestedPermissions
  )
}

// Approval-policy resolver (LOR-81): who may resolve a gated agent action —
// a role, a specific person, or anyone (teams later). Deliberately NOT a
// permission grant: resolver authority is named per gate, never blanket.
// Mirrors approval_policy.resolver_kind — kept in sync with @repo/db.
export type ApprovalResolverSpec =
  | { kind: "role"; role: MemberRoleName }
  | { kind: "user"; userId: string }
  | { kind: "any_member" }

// An approval_policy row's resolver columns, as read from the DB or the wire.
export type ApprovalResolverPolicy = {
  resolverKind: ApprovalResolverSpec["kind"]
  resolverRole: string | null
  resolverUserId: string | null
}

// Policy row → resolver spec. Null when the named resolver dangles (custom
// role deleted, resolver user removed): the gate fails closed to owner-only
// rather than silently opening up.
export function approvalPolicyResolverSpec(
  policy: ApprovalResolverPolicy
): ApprovalResolverSpec | null {
  switch (policy.resolverKind) {
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

// An approval row's resolver. No target (Lor asked on its own) or no policy
// row (the gate was turned off while the approval was open) lets any member
// resolve.
export function approvalResolverSpecFor(
  target: string | null,
  policy: ApprovalResolverPolicy | null
): ApprovalResolverSpec | null {
  if (!target || !policy) return { kind: "any_member" }
  return approvalPolicyResolverSpec(policy)
}

// Serialized resolver spec as clients receive it (role/userId optional).
export type ApprovalResolverSpecInput = {
  kind: ApprovalResolverSpec["kind"]
  role?: string | null
  userId?: string | null
}

// Client-side mirror of the server's fallback: a dangling or malformed named
// resolver normalizes to null (owner-only).
export function normalizeApprovalResolverSpec(
  resolver: ApprovalResolverSpecInput | null
): ApprovalResolverSpec | null {
  if (resolver === null) return null
  switch (resolver.kind) {
    case "any_member":
      return { kind: "any_member" }
    case "role":
      return resolver.role ? { kind: "role", role: resolver.role } : null
    case "user":
      return resolver.userId ? { kind: "user", userId: resolver.userId } : null
  }
}

// Plain-words note for people who can't resolve an approval: who can.
export function approvalResolverLabel(
  resolver: ApprovalResolverSpecInput | null,
  resolverUserName: string | null
): string {
  if (!resolver) return "Only the workspace owner can resolve this"
  switch (resolver.kind) {
    case "any_member":
      return "Anyone in this channel can resolve this"
    case "role":
      return `Needs the ${resolver.role ?? "configured"} role`
    case "user":
      return `Waiting on ${resolverUserName ?? "a specific person"}`
  }
}

// Owner always resolves (escape hatch when a named resolver left the
// workspace). Channel write access is the separate floor, enforced by the
// resolve handler. Role match is exact — admin does not bypass.
export function canResolveApproval(
  authority: WorkspaceAuthority,
  spec: ApprovalResolverSpec,
  userId: string
) {
  const normalizedAuthority = normalizeWorkspaceAuthority(authority)
  if (normalizedAuthority.isOwner) return true
  switch (spec.kind) {
    case "any_member":
      return true
    case "role":
      return normalizedAuthority.role === spec.role
    case "user":
      return userId === spec.userId
  }
}

// workspace_role.permission stores JSON.stringify(Record<resource, action[]>)
// (better-auth dynamic access control). Null on any malformed value.
export function parseRolePermission(value: string): CustomRoleGrants | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  const grants: Record<string, string[]> = {}
  for (const [resource, actions] of Object.entries(parsed)) {
    if (!Array.isArray(actions)) return null
    if (actions.some((action) => typeof action !== "string")) return null
    grants[resource] = actions
  }
  return grants
}

export function getWorkspaceMessageRateLimit(role: MemberRoleName) {
  if (isWorkspaceRole(role)) return workspaceMessageRateLimitsPerMinute[role]
  return workspaceMessageRateLimitsPerMinute.member
}

export {
  workspaceStatementMeta,
  workspaceStatements,
} from "./workspace-statements"

export {
  ac,
  admin,
  assignableWorkspaceRoles,
  CUSTOM_ROLE_POSITION,
  member,
  owner,
  roles,
  statement,
  workspaceMessageRateLimitsPerMinute,
  workspaceRoleLabels,
  workspaceRolePositions,
}
