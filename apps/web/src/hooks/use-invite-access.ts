import { authClient } from "@repo/auth/client"
import { useQuery } from "@tanstack/react-query"
import {
  toCustomRoleMap,
  useAssignableRoleOptions,
  useWorkspaceRoles,
} from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import { canInviteMembers } from "@/lib/permissions"

// Who may invite (admins+) and which roles they may invite as. The role comes
// from the slug-scoped members list, not getActiveMember, which can still
// answer for the previous workspace mid-switch.
export function useInviteAccess(workspaceSlug: string | undefined) {
  const { data: session } = authClient.useSession()
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
  const me = members?.members.find(
    (member) => member.userId === session?.user.id
  )
  const { data: workspaceRoles } = useWorkspaceRoles(members?.workspaceId)
  const roleOptions = useAssignableRoleOptions(
    me,
    members?.ownerId,
    workspaceRoles
  )
  const canInvite =
    !!me &&
    !!members &&
    canInviteMembers(
      me,
      { ownerId: members.ownerId },
      toCustomRoleMap(workspaceRoles)
    )

  return { canInvite, workspaceId: members?.workspaceId, roleOptions }
}
