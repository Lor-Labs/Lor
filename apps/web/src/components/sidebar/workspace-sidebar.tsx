import {
  Folder02Icon,
  FolderAddIcon,
  GridViewIcon,
  HashtagIcon,
  Message01Icon,
  PlusSignIcon,
  Settings05Icon,
  Tick02Icon,
  UnfoldMoreIcon,
  UserAdd02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@repo/ui/components/sidebar"
import { Skeleton } from "@repo/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CreateInviteDialog } from "@/components/invite/create-invite-dialog"
import { ChannelList } from "@/components/sidebar/channel-panel/channel-list"
import {
  CreateChannelProvider,
  useCreateChannel,
} from "@/components/sidebar/channel-panel/create-channel-context"
import { WorkspaceCommand } from "@/components/sidebar/channel-panel/workspace-command"
import { CreateWorkspaceDialog } from "@/components/sidebar/create-workspace-dialog"
import { InstructionsApprovalAlert } from "@/components/workspace/instructions-approval-alert"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import {
  toSectionId,
  WorkspaceSettingsDialog,
} from "@/components/workspace/workspace-settings-dialog"
import { useBillingUpdates } from "@/hooks/use-billing-updates"
import { useSettings } from "@/hooks/use-settings"
import { apiClient } from "@/lib/api-client"
import { writeLastWorkspaceSlug } from "@/lib/last-location"
import { canCreateChannels, isAdminOrOwner } from "@/lib/permissions"

const workspaceMenuSurface =
  "rounded-xl border-foreground/8 shadow-[0_8px_32px_-8px_rgb(0_0_0/0.16),0_2px_8px_-2px_rgb(0_0_0/0.08)] motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:data-starting-style:translate-y-1 data-starting-style:opacity-0 data-ending-style:opacity-0 [&>div]:p-1.5"
const workspaceMenuRow =
  "min-h-9 gap-2.5 rounded-md px-2.5 py-1 text-[13px] sm:min-h-8 sm:text-[13px]"
const workspaceMenuIcon = "size-4 text-muted-foreground opacity-100"

/**
 * Full standalone workspace sidebar (Sidebar shell + content). Kept for
 * any caller that wants a self-contained sidebar.
 */
export function WorkspaceSidebar() {
  return (
    <Sidebar variant="inset">
      <WorkspaceSidebarContent />
    </Sidebar>
  )
}

/**
 * Inner content only (SidebarHeader + SidebarContent + SidebarFooter).
 * Designed to be hosted inside a Sidebar shell provided by the caller —
 * lets `sidebar/index.tsx` host both the workspace and DM content under
 * a single Sidebar so we can animate the swap.
 */
export function WorkspaceSidebarContent() {
  return (
    <CreateChannelProvider>
      <WorkspaceSidebarInner />
    </CreateChannelProvider>
  )
}

function WorkspaceSidebarInner() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const { openCreateChannel, openCreateCategory, openCreateProject } =
    useCreateChannel()
  const { target, tab, open: openSettings, close, setTab } = useSettings()
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const settingsOpen = target === "workspace"
  const settingsSection = toSectionId(tab)
  // Stable so InstructionsApprovalAlert's socket-subscription effect doesn't
  // re-run on every sidebar render.
  const openInstructionsReview = useCallback(
    () => openSettings("workspace", "instructions"),
    [openSettings]
  )

  const { data: workspaces, isPending } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      if (res.error) throw res.error
      return res.data
    },
  })

  const activeWorkspace = useMemo(() => {
    if (!workspaces) return undefined
    if (!workspaceSlug) return workspaces[0]
    return workspaces.find((w) => w.slug === workspaceSlug)
  }, [workspaces, workspaceSlug])

  // Permission gating for the Create dropdown. Same queries the
  // ChannelList consumes — react-query dedupes so this is free.
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

  const { data: workspaceMembersData } = useQuery({
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

  const canCreate =
    activeMember && workspaceMembersData?.ownerId
      ? canCreateChannels(activeMember, {
          ownerId: workspaceMembersData.ownerId,
        })
      : false

  useBillingUpdates(
    activeWorkspace?.id,
    activeMember && workspaceMembersData?.ownerId
      ? isAdminOrOwner(activeMember, { ownerId: workspaceMembersData.ownerId })
      : false
  )

  // Remember the active workspace so the DM view's "back" affordance
  // can return here.
  useEffect(() => {
    if (!workspaceSlug) return
    writeLastWorkspaceSlug(workspaceSlug)
  }, [workspaceSlug])

  return (
    <>
      <SidebarHeader className="gap-1 p-0 pb-1">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-popup-open:bg-sidebar-accent"
                    tooltip={activeWorkspace?.name ?? "Workspace"}
                  />
                }
              >
                <WorkspaceAvatar
                  name={activeWorkspace?.name ?? "Lor"}
                  logo={activeWorkspace?.logo}
                  className="size-8 rounded-lg text-sm"
                  imgClassName="rounded-md"
                />
                <div className="flex min-w-0 flex-1 items-center text-left text-sm leading-tight">
                  {isPending ? (
                    <Skeleton className="h-3.5 w-24 rounded" />
                  ) : (
                    <span className="truncate font-semibold">
                      {activeWorkspace?.name ?? "Lor"}
                    </span>
                  )}
                </div>
                <HugeiconsIcon
                  icon={UnfoldMoreIcon}
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={6}
                className={`w-[max(18rem,var(--anchor-width))] max-w-(--available-width) ${workspaceMenuSurface}`}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-2.5 px-2.5 py-1.5">
                    <WorkspaceAvatar
                      name={activeWorkspace?.name ?? "Lor"}
                      logo={activeWorkspace?.logo}
                      className="size-8 rounded-lg bg-foreground/4 text-xs ring-1 ring-foreground/5"
                      imgClassName="rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-[13px] text-foreground">
                        {activeWorkspace?.name ?? "Workspace"}
                      </div>
                      <div className="mt-0.5 font-normal text-[11px] text-muted-foreground">
                        Workspace
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    className={workspaceMenuRow}
                    onClick={() => openSettings("workspace")}
                    disabled={!activeWorkspace}
                  >
                    <HugeiconsIcon
                      icon={Settings05Icon}
                      className={workspaceMenuIcon}
                      strokeWidth={1.5}
                    />
                    Workspace settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={workspaceMenuRow}
                    onClick={() => setInviteOpen(true)}
                    disabled={!activeWorkspace}
                  >
                    <HugeiconsIcon
                      icon={UserAdd02Icon}
                      className={workspaceMenuIcon}
                      strokeWidth={1.5}
                    />
                    Invite people
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className="mx-2.5 my-1 bg-foreground/6" />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    className={`${workspaceMenuRow} [&>svg:last-child]:size-3.5 [&>svg:last-child]:text-muted-foreground/60 [&>svg:last-child]:[stroke-width:1.5]`}
                  >
                    <HugeiconsIcon
                      icon={GridViewIcon}
                      className={workspaceMenuIcon}
                      strokeWidth={1.5}
                    />
                    Switch workspace
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    sideOffset={6}
                    className={`w-64 max-w-(--available-width) ${workspaceMenuSurface}`}
                  >
                    {workspaces?.map((ws) => {
                      const isActive = ws.slug === activeWorkspace?.slug
                      return (
                        <DropdownMenuItem
                          key={ws.id}
                          className={workspaceMenuRow}
                          onClick={() => {
                            if (isActive) return
                            void navigate({
                              to: "/$workspaceSlug",
                              params: { workspaceSlug: ws.slug },
                            })
                          }}
                        >
                          <WorkspaceAvatar
                            name={ws.name}
                            logo={ws.logo}
                            className="size-6 rounded-md text-[10px]"
                            imgClassName="rounded-[3px]"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {ws.name}
                          </span>
                          {isActive && (
                            <HugeiconsIcon
                              icon={Tick02Icon}
                              className="ml-auto size-3.5 text-primary"
                              strokeWidth={1.5}
                            />
                          )}
                        </DropdownMenuItem>
                      )
                    })}
                    <DropdownMenuSeparator className="mx-2.5 my-1 bg-foreground/6" />
                    <DropdownMenuItem
                      className={workspaceMenuRow}
                      onClick={() => setCreateWorkspaceOpen(true)}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        className={workspaceMenuIcon}
                        strokeWidth={1.5}
                      />
                      Create workspace
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Direct messages"
                    onClick={() => {
                      void navigate({ to: "/dms" })
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  />
                }
              >
                <HugeiconsIcon icon={Message01Icon} size={18} strokeWidth={2} />
              </TooltipTrigger>
              <TooltipContent>Direct messages</TooltipContent>
            </Tooltip>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="flex min-w-0 items-center gap-1.5 pt-3 pb-1">
          <div className="min-w-0 flex-1">
            <WorkspaceCommand />
          </div>
          {canCreate && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Create"
                          className="text-muted-foreground hover:text-foreground data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
                        />
                      }
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                </TooltipTrigger>
                <TooltipContent>Create</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" sideOffset={6} className="w-64">
                <DropdownMenuItem onClick={() => openCreateChannel()}>
                  <HugeiconsIcon
                    icon={HashtagIcon}
                    className="size-4 mr-2"
                    strokeWidth={2}
                  />
                  New channel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openCreateCategory}>
                  <HugeiconsIcon icon={FolderAddIcon} className="size-4 mr-2" />
                  New category
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openCreateProject}>
                  <HugeiconsIcon
                    icon={Folder02Icon}
                    className="size-4 mr-2 self-start mt-0.5"
                    strokeWidth={2}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span>New project</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      Channels scoped to one unit of work
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {workspaceSlug && (
          <InstructionsApprovalAlert
            workspaceSlug={workspaceSlug}
            onReview={openInstructionsReview}
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1 pt-1">
          <div className="-mx-2 min-h-0 flex-1 overflow-hidden">
            <ChannelList />
          </div>
        </SidebarGroup>
      </SidebarContent>

      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
      />
      {activeWorkspace && (
        <WorkspaceSettingsDialog
          open={settingsOpen}
          onOpenChange={(o) => (o ? openSettings("workspace") : close())}
          workspace={activeWorkspace}
          section={settingsSection}
          onSectionChange={setTab}
        />
      )}
      <CreateInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </>
  )
}
