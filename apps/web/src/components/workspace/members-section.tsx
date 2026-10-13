import { UserAdd01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Skeleton } from "@repo/ui/components/skeleton"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { CreateInviteDialog } from "@/components/invite/create-invite-dialog"
import { ManageInvitesDialog } from "@/components/invite/manage-invites-dialog"
import { UserAvatar } from "@/components/ui/user-avatar"
import {
  PILL_BUTTON,
  SETTINGS_SURFACE,
  SettingsAction,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  toCustomRoleMap,
  useAssignableRoleOptions,
  useWorkspaceRoles,
} from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type { WorkspaceMemberPresence } from "@/lib/api-types"
import {
  canInviteMembers,
  canKickWorkspaceMembers,
  canManageWorkspaceMember,
  canUpdateMemberRoles,
  formatWorkspaceRole,
} from "@/lib/permissions"

export function MembersSection({ workspaceSlug }: { workspaceSlug: string }) {
  const queryClient = useQueryClient()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageInvitesOpen, setManageInvitesOpen] = useState(false)
  const [kickTarget, setKickTarget] = useState<WorkspaceMemberPresence | null>(
    null
  )

  const membersQueryKey = ["workspace-members", workspaceSlug] as const
  const { data, isPending } = useQuery({
    queryKey: membersQueryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })

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
  })

  const ownerId = data?.ownerId ?? null
  const { data: workspaceRoles } = useWorkspaceRoles(data?.workspaceId)
  const customRoles = useMemo(
    () => toCustomRoleMap(workspaceRoles),
    [workspaceRoles]
  )

  const workspaceCtx = ownerId ? { ownerId } : null
  const canUpdateRolesPermission =
    activeMember && workspaceCtx
      ? canUpdateMemberRoles(activeMember, workspaceCtx, customRoles)
      : false
  const canKickPermission =
    activeMember && workspaceCtx
      ? canKickWorkspaceMembers(activeMember, workspaceCtx, customRoles)
      : false
  const canInvitePermission =
    activeMember && workspaceCtx
      ? canInviteMembers(activeMember, workspaceCtx, customRoles)
      : false

  const roleOptions = useAssignableRoleOptions(
    activeMember,
    ownerId,
    workspaceRoles
  )

  const roleItems = useMemo(
    () =>
      roleOptions.map((role) => ({
        value: role,
        label: formatWorkspaceRole(role),
      })),
    [roleOptions]
  )

  const updateRoleMutation = useMutation({
    mutationFn: async (input: { userId: string; role: string }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members[
        ":userId"
      ].role.$patch({
        param: { workspaceSlug, userId: input.userId },
        json: { role: input.role },
      })
      if (!res.ok) throw new Error("Failed to update workspace member role")
      return res.json()
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKey })
      toast.success("Role updated")
    },
    onError: () => {
      toast.error("Failed to update role")
    },
  })

  const kickMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members[
        ":userId"
      ].kick.$post({
        param: { workspaceSlug, userId },
      })
      if (!res.ok) throw new Error("Failed to kick member")
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: membersQueryKey })
      setKickTarget(null)
      toast.success("Member kicked")
    },
    onError: () => {
      toast.error("Failed to kick member")
    },
  })

  const isBusy = updateRoleMutation.isPending || kickMutation.isPending
  const members = data?.members ?? []

  return (
    <SettingsSection
      title="Members"
      count={isPending ? undefined : members.length}
      action={
        canInvitePermission && (
          <div className="flex items-center gap-3">
            <SettingsAction onClick={() => setManageInvitesOpen(true)}>
              Manage invites
            </SettingsAction>
            <Button
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              onClick={() => setInviteOpen(true)}
            >
              <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} />
              Invite
            </Button>
          </div>
        )
      }
    >
      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
              key={index}
              className={cn(
                SETTINGS_SURFACE,
                "flex items-center gap-3 px-3 py-2.5"
              )}
            >
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-32 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => {
            const canManageTarget =
              activeMember &&
              workspaceCtx &&
              !member.isBot &&
              activeMember.userId !== member.userId
                ? canManageWorkspaceMember(
                    activeMember,
                    { userId: member.userId, role: member.role },
                    workspaceCtx
                  )
                : false
            const canChangeRole =
              canManageTarget &&
              canUpdateRolesPermission &&
              roleOptions.length > 0
            const canKick = canKickPermission && canManageTarget

            return (
              <div
                key={member.userId}
                className={cn(
                  SETTINGS_SURFACE,
                  "flex items-center gap-3 px-3 py-2.5"
                )}
              >
                <UserAvatar
                  avatarColor={member.avatarColor}
                  name={member.name}
                  src={member.image}
                  size="sm"
                />
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {member.name}
                  </span>
                  {member.isBot && (
                    <Badge variant="outline" size="sm" className="shrink-0">
                      Bot
                    </Badge>
                  )}
                </div>
                {member.isOwner ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    Owner
                  </span>
                ) : canChangeRole ? (
                  <Select
                    items={roleItems}
                    value={
                      roleOptions.includes(member.role) ? member.role : "member"
                    }
                    onValueChange={(value) => {
                      if (typeof value !== "string") return
                      if (!roleOptions.includes(value)) return
                      if (value === member.role) return
                      updateRoleMutation.mutate({
                        userId: member.userId,
                        role: value,
                      })
                    }}
                    disabled={isBusy}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role}>
                          {formatWorkspaceRole(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {formatWorkspaceRole(member.role)}
                  </span>
                )}
                {canKick && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      PILL_BUTTON,
                      "px-3 text-destructive hover:text-destructive"
                    )}
                    disabled={isBusy}
                    onClick={() => setKickTarget(member)}
                  >
                    Kick
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <CreateInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ManageInvitesDialog
        open={manageInvitesOpen}
        onOpenChange={setManageInvitesOpen}
      />

      <AlertDialog
        open={kickTarget !== null}
        onOpenChange={(open) => {
          if (!open && !kickMutation.isPending) setKickTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kick member</AlertDialogTitle>
            <AlertDialogDescription>
              {kickTarget
                ? `Are you sure you want to kick ${kickTarget.name} from this workspace? They can rejoin if invited again.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={kickMutation.isPending}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={kickMutation.isPending}
              onClick={() => {
                if (kickTarget) kickMutation.mutate(kickTarget.userId)
              }}
            >
              Kick member
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
