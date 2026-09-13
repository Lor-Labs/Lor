import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { formatWorkspaceRole } from "@repo/auth/permissions"
import type {
  PresenceUserUpdate,
  WorkspaceMemberJoinedEvent,
} from "@repo/realtime-types"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { ScrollArea } from "@repo/ui/components/scroll-area"
import { Skeleton } from "@repo/ui/components/skeleton"
import { toast } from "@repo/ui/components/toast"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { LoopsOverviewSection } from "@/components/sidebar/right-panel/loops-overview-section"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { WorkspaceMembersSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { UserAvatar } from "@/components/ui/user-avatar"
import { UserProfilePopover } from "@/components/ui/user-profile-card"
import { useSocket } from "@/context/socket-context"
import {
  toCustomRoleMap,
  useAssignableRoleOptions,
  useWorkspaceRoles,
} from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type {
  ListWorkspaceMembersResponse,
  WorkspaceMemberPresence,
} from "@/lib/api-types"
import {
  canKickWorkspaceMembers,
  canManageWorkspaceMember,
  canUpdateMemberRoles,
} from "@/lib/permissions"

const statusStyles: Record<WorkspaceMemberPresence["status"], string> = {
  online: "bg-emerald-500",
  offline: "bg-muted-foreground/40",
}

const statusLabel: Record<WorkspaceMemberPresence["status"], string> = {
  online: "Online",
  offline: "Offline",
}

function formatRole(role: WorkspaceMemberPresence["role"]) {
  if (!role) return "Member"
  return formatWorkspaceRole(role)
}

type ModerationDialogState = {
  type: "kick"
  member: WorkspaceMemberPresence
} | null

function MembersSkeleton() {
  return (
    <div className="space-y-2 px-3 py-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          key={index}
          className="flex items-center gap-2 rounded-md px-1.5 py-1.5"
        >
          <Skeleton className="size-8 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function MemberRow({
  member,
  currentUserId,
  currentMember,
  ownerId,
  roleOptions,
  canUpdateRolesPermission,
  canKickPermission,
  onRoleChange,
  onKick,
  isBusy,
}: {
  member: WorkspaceMemberPresence
  currentUserId: string | null
  currentMember: { userId: string; role: string } | null
  ownerId: string | null
  roleOptions: string[]
  canUpdateRolesPermission: boolean
  canKickPermission: boolean
  onRoleChange: (member: WorkspaceMemberPresence, role: string) => void
  onKick: (member: WorkspaceMemberPresence) => void
  isBusy: boolean
}) {
  const workspaceCtx = ownerId ? { ownerId } : null

  const canManageTarget =
    currentMember &&
    workspaceCtx &&
    !member.isBot &&
    currentUserId !== member.userId
      ? canManageWorkspaceMember(
          currentMember,
          { userId: member.userId, role: member.role },
          workspaceCtx
        )
      : false

  const canUpdateRole =
    canManageTarget && canUpdateRolesPermission && roleOptions.length > 0
  const canKick = canKickPermission && canManageTarget

  const showActions = canUpdateRole || canKick

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-foreground/[0.04]">
      <UserProfilePopover
        align="start"
        avatarColor={member.avatarColor}
        side="left"
        userId={member.userId}
      >
        <button type="button" className="relative shrink-0 cursor-pointer">
          <UserAvatar
            avatarColor={member.avatarColor}
            name={member.name}
            src={member.image}
            size="sm"
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-[2px] border-card",
              statusStyles[member.status]
            )}
          />
        </button>
      </UserProfilePopover>
      <div className="min-w-0 flex-1">
        <UserProfilePopover
          align="start"
          avatarColor={member.avatarColor}
          side="left"
          userId={member.userId}
        >
          <button
            type="button"
            className="cursor-pointer truncate text-[13px] font-medium hover:underline"
          >
            {member.name}
          </button>
        </UserProfilePopover>
        <div className="truncate text-[11px] text-muted-foreground">
          {member.isOwner ? "Owner" : formatRole(member.role)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <span className="max-w-12 truncate text-[11px] text-muted-foreground">
          {statusLabel[member.status]}
        </span>
        {showActions && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={isBusy}
                />
              }
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                className="size-4"
                strokeWidth={2}
              />
              <span className="sr-only">Moderate member</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canUpdateRole && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Change Role</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={
                        roleOptions.includes(member.role)
                          ? member.role
                          : "member"
                      }
                      onValueChange={(value) => {
                        if (!roleOptions.includes(value)) return
                        onRoleChange(member, value)
                      }}
                    >
                      {roleOptions.map((role) => (
                        <DropdownMenuRadioItem key={role} value={role}>
                          {formatRole(role)}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {canKick && (
                <DropdownMenuItem onClick={() => onKick(member)}>
                  Kick member
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

export function WorkspaceMembersPanel({
  view,
}: {
  view: WorkspaceMembersSidebarView
}) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const { toggleCollapsed, clearView } = useRightSidebar()
  const isMobile = useIsMobile()
  const [moderationDialog, setModerationDialog] =
    useState<ModerationDialogState>(null)
  const queryKey = useMemo(
    () => ["workspace-members", view.workspaceSlug] as const,
    [view.workspaceSlug]
  )

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: view.workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const {
    data: activeMember,
    error: activeMemberError,
    isError: hasActiveMemberError,
  } = useQuery({
    queryKey: ["active-workspace-member", view.workspaceSlug],
    queryFn: async () => {
      const res = await authClient.organization.getActiveMember()
      if (res.error) {
        throw new Error(
          res.error.message ?? "Failed to verify moderation permissions"
        )
      }

      if (!res.data) {
        throw new Error("Failed to verify moderation permissions")
      }

      return res.data
    },
    enabled: !!view.workspaceSlug,
  })
  const workspaceId = data?.workspaceId
  const currentUserId = session?.user?.id ?? null
  const activeMemberRole =
    typeof activeMember?.role === "string" ? activeMember.role : null
  const currentMember =
    !hasActiveMemberError && currentUserId && activeMemberRole
      ? { userId: currentUserId, role: activeMemberRole }
      : null
  const ownerId = data?.ownerId ?? null

  const { data: workspaceRoles } = useWorkspaceRoles(workspaceId)
  const customRoles = useMemo(
    () => toCustomRoleMap(workspaceRoles),
    [workspaceRoles]
  )
  const workspaceCtx = ownerId ? { ownerId } : null
  const canUpdateRolesPermission =
    currentMember && workspaceCtx
      ? canUpdateMemberRoles(currentMember, workspaceCtx, customRoles)
      : false
  const canKickPermission =
    currentMember && workspaceCtx
      ? canKickWorkspaceMembers(currentMember, workspaceCtx, customRoles)
      : false
  const roleOptions = useAssignableRoleOptions(
    currentMember,
    ownerId,
    workspaceRoles
  )

  useEffect(() => {
    if (!hasActiveMemberError) return

    toast.error(
      activeMemberError instanceof Error
        ? activeMemberError.message
        : "Failed to verify moderation permissions"
    )
  }, [hasActiveMemberError, activeMemberError, view.workspaceSlug])

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }

  const updateRoleMutation = useMutation({
    mutationFn: async (input: { userId: string; role: string }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members[
        ":userId"
      ].role.$patch({
        param: { workspaceSlug: view.workspaceSlug, userId: input.userId },
        json: { role: input.role },
      })

      if (!res.ok) {
        throw new Error("Failed to update workspace member role")
      }

      return res.json()
    },
    onSuccess: async () => {
      await invalidateMembers()
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
        param: { workspaceSlug: view.workspaceSlug, userId },
      })

      if (!res.ok) {
        throw new Error("Failed to kick member")
      }
    },
    onSuccess: async () => {
      await invalidateMembers()
      setModerationDialog(null)
      toast.success("Member kicked")
    },
    onError: () => {
      toast.error("Failed to kick member")
    },
  })

  const isMutating = updateRoleMutation.isPending || kickMutation.isPending

  const handleRoleChange = (member: WorkspaceMemberPresence, role: string) => {
    if (member.role === role) return
    updateRoleMutation.mutate({ userId: member.userId, role })
  }

  const handleKick = (member: WorkspaceMemberPresence) => {
    setModerationDialog({ type: "kick", member })
  }

  const handleConfirmModeration = () => {
    if (!moderationDialog) return

    if (moderationDialog.type === "kick") {
      kickMutation.mutate(moderationDialog.member.userId)
    }
  }

  useEffect(() => {
    if (!socket || !workspaceId) return

    const applySnapshot = (onlineUserIds: string[]) => {
      const onlineSet = new Set(onlineUserIds)
      queryClient.setQueryData<ListWorkspaceMembersResponse>(
        queryKey,
        (current) => {
          if (!current) return current
          return {
            ...current,
            members: current.members.map((member) => ({
              ...member,
              // Bots (Lor) have no socket presence — keep them always online.
              status:
                member.isBot || onlineSet.has(member.userId)
                  ? "online"
                  : "offline",
            })),
          }
        }
      )
    }

    // Retry failed presence:subscribe acks (transient init/db errors on the
    // realtime server) so the member list can't stay stale until remount.
    let disposed = false
    let snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null

    const requestSnapshot = (attempt = 0) => {
      if (disposed || !workspaceId) return

      socket.emit("presence:subscribe", { workspaceId }, (result) => {
        if (disposed) return
        if (!result.ok) {
          if (attempt >= 3) return
          snapshotRetryTimer = setTimeout(
            () => requestSnapshot(attempt + 1),
            2000 * (attempt + 1)
          )
          return
        }
        applySnapshot(result.snapshot.onlineUserIds)
      })
    }

    const onPresenceReady = () => {
      requestSnapshot()
    }

    const onConnect = () => {
      requestSnapshot()
    }

    const onPresenceUpdate = (payload: PresenceUserUpdate) => {
      if (!workspaceId || payload.workspaceId !== workspaceId) return
      const nextStatus: WorkspaceMemberPresence["status"] =
        payload.status === "offline" ? "offline" : "online"

      queryClient.setQueryData<ListWorkspaceMembersResponse>(
        queryKey,
        (current) => {
          if (!current) return current
          return {
            ...current,
            members: current.members.map((member) =>
              member.userId === payload.userId && !member.isBot
                ? { ...member, status: nextStatus }
                : member
            ),
          }
        }
      )
    }

    const onMemberJoined = (payload: WorkspaceMemberJoinedEvent) => {
      if (!workspaceId || payload.workspaceId !== workspaceId) return
      // Refetch the full member list to get the new member with all fields
      queryClient.invalidateQueries({ queryKey })
    }

    socket.on("presence:ready", onPresenceReady)
    socket.on("connect", onConnect)
    socket.on("presence:user:update", onPresenceUpdate)
    socket.on("workspace:member:joined", onMemberJoined)

    if (socket.connected) {
      requestSnapshot()
    }

    return () => {
      disposed = true
      if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer)
      socket.off("presence:ready", onPresenceReady)
      socket.off("connect", onConnect)
      socket.off("presence:user:update", onPresenceUpdate)
      socket.off("workspace:member:joined", onMemberJoined)
    }
  }, [socket, workspaceId, queryClient, queryKey])

  const members = data?.members ?? []
  const onlineMembers = members.filter((member) => member.status !== "offline")
  const offlineMembers = members.filter((member) => member.status === "offline")
  const isModerationDialogOpen = moderationDialog !== null
  const moderationDialogTitle = "Kick member"
  const moderationDialogDescription = moderationDialog
    ? `Are you sure you want to kick ${moderationDialog.member.name} from this workspace? They can rejoin if invited again.`
    : ""
  const isModerationSubmitting =
    moderationDialog?.type === "kick" && kickMutation.isPending
  const moderationActionLabel = "Kick member"

  return (
    <>
      <div className="flex h-full w-full flex-col">
        {/* No title — the section labels (Loops / Online / Offline) say it;
            the bar just carries the collapse control. */}
        <div className="flex h-12 shrink-0 items-center justify-end px-4">
          <button
            type="button"
            onClick={isMobile ? clearView : toggleCollapsed}
            aria-label={
              isMobile ? "Close overview panel" : "Collapse overview panel"
            }
            className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <SidebarToggleIcon
              isOpen={true}
              className="size-4 -scale-x-100"
              strokeWidth={1.5}
            />
          </button>
        </div>

        {hasActiveMemberError && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            Unable to verify moderation permissions right now. Moderation
            actions are temporarily unavailable.
          </div>
        )}

        {/* Loops render regardless of the members query — a members
            fetch hiccup must not hide the channel's automations. */}
        <ScrollArea className="min-w-0 flex-1 overflow-x-hidden px-2 py-2">
          <div className="min-w-0 space-y-4 px-1 pb-3">
            <LoopsOverviewSection
              workspaceSlug={view.workspaceSlug}
              channelId={view.channelId}
            />
            {isPending ? (
              <MembersSkeleton />
            ) : isError ? (
              <div className="px-1 py-3 text-sm text-muted-foreground">
                Failed to load members.
              </div>
            ) : members.length === 0 ? (
              <div className="px-1 py-4 text-sm text-muted-foreground">
                No members found for this workspace.
              </div>
            ) : (
              <>
                {onlineMembers.length > 0 && (
                  <section>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Online - {onlineMembers.length}
                    </div>
                    <div className="space-y-0.5">
                      {onlineMembers.map((member) => (
                        <MemberRow
                          key={member.userId}
                          member={member}
                          currentUserId={currentUserId}
                          currentMember={currentMember}
                          ownerId={ownerId}
                          roleOptions={roleOptions}
                          canUpdateRolesPermission={canUpdateRolesPermission}
                          canKickPermission={canKickPermission}
                          onRoleChange={handleRoleChange}
                          onKick={handleKick}
                          isBusy={isMutating}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {offlineMembers.length > 0 && (
                  <section>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Offline - {offlineMembers.length}
                    </div>
                    <div className="space-y-0.5">
                      {offlineMembers.map((member) => (
                        <MemberRow
                          key={member.userId}
                          member={member}
                          currentUserId={currentUserId}
                          currentMember={currentMember}
                          ownerId={ownerId}
                          roleOptions={roleOptions}
                          canUpdateRolesPermission={canUpdateRolesPermission}
                          canKickPermission={canKickPermission}
                          onRoleChange={handleRoleChange}
                          onKick={handleKick}
                          isBusy={isMutating}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
      <AlertDialog
        open={isModerationDialogOpen}
        onOpenChange={(open) => {
          if (!open && isModerationSubmitting) {
            return
          }

          if (!open) {
            setModerationDialog(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{moderationDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {moderationDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" />}
              disabled={isModerationSubmitting}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={isModerationSubmitting}
              onClick={handleConfirmModeration}
            >
              {moderationActionLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
