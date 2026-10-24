import {
  CheckListIcon,
  FolderAddIcon,
  GridViewIcon,
  HashtagIcon,
  HelpCircleIcon,
  Message01Icon,
  PlusSignIcon,
  Settings05Icon,
  Tick02Icon,
  UnfoldMoreIcon,
  UserAdd02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
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
  useSidebar,
} from "@repo/ui/components/sidebar"
import { Skeleton } from "@repo/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { features } from "@repo/utils/features"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HintPopover } from "@/components/hints/hint-popover"
import { useHint } from "@/components/hints/hints-provider"
import { CreateInviteDialog } from "@/components/invite/create-invite-dialog"
import { ChannelActivityProvider } from "@/components/sidebar/channel-panel/channel-activity"
import { ChannelList } from "@/components/sidebar/channel-panel/channel-list"
import {
  CreateChannelProvider,
  useCreateChannel,
} from "@/components/sidebar/channel-panel/create-channel-context"
import { VoicePresenceProvider } from "@/components/sidebar/channel-panel/voice-presence"
import { WorkspaceCommand } from "@/components/sidebar/channel-panel/workspace-command"
import { NewSessionButton } from "@/components/sidebar/new-session-button"
import {
  sidebarMenuHeader,
  sidebarMenuIcon,
  sidebarMenuRow,
  sidebarMenuSeparator,
  sidebarMenuSubTrigger,
  sidebarMenuSurface,
} from "@/components/sidebar/sidebar-menu-styles"
import { InstructionsApprovalAlert } from "@/components/workspace/instructions-approval-alert"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import {
  toSectionId,
  WorkspaceSettingsDialog,
} from "@/components/workspace/workspace-settings-dialog"
import { useBillingUpdates } from "@/hooks/use-billing-updates"
import { useInviteAccess } from "@/hooks/use-invite-access"
import { useSettings } from "@/hooks/use-settings"
import { useWorkspaceSetup } from "@/hooks/use-workspace-setup"
import { apiClient } from "@/lib/api-client"
import { writeLastWorkspaceSlug } from "@/lib/last-location"
import { canCreateChannels, isAdminOrOwner } from "@/lib/permissions"

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
  const { openCreateChannel, openCreateCategory } = useCreateChannel()
  const { target, tab, open: openSettings, close, setTab } = useSettings()
  const [inviteOpen, setInviteOpen] = useState(false)
  const { canInvite } = useInviteAccess(workspaceSlug)
  const { status: setupStatus } = useWorkspaceSetup(workspaceSlug ?? "")

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
  const createButtonRef = useRef<HTMLSpanElement>(null)
  const { isMobile, open: sidebarOpen, openMobile } = useSidebar()
  const channelsHint = useHint(
    "channels_intro",
    canCreate && (isMobile ? openMobile : sidebarOpen)
  )

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
                className={sidebarMenuSurface}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className={sidebarMenuHeader}>
                    <WorkspaceAvatar
                      name={activeWorkspace?.name ?? "Lor"}
                      logo={activeWorkspace?.logo}
                      className="size-7 rounded-lg text-xs"
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
                  <DropdownMenuSeparator className={sidebarMenuSeparator} />
                  <DropdownMenuItem
                    className={sidebarMenuRow}
                    onClick={() => openSettings("workspace")}
                    disabled={!activeWorkspace}
                  >
                    <HugeiconsIcon
                      icon={Settings05Icon}
                      className={sidebarMenuIcon}
                      strokeWidth={1.5}
                    />
                    Workspace settings
                  </DropdownMenuItem>
                  {canInvite && (
                    <DropdownMenuItem
                      className={sidebarMenuRow}
                      onClick={() => setInviteOpen(true)}
                      disabled={!activeWorkspace}
                    >
                      <HugeiconsIcon
                        icon={UserAdd02Icon}
                        className={sidebarMenuIcon}
                        strokeWidth={1.5}
                      />
                      Invite people
                    </DropdownMenuItem>
                  )}
                  {workspaceSlug && setupStatus === "open" && (
                    <DropdownMenuItem
                      className={sidebarMenuRow}
                      onClick={() =>
                        navigate({
                          to: "/$workspaceSlug/setup",
                          params: { workspaceSlug },
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={CheckListIcon}
                        className={sidebarMenuIcon}
                        strokeWidth={1.5}
                      />
                      Finish setup
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className={sidebarMenuRow}
                    onClick={() =>
                      navigate({
                        to: ".",
                        search: (prev) => ({ ...prev, intro: true }),
                      })
                    }
                  >
                    <HugeiconsIcon
                      icon={HelpCircleIcon}
                      className={sidebarMenuIcon}
                      strokeWidth={1.5}
                    />
                    How Lor works
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator className={sidebarMenuSeparator} />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={sidebarMenuSubTrigger}>
                    <HugeiconsIcon
                      icon={GridViewIcon}
                      className={sidebarMenuIcon}
                      strokeWidth={1.5}
                    />
                    Switch workspace
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    sideOffset={6}
                    className={sidebarMenuSurface}
                  >
                    {workspaces?.map((ws) => {
                      const isActive = ws.slug === activeWorkspace?.slug
                      return (
                        <DropdownMenuItem
                          key={ws.id}
                          className={sidebarMenuRow}
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
                    <DropdownMenuSeparator className={sidebarMenuSeparator} />
                    <DropdownMenuItem
                      className={sidebarMenuRow}
                      onClick={() => void navigate({ to: "/onboarding" })}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        className={sidebarMenuIcon}
                        strokeWidth={1.5}
                      />
                      Create workspace
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            {features.directMessages && (
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
                  <HugeiconsIcon
                    icon={Message01Icon}
                    size={18}
                    strokeWidth={2}
                  />
                </TooltipTrigger>
                <TooltipContent>Direct messages</TooltipContent>
              </Tooltip>
            )}
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="flex min-w-0 items-center gap-1.5 pt-3 pb-1">
          <div className="min-w-0 flex-1">
            <WorkspaceCommand />
          </div>
          {canCreate && (
            <span ref={createButtonRef} className="flex">
              <DropdownMenu
                onOpenChange={(open) => {
                  if (open) channelsHint.dismiss()
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Create"
                            className="size-8 rounded-md border-border bg-background text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground sm:size-8 data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
                          />
                        }
                      />
                    }
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="size-3.5 opacity-100"
                      strokeWidth={1.75}
                    />
                  </TooltipTrigger>
                  <TooltipContent>Create</TooltipContent>
                </Tooltip>
                <DropdownMenuContent
                  align="end"
                  sideOffset={6}
                  className="w-44"
                >
                  <DropdownMenuItem onClick={() => openCreateChannel()}>
                    <HugeiconsIcon
                      icon={HashtagIcon}
                      className="size-4 mr-2"
                      strokeWidth={2}
                    />
                    New channel
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openCreateCategory}>
                    <HugeiconsIcon
                      icon={FolderAddIcon}
                      className="size-4 mr-2"
                    />
                    New category
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )}
          <HintPopover
            open={channelsHint.show}
            anchor={createButtonRef}
            side="right"
            align="start"
            onDismiss={channelsHint.dismiss}
          >
            Your starting channels. Rename, reorder, or add channels here.
          </HintPopover>
        </div>
        <NewSessionButton />
        {workspaceSlug && (
          <InstructionsApprovalAlert
            workspaceSlug={workspaceSlug}
            onReview={openInstructionsReview}
          />
        )}
      </SidebarHeader>

      <SidebarContent hideScrollbar={isTauri}>
        <SidebarGroup className="min-h-0 flex-1 pt-1">
          {/* Clip sideways only: a vertical clip here cut the list at the
              window height, so SidebarContent's scroll area never scrolled. */}
          <div className="-mx-2 overflow-x-clip">
            <ChannelActivityProvider workspaceId={activeWorkspace?.id}>
              <VoicePresenceProvider
                workspaceSlug={activeWorkspace?.slug}
                workspaceId={activeWorkspace?.id}
              >
                <ChannelList />
              </VoicePresenceProvider>
            </ChannelActivityProvider>
          </div>
        </SidebarGroup>
      </SidebarContent>

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
