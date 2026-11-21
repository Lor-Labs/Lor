import { authClient } from "@repo/auth/client"
import { useQuery } from "@tanstack/react-query"
import { toCustomRoleMap, useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import { canManageChannels } from "@/lib/permissions"

// channel:update, read from the same cached queries as the channel list,
// custom roles included.
export function useCanManageChannels(workspaceSlug: string | undefined) {
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? {
            userId: res.data.userId as string,
            role: res.data.role as string,
          }
        : null
    },
    enabled: !!workspaceSlug,
  })
  const { data: members } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug,
  })
  const { data: roles } = useWorkspaceRoles(members?.workspaceId)
  return activeMember && members?.ownerId
    ? canManageChannels(
        activeMember,
        { ownerId: members.ownerId },
        toCustomRoleMap(roles)
      )
    : false
}
