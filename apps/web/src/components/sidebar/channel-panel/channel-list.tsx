import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Archive02Icon,
  ArrowDown01Icon,
  Folder01Icon,
  Folder02Icon,
  HashtagIcon,
  Loading03Icon,
  PlusSignIcon,
  SquareLock02Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@repo/ui/components/context-menu"
import { MentionBadge } from "@repo/ui/components/mention-badge"
import { Skeleton } from "@repo/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useMemo, useState } from "react"
import { ArchiveProjectDialog } from "@/components/project/archive-project-dialog"
import {
  SessionStateIndicator,
  strongestSessionState,
  useChannelActivity,
} from "@/components/sidebar/channel-panel/channel-activity"
import {
  ChannelSessionRows,
  SessionCollapseToggle,
  useSessionCollapse,
} from "@/components/sidebar/channel-panel/channel-sessions"
import { useCreateChannel } from "@/components/sidebar/channel-panel/create-channel-context"
import { DeleteChannelDialog } from "@/components/sidebar/channel-panel/delete-channel-dialog"
import { EditChannelDialog } from "@/components/sidebar/channel-panel/edit-channel-dialog"
import { VoiceParticipantRows } from "@/components/sidebar/channel-panel/voice-presence"
import {
  sidebarRow,
  sidebarRowHover,
  sidebarRowMarkIn,
  sidebarRowSelected,
  sidebarSectionLabel,
} from "@/components/sidebar/sidebar-menu-styles"
import { PrivateHashIcon } from "@/components/ui/private-hash-icon"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import { useUnread } from "@/context/unread-context"
import { useNewIds } from "@/hooks/use-appended-ids"
import { useChannelCreated } from "@/hooks/use-channel-created"
import { MUTE_DURATIONS, useChannelMutes } from "@/hooks/use-channel-mutes"
import { useOpenChannelSessions } from "@/hooks/use-open-channel-sessions"
import { usePrefetchChannels } from "@/hooks/use-prefetch-channels"
import { useProjectUpdates } from "@/hooks/use-project-updates"
import { apiClient } from "@/lib/api-client"
import type { Channel, ListChannelsResponse } from "@/lib/api-types"
import {
  canCreateChannels,
  canDeleteChannels,
  canManageChannels,
} from "@/lib/permissions"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

type ChannelMuteControls = ReturnType<typeof useChannelMutes>

const channelIcons = {
  text: HashtagIcon,
  voice: VolumeHighIcon,
} as const

type ChannelData = ListChannelsResponse

function ChannelIcon({
  type,
  isPrivate = false,
}: {
  type: string
  isPrivate?: boolean
}) {
  // Standalone private channels wear the hash+lock glyph (voice: plain lock);
  // project channels don't — the project boundary communicates the audience.
  if (isPrivate) {
    if (type === "text") {
      return <PrivateHashIcon className="size-4 shrink-0 opacity-50" />
    }
    return (
      <HugeiconsIcon
        icon={SquareLock02Icon}
        className="size-4 shrink-0 opacity-50"
        strokeWidth={2}
      />
    )
  }
  const icon = channelIcons[type as keyof typeof channelIcons] ?? HashtagIcon
  return (
    <HugeiconsIcon
      icon={icon}
      className="size-4 shrink-0 opacity-50"
      strokeWidth={2}
    />
  )
}

function ChannelListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex items-center gap-2 px-2 py-[6px]">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>
        ))}
      </div>
      <div>
        <div className="flex items-center gap-0.5 px-1 pb-1">
          <Skeleton className="h-3 w-20 rounded" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex items-center gap-2 px-2 py-[6px]">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-28 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

function buildReorderPayload(data: ChannelData) {
  const channels: { id: string; position: number; parentId: string | null }[] =
    []

  data.uncategorized.forEach((ch, i) => {
    channels.push({ id: ch.id, position: i, parentId: null })
  })

  data.categories.forEach((cat, ci) => {
    channels.push({ id: cat.id, position: ci, parentId: null })
    cat.channels.forEach((ch, i) => {
      channels.push({ id: ch.id, position: i, parentId: cat.id })
    })
  })

  return channels
}

export function ChannelList() {
  const { workspaceSlug, channelId: activeChannelId } = useParams({
    strict: false,
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setOpen: closeMobileSidebar } = useMobileSidebar()

  const { data, isPending } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug ?? "")
  )
  usePrefetchChannels(workspaceSlug ?? "", data)

  const reorderMutation = useMutation({
    mutationFn: async (
      channels: { id: string; position: number; parentId: string | null }[]
    ) => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].channels.reorder.$patch({
        param: { workspaceSlug: workspaceSlug as string },
        json: { channels },
      })
      if (!res.ok) {
        throw new Error("Failed to reorder channels")
      }
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceSlug] })
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

  const permissionCtx =
    activeMember && workspaceMembersData?.ownerId
      ? {
          actor: activeMember,
          workspace: { ownerId: workspaceMembersData.ownerId },
        }
      : null

  const canCreate = permissionCtx
    ? canCreateChannels(permissionCtx.actor, permissionCtx.workspace)
    : false
  const canManage = permissionCtx
    ? canManageChannels(permissionCtx.actor, permissionCtx.workspace)
    : false
  const canDelete = permissionCtx
    ? canDeleteChannels(permissionCtx.actor, permissionCtx.workspace)
    : false

  const { openCreateChannel } = useCreateChannel()
  // One query + socket listener for the whole list; rows get the controls via props.
  const muteControls = useChannelMutes()
  // Live refetch on project archive start/finish (spinner → Archived section).
  useProjectUpdates(workspaceSlug)
  // Channels created elsewhere (a teammate, a proposal apply) appear live.
  useChannelCreated(workspaceSlug)

  // Projects render distinctly (folder disclosure + dashed boundary); match
  // category ids against the project list so public projects get it too.
  const { data: projectsData } = useQuery({
    queryKey: ["projects", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects.$get(
        { param: { workspaceSlug: workspaceSlug as string } }
      )
      if (!res.ok) throw new Error("Failed to fetch projects")
      return res.json()
    },
    enabled: !!workspaceSlug,
  })
  const projectByCategoryId = useMemo(
    () =>
      new Map(
        (projectsData?.projects ?? []).map((p) => [p.categoryChannelId, p])
      ),
    [projectsData]
  )
  const projectCategoryIds = useMemo(
    () => new Set(projectByCategoryId.keys()),
    [projectByCategoryId]
  )
  const channelIds = useMemo(
    () =>
      data
        ? [
            ...data.uncategorized,
            ...data.categories.flatMap((cat) => cat.channels),
          ].map((ch) => ch.id)
        : [],
    [data]
  )
  const newChannelIds = useNewIds(channelIds)

  const [activeItem, setActiveItem] = useState<{
    channel: Channel
    isCategory: boolean
  } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const findChannel = useCallback(
    (id: string): { channel: Channel; isCategory: boolean } | null => {
      if (!data) return null
      for (const ch of data.uncategorized) {
        if (ch.id === id) return { channel: ch, isCategory: false }
      }
      for (const cat of data.categories) {
        if (cat.id === id) return { channel: cat, isCategory: true }
        for (const ch of cat.channels) {
          if (ch.id === id) return { channel: ch, isCategory: false }
        }
      }
      return null
    },
    [data]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const found = findChannel(event.active.id as string)
      setActiveItem(found ? { ...found } : null)
    },
    [findChannel]
  )

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!data) return
      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeItem = findChannel(active.id as string)
      const overItem = findChannel(over.id as string)
      if (!activeItem || !overItem) return

      // Category-to-category: reorder optimistically
      if (activeItem.isCategory && overItem.isCategory) {
        queryClient.setQueryData(
          ["channels", workspaceSlug],
          (old: ChannelData | undefined) => {
            if (!old) return old
            const newData = structuredClone(old)
            const oldIdx = newData.categories.findIndex(
              (c) => c.id === active.id
            )
            const newIdx = newData.categories.findIndex((c) => c.id === over.id)
            if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
              const moved = newData.categories.splice(oldIdx, 1)[0]
              if (moved) newData.categories.splice(newIdx, 0, moved)
            }
            return newData
          }
        )
        return
      }

      // Don't allow dragging categories onto channels
      if (activeItem.isCategory) return

      // Project channels stay inside their project: block cross-container
      // drags touching a project (server enforces the same; this gives
      // immediate feedback instead of a failed mutation).
      const activeContainer = activeItem.channel.parentId
      // Determine the target container
      const overContainer = overItem.isCategory
        ? (over.id as string)
        : overItem.channel.parentId

      if (
        activeContainer !== overContainer &&
        ((activeContainer && projectCategoryIds.has(activeContainer)) ||
          (overContainer && projectCategoryIds.has(overContainer)))
      ) {
        return
      }

      // If moving between containers, update optimistically
      if (activeContainer !== overContainer) {
        queryClient.setQueryData(
          ["channels", workspaceSlug],
          (old: ChannelData | undefined) => {
            if (!old) return old
            const newData = structuredClone(old)
            const activeChannel = active.id as string

            // Remove from source
            if (activeContainer === null) {
              newData.uncategorized = newData.uncategorized.filter(
                (ch) => ch.id !== activeChannel
              )
            } else {
              const srcCat = newData.categories.find(
                (c) => c.id === activeContainer
              )
              if (srcCat) {
                srcCat.channels = srcCat.channels.filter(
                  (ch) => ch.id !== activeChannel
                )
              }
            }

            // Find the channel data
            const chData = activeItem.channel

            // Add to destination
            if (overContainer === null) {
              const overIdx = newData.uncategorized.findIndex(
                (ch) => ch.id === over.id
              )
              newData.uncategorized.splice(
                overIdx >= 0 ? overIdx : newData.uncategorized.length,
                0,
                { ...chData, parentId: null }
              )
            } else {
              const destCat = newData.categories.find(
                (c) => c.id === overContainer
              )
              if (destCat) {
                const overIdx = destCat.channels.findIndex(
                  (ch) => ch.id === over.id
                )
                destCat.channels.splice(
                  overIdx >= 0 ? overIdx : destCat.channels.length,
                  0,
                  { ...chData, parentId: overContainer }
                )
              }
            }

            return newData
          }
        )
      }
    },
    [data, findChannel, workspaceSlug, queryClient, projectCategoryIds]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null)
      const { active, over } = event
      if (!over || !data || active.id === over.id) return

      const draggedItem = findChannel(active.id as string)
      const overItem = findChannel(over.id as string)
      if (!draggedItem || !overItem) return

      let newData: ChannelData | undefined
      queryClient.setQueryData(
        ["channels", workspaceSlug],
        (old: ChannelData | undefined) => {
          if (!old) return old
          const updated = structuredClone(old)

          if (!draggedItem.isCategory) {
            // Reorder within same container
            const container = draggedItem.channel.parentId
            if (container === null) {
              const oldIdx = updated.uncategorized.findIndex(
                (c) => c.id === active.id
              )
              const newIdx = updated.uncategorized.findIndex(
                (c) => c.id === over.id
              )
              if (oldIdx >= 0 && newIdx >= 0) {
                const moved = updated.uncategorized.splice(oldIdx, 1)[0]
                if (moved) updated.uncategorized.splice(newIdx, 0, moved)
              }
            } else {
              const cat = updated.categories.find((c) => c.id === container)
              if (cat) {
                const oldIdx = cat.channels.findIndex((c) => c.id === active.id)
                const newIdx = cat.channels.findIndex((c) => c.id === over.id)
                if (oldIdx >= 0 && newIdx >= 0) {
                  const moved = cat.channels.splice(oldIdx, 1)[0]
                  if (moved) cat.channels.splice(newIdx, 0, moved)
                }
              }
            }
          }

          newData = updated
          return updated
        }
      )

      if (newData) {
        reorderMutation.mutate(buildReorderPayload(newData))
      }
    },
    [data, findChannel, workspaceSlug, queryClient, reorderMutation]
  )

  if (isPending) {
    return <ChannelListSkeleton />
  }

  if (!data) {
    return null
  }

  const isEmpty =
    data.uncategorized.length === 0 && data.categories.length === 0

  // Archived projects drop out of the live tree into a muted, collapsed
  // section — still readable, no longer in the way. Projects still archiving
  // stay in place with a spinner until the worker finishes.
  const isArchivedProject = (categoryId: string) =>
    projectByCategoryId.get(categoryId)?.status === "archived"
  const activeCategories = data.categories.filter(
    (cat) => !isArchivedProject(cat.id)
  )
  const archivedCategories = data.categories.filter((cat) =>
    isArchivedProject(cat.id)
  )

  if (isEmpty) {
    return (
      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
        <p>No channels yet.</p>
        <p>Create one to get started.</p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <nav aria-label="Channels" className="space-y-3">
        {/* Uncategorized channels */}
        {data.uncategorized.length > 0 && (
          <SortableContext
            items={data.uncategorized.map((ch) => ch.id)}
            strategy={verticalListSortingStrategy}
            disabled={!canManage}
          >
            <div>
              {data.uncategorized.map((ch) => (
                <SortableChannelItem
                  key={ch.id}
                  channel={ch}
                  active={activeChannelId === ch.id}
                  arrived={newChannelIds.has(ch.id)}
                  canManage={canManage}
                  canDelete={canDelete}
                  muteControls={muteControls}
                  onClick={() => {
                    navigate({
                      to: "/$workspaceSlug/$channelId",
                      params: {
                        workspaceSlug: workspaceSlug as string,
                        channelId: ch.id,
                      },
                    })
                    closeMobileSidebar(false)
                  }}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/* Categories with children */}
        <SortableContext
          items={activeCategories.map((cat) => cat.id)}
          strategy={verticalListSortingStrategy}
          disabled={!canManage}
        >
          {activeCategories.map((cat) => (
            <SortableCategorySection
              key={cat.id}
              id={cat.id}
              name={cat.name ?? ""}
              isProject={projectCategoryIds.has(cat.id)}
              projectId={projectByCategoryId.get(cat.id)?.id ?? null}
              projectStatus={projectByCategoryId.get(cat.id)?.status ?? null}
              onOpenOverview={() => {
                const project = projectByCategoryId.get(cat.id)
                if (!project) return
                navigate({
                  to: "/$workspaceSlug/project/$projectId",
                  params: {
                    workspaceSlug: workspaceSlug as string,
                    projectId: project.id,
                  },
                })
                closeMobileSidebar(false)
              }}
              channels={cat.channels}
              newChannelIds={newChannelIds}
              draggingCategory={activeItem?.isCategory ?? false}
              activeChannelId={activeChannelId}
              canCreate={canCreate}
              canManage={canManage}
              canDelete={canDelete}
              muteControls={muteControls}
              onChannelClick={(channelId) => {
                navigate({
                  to: "/$workspaceSlug/$channelId",
                  params: {
                    workspaceSlug: workspaceSlug as string,
                    channelId,
                  },
                })
                closeMobileSidebar(false)
              }}
              onCreateChannel={(parentId) => openCreateChannel(parentId)}
            />
          ))}
        </SortableContext>

        {archivedCategories.length > 0 && (
          <ArchivedProjectsSection
            categories={archivedCategories}
            activeChannelId={activeChannelId}
            onProjectClick={(categoryId) => {
              const project = projectByCategoryId.get(categoryId)
              if (!project) return
              navigate({
                to: "/$workspaceSlug/project/$projectId",
                params: {
                  workspaceSlug: workspaceSlug as string,
                  projectId: project.id,
                },
              })
              closeMobileSidebar(false)
            }}
            onChannelClick={(channelId) => {
              navigate({
                to: "/$workspaceSlug/$channelId",
                params: {
                  workspaceSlug: workspaceSlug as string,
                  channelId,
                },
              })
              closeMobileSidebar(false)
            }}
          />
        )}
      </nav>

      <DragOverlay>
        {activeItem && (
          <div className="rounded-lg bg-background shadow-lg">
            {activeItem.isCategory ? (
              <div
                className={cn(
                  sidebarSectionLabel,
                  "flex items-center gap-1 px-1 py-1"
                )}
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-3 shrink-0"
                  strokeWidth={2}
                />
                <span className="truncate">
                  {activeItem.channel.name ?? ""}
                </span>
              </div>
            ) : (
              <ChannelItem
                name={activeItem.channel.name ?? ""}
                type={activeItem.channel.type}
              />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function SortableCategorySection({
  id,
  name,
  isProject = false,
  projectId = null,
  projectStatus = null,
  onOpenOverview,
  channels,
  newChannelIds,
  draggingCategory,
  activeChannelId,
  canCreate,
  canManage,
  canDelete,
  muteControls,
  onChannelClick,
  onCreateChannel,
}: {
  id: string
  name: string
  isProject?: boolean
  projectId?: string | null
  projectStatus?: "active" | "archiving" | "archived" | null
  onOpenOverview?: () => void
  channels: Channel[]
  newChannelIds: ReadonlySet<string>
  draggingCategory: boolean
  activeChannelId?: string
  canCreate: boolean
  canManage: boolean
  canDelete: boolean
  muteControls: ChannelMuteControls
  onChannelClick?: (channelId: string) => void
  onCreateChannel?: (parentId: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const { openProjectMembers } = useCreateChannel()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !canManage })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const categoryAsChannel = {
    id,
    name,
    type: "category" as const,
  } as Channel

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        // Projects read as a bounded container: dashed border around the
        // whole group, folder disclosure instead of a chevron.
        isProject &&
          "rounded-lg border border-dashed border-sidebar-border px-1 pt-1 pb-0.5"
      )}
    >
      {/* Right-click for the category's options (managers only). */}
      <ContextMenu disabled={!canManage} onOpenChange={setMenuOpen}>
        <ContextMenuTrigger className="group/category flex w-full items-center gap-0.5 px-1 pb-1">
          {isProject && projectStatus === "archiving" && (
            // The header routes to the overview while archiving, so collapse
            // needs its own affordance.
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand project" : "Collapse project"}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <motion.div
                animate={{ rotate: collapsed ? -90 : 0 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-3 shrink-0"
                  strokeWidth={2}
                />
              </motion.div>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              // An archiving project's header opens the live overview — the
              // synthesis progress lives there, not in a collapsed tree.
              if (projectStatus === "archiving" && onOpenOverview) {
                onOpenOverview()
                return
              }
              setCollapsed(!collapsed)
            }}
            {...(canManage ? { ...attributes, ...listeners } : {})}
            className={cn(
              sidebarSectionLabel,
              "flex flex-1 cursor-pointer items-center gap-1",
              menuOpen && "text-foreground"
            )}
          >
            {isProject ? (
              projectStatus === "archiving" ? (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="mr-1 size-3.5 shrink-0 animate-spin"
                  strokeWidth={2}
                />
              ) : (
                <HugeiconsIcon
                  icon={collapsed ? Folder01Icon : Folder02Icon}
                  className="mr-1 size-3.5 shrink-0"
                  strokeWidth={2}
                />
              )
            ) : (
              <motion.div
                animate={{ rotate: collapsed ? -90 : 0 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  className="size-3 shrink-0"
                  strokeWidth={2}
                />
              </motion.div>
            )}
            <span className="truncate">{name}</span>
          </button>
          {canCreate && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onCreateChannel?.(id)}
                    aria-label="Create channel"
                    className="text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground group-hover/category:opacity-100 focus-visible:opacity-100"
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              </TooltipTrigger>
              <TooltipContent>Create channel</TooltipContent>
            </Tooltip>
          )}
        </ContextMenuTrigger>
        <ContextMenuPopup align="start">
          {isProject && (
            <>
              <ContextMenuItem onClick={() => openProjectMembers(id)}>
                Members
              </ContextMenuItem>
              {projectId && projectStatus === "active" && (
                <ContextMenuItem onClick={() => setArchiveOpen(true)}>
                  Archive Project
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={() => setEditOpen(true)}>
            Edit Category
          </ContextMenuItem>
          {canDelete && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                Delete Category
              </ContextMenuItem>
            </>
          )}
        </ContextMenuPopup>
      </ContextMenu>
      <EditChannelDialog
        channel={categoryAsChannel}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteChannelDialog
        channel={categoryAsChannel}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      {projectId && (
        <ArchiveProjectDialog
          projectId={projectId}
          projectName={name}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
        />
      )}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <SortableContext
              items={channels.map((ch) => ch.id)}
              strategy={verticalListSortingStrategy}
              disabled={!canManage || draggingCategory}
            >
              {channels.map((ch) => (
                <SortableChannelItem
                  key={ch.id}
                  channel={ch}
                  active={activeChannelId === ch.id}
                  arrived={newChannelIds.has(ch.id)}
                  canManage={canManage}
                  canDelete={canDelete}
                  muteControls={muteControls}
                  onClick={() => onChannelClick?.(ch.id)}
                />
              ))}
            </SortableContext>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Archived projects: collapsed by default, muted, read-only — no dnd, no
// management menus. The project row opens the archived overview; channels
// stay navigable (history is preserved).
function ArchivedProjectsSection({
  categories,
  activeChannelId,
  onProjectClick,
  onChannelClick,
}: {
  categories: ChannelData["categories"]
  activeChannelId?: string
  onProjectClick: (categoryId: string) => void
  onChannelClick: (channelId: string) => void
}) {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="border-t border-sidebar-border pt-2">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          sidebarSectionLabel,
          "flex w-full cursor-pointer items-center gap-1 px-1 pb-1 text-muted-foreground/70"
        )}
      >
        <motion.div
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.15, ease: EASE_OUT }}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-3 shrink-0"
            strokeWidth={2}
          />
        </motion.div>
        <span className="truncate">Archived</span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className="space-y-2 overflow-hidden"
          >
            {categories.map((cat) => (
              <div key={cat.id} className="opacity-70">
                <button
                  type="button"
                  onClick={() => onProjectClick(cat.id)}
                  className={cn(
                    sidebarSectionLabel,
                    "flex w-full cursor-pointer items-center gap-1 px-1 pb-1"
                  )}
                >
                  <HugeiconsIcon
                    icon={Archive02Icon}
                    className="mr-1 size-3.5 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="truncate">{cat.name}</span>
                </button>
                {cat.channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => onChannelClick(ch.id)}
                    className={cn(
                      sidebarRow,
                      "w-full cursor-pointer rounded-lg text-left",
                      activeChannelId === ch.id
                        ? sidebarRowSelected
                        : sidebarRowHover
                    )}
                  >
                    <ChannelItem
                      name={ch.name ?? ""}
                      type={ch.type}
                      active={activeChannelId === ch.id}
                    />
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SortableChannelItem({
  channel: ch,
  active = false,
  arrived = false,
  canManage,
  canDelete,
  muteControls,
  onClick,
}: {
  channel: Channel
  active?: boolean
  arrived?: boolean
  canManage: boolean
  canDelete: boolean
  muteControls: ChannelMuteControls
  onClick?: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ch.id, disabled: !canManage })

  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const openChannelSessions = useOpenChannelSessions()

  // Creators may rename their own channel and change its topic.
  const { data: session } = authClient.useSession()
  const isCreator = !!ch.creatorId && ch.creatorId === session?.user.id
  const canEdit = canManage || isCreator

  const { getUnreadCount, getMentionCount } = useUnread()
  const { getMute, muteChannel, unmuteChannel } = muteControls
  const mute = getMute(ch.id)
  const unreadCount = active ? 0 : getUnreadCount(ch.id)
  const mentionCount = active ? 0 : getMentionCount(ch.id)
  const hasUnread = unreadCount > 0
  const activity = useChannelActivity(ch.id)
  const sessions = activity?.sessions ?? []
  const sessionCollapse = useSessionCollapse(ch.id, activity?.sessions)
  // A collapsed channel shows the strongest state of its hidden sessions.
  const rollup = sessionCollapse.collapsed
    ? strongestSessionState(sessions)
    : undefined

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <>
      <div ref={setNodeRef} style={style}>
        {/* Right-click for the channel's options. */}
        <ContextMenu onOpenChange={setMenuOpen}>
          <ContextMenuTrigger
            className={cn(
              sidebarRow,
              // A channel created while you watch fades in. The fade sits on
              // this row: on the sortable wrapper it would override the drag
              // transform.
              arrived && "fade-in-0 animate-in duration-300",
              "group/channel relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-[6px] text-[14px]",
              active || menuOpen ? sidebarRowSelected : sidebarRowHover,
              active && "font-medium text-foreground",
              !active && hasUnread && "font-medium text-foreground",
              !active && !hasUnread && "text-muted-foreground"
            )}
          >
            {active && (
              <div
                className={cn(
                  sidebarRowMarkIn,
                  "absolute inset-y-0 left-0 my-auto h-4 w-[3px] rounded-r-full bg-primary"
                )}
              />
            )}
            {!active && hasUnread && (
              <div
                className={cn(
                  sidebarRowMarkIn,
                  "absolute inset-y-0 left-0 my-auto size-1 -translate-x-1/2 rounded-full bg-foreground"
                )}
              />
            )}
            <ChannelIcon
              type={ch.type}
              isPrivate={ch.audience === "members" && ch.parentId === null}
            />
            <button
              type="button"
              onClick={onClick}
              {...(canManage ? { ...attributes, ...listeners } : {})}
              aria-current={active ? "page" : undefined}
              className="min-w-0 flex-1 cursor-pointer truncate text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/50 active:opacity-100"
            >
              {ch.name}
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <MentionBadge count={mentionCount} />
              {rollup && <SessionStateIndicator state={rollup} />}
              {sessions.length > 0 && (
                <SessionCollapseToggle
                  collapsed={sessionCollapse.collapsed}
                  onToggle={sessionCollapse.toggle}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuPopup align="start">
            {mute ? (
              <ContextMenuItem onClick={() => unmuteChannel(ch.id)}>
                Unmute Channel
              </ContextMenuItem>
            ) : (
              <ContextMenuSub>
                <ContextMenuSubTrigger>Mute Channel</ContextMenuSubTrigger>
                <ContextMenuSubPopup>
                  {MUTE_DURATIONS.map((duration) => (
                    <ContextMenuItem
                      key={duration.label}
                      onClick={() =>
                        muteChannel({
                          channelId: ch.id,
                          minutes: duration.minutes,
                        })
                      }
                    >
                      {duration.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubPopup>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
            {ch.type === "text" && (
              <ContextMenuItem onClick={() => openChannelSessions(ch.id)}>
                View Sessions
              </ContextMenuItem>
            )}
            {canEdit && (
              <ContextMenuItem onClick={() => setEditOpen(true)}>
                Edit Channel
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={() => void navigator.clipboard.writeText(ch.id)}
            >
              Copy Channel ID
            </ContextMenuItem>
            {canDelete && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete Channel
                </ContextMenuItem>
              </>
            )}
          </ContextMenuPopup>
        </ContextMenu>
        {ch.type === "voice" && (
          <VoiceParticipantRows channelId={ch.id} channelName={ch.name ?? ""} />
        )}
        <ChannelSessionRows
          channelId={ch.id}
          sessions={sessions}
          collapsed={sessionCollapse.collapsed}
        />
      </div>
      {canEdit && (
        <EditChannelDialog
          channel={ch}
          open={editOpen}
          onOpenChange={setEditOpen}
          overviewOnly={!canManage}
        />
      )}
      {canDelete && (
        <DeleteChannelDialog
          channel={ch}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  )
}

function ChannelItem({
  name,
  type,
  active = false,
}: {
  name: string
  type: string
  active?: boolean
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 rounded-lg px-2 py-[6px] text-[14px]",
        active ? "font-medium text-foreground" : "text-muted-foreground"
      )}
    >
      <ChannelIcon type={type} />
      <span className="truncate">{name}</span>
    </div>
  )
}
