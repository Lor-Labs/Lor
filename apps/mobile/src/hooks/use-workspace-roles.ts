import { parseRolePermission } from "@repo/auth/permissions"
import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"

export type WorkspaceCustomRole = {
  id: string
  role: string
  grants: NonNullable<ReturnType<typeof parseRolePermission>> | null
}

// Custom roles (better-auth dynamic access control), mirroring web's hook —
// same query key shape so the caches behave alike.
export function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-roles", workspaceId],
    enabled: Boolean(workspaceId),
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
