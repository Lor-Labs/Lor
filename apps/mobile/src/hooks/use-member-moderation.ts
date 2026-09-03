import {
  type AssignableWorkspaceRole,
  assignableWorkspaceRoles,
  canManageWorkspaceAuthority,
  getWorkspaceAuthorityPosition,
  getWorkspaceRolePosition,
  workspaceAuthorityHasPermissions,
} from "@repo/auth/permissions"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useToast } from "heroui-native/toast"
import { useCallback, useMemo } from "react"
import { useActiveMember } from "@/hooks/use-active-member"
import { api } from "@/lib/api"

export type ModerationTarget = {
  id: string
  isBot?: boolean
  role?: string | null
}

// Moderation gating mirrors the server (permissions.ts in apps/api): actions
// the sheet offers must never 403 — hierarchy, self, and bot checks all run
// client-side first.
export function useMemberModeration({
  currentUserId,
  workspaceId,
  workspaceSlug,
}: {
  currentUserId?: string
  workspaceId?: string
  workspaceSlug: string
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const activeMember = useActiveMember(workspaceId)
  const activeRole = activeMember.data?.role
  const actorRole = typeof activeRole === "string" ? activeRole : null

  // Deduped with useWorkspaceMembers — only read for ownerId, since
  // ownership derives from workspace.ownerId, never the role string.
  const { data: memberList } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    enabled: Boolean(workspaceSlug),
    queryFn: async () => {
      const response = await api.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!response.ok) throw new Error("Could not load workspace members")
      return response.json()
    },
  })
  const ownerId = memberList?.ownerId ?? null

  // Custom-role actors resolve to member-tier here — mobile doesn't fetch
  // custom-role grants yet (see reference/mobile-parity-todo.md); the server
  // enforces real grants regardless.
  const actorAuthority = useMemo(
    () =>
      actorRole && currentUserId
        ? {
            role: actorRole,
            isOwner: Boolean(ownerId && currentUserId === ownerId),
          }
        : null,
    [actorRole, currentUserId, ownerId]
  )

  const canManage = useCallback(
    (target: ModerationTarget) => {
      if (!actorAuthority || !currentUserId) return false
      if (target.isBot || target.id === currentUserId) return false
      if (typeof target.role !== "string") return false
      return canManageWorkspaceAuthority(actorAuthority, {
        role: target.role,
        isOwner: Boolean(ownerId && target.id === ownerId),
      })
    },
    [actorAuthority, currentUserId, ownerId]
  )

  const roleOptionsFor = useCallback(
    (target: ModerationTarget): AssignableWorkspaceRole[] => {
      if (!actorAuthority || !canManage(target)) return []
      if (
        !workspaceAuthorityHasPermissions(actorAuthority, {
          workspaceMember: ["role:update"],
        })
      ) {
        return []
      }
      // Server rule: non-owners can assign roles at their own position or
      // below (admins can promote to admin).
      const actorPosition = getWorkspaceAuthorityPosition(actorAuthority)
      return assignableWorkspaceRoles.filter(
        (role) =>
          role !== target.role &&
          (actorAuthority.isOwner ||
            getWorkspaceRolePosition(role) >= actorPosition)
      )
    },
    [actorAuthority, canManage]
  )

  const canKick = useCallback(
    (target: ModerationTarget) => {
      if (!actorAuthority || !canManage(target)) return false
      return workspaceAuthorityHasPermissions(actorAuthority, {
        workspaceMember: ["kick"],
      })
    },
    [actorAuthority, canManage]
  )

  const canModerate = useCallback(
    (target: ModerationTarget) =>
      canKick(target) || roleOptionsFor(target).length > 0,
    [canKick, roleOptionsFor]
  )

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["workspace-members", workspaceSlug],
    })
  }

  const roleMutation = useMutation({
    mutationFn: async (input: {
      userId: string
      role: AssignableWorkspaceRole
    }) => {
      const response = await api.v1.workspaces[":workspaceSlug"].members[
        ":userId"
      ].role.$patch({
        param: { workspaceSlug, userId: input.userId },
        json: { role: input.role },
      })
      if (!response.ok) throw new Error("Could not update role")
    },
    onSuccess: async () => {
      await invalidateMembers()
      toast.show({ variant: "success", label: "Role updated" })
    },
    onError: () => {
      toast.show({ variant: "danger", label: "Couldn't update role" })
    },
  })

  const kickMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await api.v1.workspaces[":workspaceSlug"].members[
        ":userId"
      ].kick.$post({
        param: { workspaceSlug, userId },
      })
      if (!response.ok) throw new Error("Could not kick member")
    },
    onSuccess: async () => {
      await invalidateMembers()
      toast.show({ variant: "success", label: "Member kicked" })
    },
    onError: () => {
      toast.show({ variant: "danger", label: "Couldn't kick member" })
    },
  })

  return {
    canKick,
    canModerate,
    changeRole: roleMutation.mutate,
    isBusy: roleMutation.isPending || kickMutation.isPending,
    kick: kickMutation.mutate,
    roleOptionsFor,
  }
}
