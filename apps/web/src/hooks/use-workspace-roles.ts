import { authClient } from "@repo/auth/client"
import {
  assignableWorkspaceRoles,
  getWorkspaceAuthorityPosition,
  getWorkspaceRolePosition,
  parseRolePermission,
} from "@repo/auth/permissions"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import type { CustomRoleMap } from "@/lib/permissions"

export type WorkspaceCustomRole = {
  id: string
  role: string
  grants: NonNullable<ReturnType<typeof parseRolePermission>> | null
}

export const workspaceRolesQueryKey = (workspaceId: string | undefined) =>
  ["workspace-roles", workspaceId] as const

// Custom roles (better-auth dynamic access control). Static roles never
// appear here — they live in @repo/auth/permissions.
export function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceRolesQueryKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: async (): Promise<WorkspaceCustomRole[]> => {
      const res = await authClient.organization.listRoles({
        query: { organizationId: workspaceId as string },
      })
      if (res.error) {
        throw new Error(res.error.message ?? "Failed to load workspace roles")
      }
      const rows = res.data ?? []
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        grants: parseRolePermission(
          typeof row.permission === "string"
            ? row.permission
            : JSON.stringify(row.permission)
        ),
      }))
    },
  })
}

// Server rule mirror: non-owners can assign roles at their own position or
// below (admins can promote to admin; demotion stays hierarchy-gated).
export function useAssignableRoleOptions(
  actor: { userId: string; role: string } | null | undefined,
  ownerId: string | null | undefined,
  workspaceRoles: WorkspaceCustomRole[] | undefined
): string[] {
  return useMemo(() => {
    if (!actor || !ownerId) return []
    const actorIsOwner = actor.userId === ownerId
    const actorPosition = getWorkspaceAuthorityPosition({
      role: actor.role,
      isOwner: actorIsOwner,
    })
    const candidates = [
      ...assignableWorkspaceRoles,
      ...(workspaceRoles ?? []).map((role) => role.role),
    ]
    return candidates.filter(
      (role) => actorIsOwner || getWorkspaceRolePosition(role) >= actorPosition
    )
  }, [actor, ownerId, workspaceRoles])
}

export function toCustomRoleMap(
  roles: WorkspaceCustomRole[] | undefined
): CustomRoleMap {
  const map: CustomRoleMap = {}
  for (const role of roles ?? []) {
    if (role.grants) map[role.role] = role.grants
  }
  return map
}
