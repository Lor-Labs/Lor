import { authClient } from "@repo/auth/client"
import { isWorkspaceRole } from "@repo/auth/permissions"
import { useQuery } from "@tanstack/react-query"
import { toCustomRoleMap, useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import { canManageConnectors } from "@/lib/permissions"

export type WorkspaceSetupStatus = "loading" | "open" | "finished" | "no-access"

// First-run setup checklist: open while `setupCompletedAt` is null, and only
// for people who can manage connectors. The role comes from the slug-scoped
// members list, not getActiveMember, which can still answer for the previous
// workspace mid-switch.
export function useWorkspaceSetup(workspaceSlug: string) {
  const { data: session } = authClient.useSession()
  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      if (res.error) throw res.error
      return res.data
    },
  })
  const workspace = workspaces?.find((w) => w.slug === workspaceSlug)
  const isUnfinished = workspace ? !workspace.setupCompletedAt : false

  const members = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: isUnfinished,
  })
  const me = members.data?.members.find((m) => m.userId === session?.user.id)
  const customRole = me && !isWorkspaceRole(me.role) ? me.role : null
  const roles = useWorkspaceRoles(customRole ? workspace?.id : undefined)

  let status: WorkspaceSetupStatus = "loading"
  if (workspace && !isUnfinished) status = "finished"
  else if (members.isError || roles.isError || (members.data && !me)) {
    status = "no-access"
  } else if (members.data && me && (!customRole || roles.data)) {
    status = canManageConnectors(
      me,
      { ownerId: members.data.ownerId },
      toCustomRoleMap(roles.data)
    )
      ? "open"
      : "no-access"
  }

  return { status, workspace, members: members.data }
}
