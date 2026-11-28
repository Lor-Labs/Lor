import {
  Archive02Icon,
  ArchiveRestoreIcon,
  Delete02Icon,
  DiscordIcon,
  FilterHorizontalIcon,
  Layers01Icon,
  Notification01Icon,
  NotificationOff01Icon,
  PinIcon,
  PinOffIcon,
  Settings01Icon,
  SquareLock02Icon,
  ViewOffSlashIcon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { LOR_USER_ID } from "@repo/db/constants"
import type { AgentNeed } from "@repo/realtime-types"
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
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/menu"
import { Skeleton } from "@repo/ui/components/skeleton"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelActivity } from "@/components/sidebar/channel-panel/channel-activity"
import { ChannelSessionRows } from "@/components/sidebar/channel-panel/channel-sessions"
import { DeleteChannelDialog } from "@/components/sidebar/channel-panel/delete-channel-dialog"
import {
  EditChannelDialog,
  type EditChannelTab,
} from "@/components/sidebar/channel-panel/edit-channel-dialog"
import { ChatAvatar } from "@/components/sidebar/chat-panel/chat-avatar"
import {
  sidebarRowMarkIn,
  sidebarSectionLabel,
} from "@/components/sidebar/sidebar-menu-styles"
import { useMobileSidebar } from "@/context/mobile-sidebar-context"
import { useUnread } from "@/context/unread-context"
import {
  agentCreature,
  useAgentsById,
  useAgentsUpdates,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { useChannelCreated } from "@/hooks/use-channel-created"
import { MUTE_DURATIONS, useChannelMutes } from "@/hooks/use-channel-mutes"
import { useChatArchive } from "@/hooks/use-chat-archive"
import {
  type Chat,
  chatActivityAt,
  chatsKey,
  orderChats,
  useArchivedChats,
  useChatListUpdates,
  useChats,
  usePlaceChats,
  useUpdateChat,
} from "@/hooks/use-chats"
import { apiClient } from "@/lib/api-client"
import type { Channel } from "@/lib/api-types"
import { chatDisplayName } from "@/lib/chat-name"
import { canDeleteChannels, canManageChannels } from "@/lib/permissions"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels-query"

// The sidebar's chats (reference/agents-and-chats.md, decisions 33, 35 and
// 36): the ones this person pinned, then the rest by last message, each
// with its code sessions under it. A chat is a text channel; its row, name
// and agents come from the channels query, and who is in it, its last
// message and the pin from the chats one. The filter at the top adds the
// archived chats, greyed (decision 52), and the Discord channels agents are
// in (decision 51), among the rest.

// What the list adds is this person's choice per workspace, kept across
// reloads: archived chats, and places (the Discord channels agents are in).
type ChatFilter = { archived: boolean; places: boolean }
const filterKey = (workspaceSlug: string, kind: keyof ChatFilter) =>
  kind === "archived"
    ? `lor:show-archived-chats:${workspaceSlug}`
    : `lor:show-places:${workspaceSlug}`

function useChatFilter(workspaceSlug: string | undefined) {
  const [filter, setFilter] = useState<ChatFilter>({
    archived: false,
    places: false,
  })
  useEffect(() => {
    if (!workspaceSlug) return
    const read = (kind: keyof ChatFilter) => {
      try {
        return localStorage.getItem(filterKey(workspaceSlug, kind)) === "1"
      } catch {
        return false
      }
    }
    setFilter({ archived: read("archived"), places: read("places") })
  }, [workspaceSlug])
  const set = (kind: keyof ChatFilter, on: boolean) => {
    setFilter((prev) => ({ ...prev, [kind]: on }))
    if (!workspaceSlug) return
    try {
      if (on) localStorage.setItem(filterKey(workspaceSlug, kind), "1")
      else localStorage.removeItem(filterKey(workspaceSlug, kind))
    } catch {}
  }
  return [filter, set] as const
}

const SPRING = { type: "spring", bounce: 0, duration: 0.4 } as const
const DAY_MS = 86_400_000

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long" })
const DATE = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

// When a chat was last active, as a chat list says it: the time today,
// then Yesterday, the weekday within a week, else the date.
function chatTime(iso: string) {
  const at = new Date(iso)
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const days = Math.ceil((midnight.getTime() - at.getTime()) / DAY_MS)
  if (days <= 0) return TIME.format(at)
  if (days === 1) return "Yesterday"
  if (days < 7) return WEEKDAY.format(at)
  return DATE.format(at)
}

type MuteControls = ReturnType<typeof useChannelMutes>

function ChatListSkeleton() {
  return (
    <div className="space-y-1 pt-2">
      {["a", "b", "c", "d", "e"].map((key) => (
        <div key={key} className="flex items-center gap-2.5 px-2 py-1.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-24 rounded" />
            <Skeleton className="h-3 w-40 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ChatList({ workspaceId }: { workspaceId?: string }) {
  const { workspaceSlug, channelId: activeChannelId } = useParams({
    strict: false,
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion()
  const { setOpen: closeMobileSidebar } = useMobileSidebar()
  const { data: session } = authClient.useSession()
  const me = session?.user.id

  const { data: chats, isPending } = useChats(workspaceSlug)
  const [filter, setFilter] = useChatFilter(workspaceSlug)
  const { data: archivedChats } = useArchivedChats(
    workspaceSlug,
    filter.archived
  )
  const { data: placeChats } = usePlaceChats(workspaceSlug, filter.places)
  const { unarchive } = useChatArchive(workspaceSlug ?? "")
  const { data: channelData } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug ?? "")
  )
  const agentsById = useAgentsById(workspaceSlug)
  const muteControls = useChannelMutes()
  const updateChat = useUpdateChat(workspaceSlug)
  useChatListUpdates(workspaceSlug, workspaceId)
  // Chats made elsewhere, and agents renamed or moved, show live.
  useChannelCreated(workspaceSlug)
  useAgentsUpdates(workspaceSlug)

  const channels = useMemo(
    () =>
      new Map(
        channelData
          ? [
              ...channelData.uncategorized,
              ...channelData.categories.flatMap((cat) => cat.channels),
            ].map((channel) => [channel.id, channel])
          : []
      ),
    [channelData]
  )
  // A chat made, deleted or archived changes the channels: the list follows.
  const channelIds = useMemo(
    () => [...channels.keys()].sort().join(","),
    [channels]
  )
  useEffect(() => {
    if (!workspaceSlug || !channelIds) return
    void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
  }, [channelIds, workspaceSlug, queryClient])

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
  const canManage = permissionCtx
    ? canManageChannels(permissionCtx.actor, permissionCtx.workspace)
    : false
  const canDelete = permissionCtx
    ? canDeleteChannels(permissionCtx.actor, permissionCtx.workspace)
    : false

  const { pinned, recent } = useMemo(
    () =>
      orderChats([
        ...(chats ?? []),
        ...(filter.archived ? (archivedChats ?? []) : []),
        ...(filter.places ? (placeChats ?? []) : []),
      ]),
    [chats, archivedChats, placeChats, filter]
  )

  if (isPending || !workspaceSlug) return <ChatListSkeleton />

  const layout = reduced ? false : ("position" as const)
  const filtering = filter.archived || filter.places
  const filterMenu = (
    <Menu>
      <MenuTrigger
        aria-label="Filter chats"
        title="Filter chats"
        data-filtering={filtering || undefined}
        className="relative -my-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-[transform,background-color,color] duration-150 ease-out after:absolute after:-inset-1.5 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94] data-filtering:bg-foreground/[0.09] data-filtering:text-foreground data-popup-open:bg-foreground/[0.09] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <HugeiconsIcon
          icon={FilterHorizontalIcon}
          className="size-3.5"
          strokeWidth={2}
        />
      </MenuTrigger>
      <MenuPopup align="end" className="w-52">
        <MenuGroup>
          <MenuGroupLabel>Also show</MenuGroupLabel>
          <MenuCheckboxItem
            variant="switch"
            checked={filter.archived}
            onCheckedChange={(on) => setFilter("archived", on)}
          >
            <span className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Archive02Icon}
                className="size-4 text-muted-foreground"
                strokeWidth={2}
              />
              Archived chats
            </span>
          </MenuCheckboxItem>
          <MenuCheckboxItem
            variant="switch"
            checked={filter.places}
            onCheckedChange={(on) => setFilter("places", on)}
          >
            <span className="flex items-center gap-2">
              <HugeiconsIcon
                icon={DiscordIcon}
                className="size-4 text-muted-foreground"
                strokeWidth={2}
              />
              Discord channels
            </span>
          </MenuCheckboxItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
  // The list's first label carries the filter.
  const label = (text: string | null, first: boolean) => (
    <motion.div
      key={`label-${text ?? "none"}`}
      layout={layout}
      transition={SPRING}
      className={cn(
        sidebarSectionLabel,
        "flex items-center justify-between px-2 pt-3 pb-1 hover:text-muted-foreground"
      )}
    >
      <span>{text}</span>
      {first && filterMenu}
    </motion.div>
  )
  // A chat that gets a message moves to the top of Recent; a pinned one
  // keeps its place.
  const row = (chat: Chat) => (
    <motion.div key={chat.id} layout={layout} transition={SPRING}>
      <ChatRow
        chat={chat}
        channel={channels.get(chat.id)}
        agentsById={agentsById}
        me={me}
        active={chat.id === activeChannelId}
        canManage={canManage}
        canDelete={canDelete}
        muteControls={muteControls}
        onOpen={() => {
          void navigate({
            to: "/$workspaceSlug/$channelId",
            params: { workspaceSlug, channelId: chat.id },
          })
          closeMobileSidebar(false)
        }}
        onOpenNeed={(need) => {
          void navigate({
            to: "/$workspaceSlug/$channelId",
            params: { workspaceSlug, channelId: chat.id },
            search: need.threadRootId
              ? { threadId: need.threadRootId, threadMessageId: need.messageId }
              : { msgId: need.messageId },
          })
          closeMobileSidebar(false)
        }}
        onPin={() =>
          updateChat.mutate({ channelId: chat.id, pinned: !chat.pinnedAt })
        }
        onHide={() => updateChat.mutate({ channelId: chat.id, hidden: true })}
        onUnarchive={() => unarchive.mutate({ channelId: chat.id })}
      />
    </motion.div>
  )

  return (
    <nav aria-label="Chats" className="pb-2">
      {pinned.length > 0 && label("Pinned", true)}
      {pinned.map(row)}
      {recent.length > 0 && label("Recent", pinned.length === 0)}
      {recent.map(row)}
      {pinned.length + recent.length === 0 && (
        <>
          {label(null, true)}
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No chats yet.
          </p>
        </>
      )}
    </nav>
  )
}

// The line under a chat's name: who spoke last and what they said.
function Preview({
  chat,
  agent,
  me,
  unread,
}: {
  chat: Chat
  // The agent that wrote the last message, when one did.
  agent: WorkspaceAgent | undefined
  me: string | undefined
  unread: boolean
}) {
  const last = chat.lastMessage
  const mine = last?.authorId === me
  // Alone with one agent there is nobody else to name.
  const direct = chat.agentIds.length === 1 && chat.peopleCount === 1
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 text-[13px]",
        unread ? "text-foreground/85" : "text-muted-foreground"
      )}
    >
      {last && agent && !direct && (
        <AgentCreature creature={agentCreature(agent)} size={14} still />
      )}
      <span className="truncate">
        {last
          ? `${mine ? "You: " : !agent && !direct ? `${last.authorName.split(" ")[0]}: ` : ""}${last.preview}`
          : "No messages yet"}
      </span>
    </span>
  )
}

function ChatRow({
  chat,
  channel,
  agentsById,
  me,
  active,
  canManage,
  canDelete,
  muteControls,
  onOpen,
  onOpenNeed,
  onPin,
  onHide,
  onUnarchive,
}: {
  chat: Chat
  // The channel row: its settings dialogs need it. Missing for a moment
  // after a chat is made elsewhere.
  channel: Channel | undefined
  agentsById: Map<string, WorkspaceAgent>
  me: string | undefined
  active: boolean
  canManage: boolean
  canDelete: boolean
  muteControls: MuteControls
  onOpen: () => void
  // Opens the chat at the message that waits on the person.
  onOpenNeed: (need: AgentNeed) => void
  onPin: () => void
  onHide: () => void
  onUnarchive: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editTab, setEditTab] = useState<EditChannelTab>("overview")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const openEdit = (tab: EditChannelTab) => {
    setEditTab(tab)
    setEditOpen(true)
  }
  // Whoever made a chat may rename it.
  const canEdit =
    canManage || (!!channel?.creatorId && channel.creatorId === me)

  const { getUnreadCount, getMentionCount } = useUnread()
  const { getMute, muteChannel, unmuteChannel } = muteControls
  // Shown greyed while the list shows archived chats: nothing in it is
  // unread, pinned or running, and its menu only unarchives or deletes.
  const archived = Boolean(chat.archivedAt)
  // A Discord channel agents are in: people read it in Discord, so nothing
  // here is unread, and it has no pin, hide or mute of its own.
  const place = chat.place
  const quiet = archived || Boolean(place)
  const mute = quiet ? undefined : getMute(chat.id)
  const unread = !quiet && !active && getUnreadCount(chat.id) > 0
  const mentionCount = active || quiet ? 0 : getMentionCount(chat.id)
  const activity = useChannelActivity(chat.id)
  const sessions = archived ? [] : (activity?.sessions ?? [])
  // An approval waiting on this person: once the chat is read nothing else
  // in the list says an agent is still blocked, so the row keeps a mark
  // until it is decided (the sidebar's "Needs you" group, removed
  // 2026-11-26, used to list these).
  const approval = archived
    ? undefined
    : activity?.agentNeeds.find((need) => need.kind === "approval")
  const running = archived ? 0 : (activity?.runningSessions ?? 0)
  const runningLabel = `${running} ${running === 1 ? "session" : "sessions"} running`

  const name = chatDisplayName(channel?.name ?? chat.name, Boolean(place))
  const agentIds = channel?.agentIds ?? chat.agentIds
  const agents = agentIds.flatMap((id) => agentsById.get(id) ?? [])
  const others = chat.people.filter((person) => person.id !== me)
  // Nobody else and no agent: the chat wears your own face.
  const people = others.length + agents.length > 0 ? others : chat.people
  // Lor's own line in a chat (a session it started) is the first agent's.
  const lastAgent = chat.lastMessage
    ? (agentsById.get(chat.lastMessage.authorId) ??
      (chat.lastMessage.authorId === LOR_USER_ID ? agents[0] : undefined))
    : undefined

  return (
    <>
      <ContextMenu
        onOpenChange={setMenuOpen}
        disabled={archived && !canManage && !(channel && canDelete)}
      >
        <ContextMenuTrigger
          className={cn(
            "group/chat relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 ease-out has-[[data-open]:active]:bg-foreground/[0.09]",
            active || menuOpen
              ? "bg-foreground/[0.07]"
              : "hover:bg-foreground/[0.04]"
          )}
        >
          <span className={cn("flex shrink-0", archived && "opacity-50")}>
            <ChatAvatar
              agents={agents}
              people={people}
              // The person is in every chat here but some archived ones.
              total={
                agents.length +
                Math.max(
                  chat.peopleCount - (chat.joined ? 1 : 0),
                  people.length
                )
              }
            />
          </span>
          {/* The whole row opens the chat, under the button that pins it. */}
          <button
            type="button"
            data-open
            onClick={onOpen}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring/50",
              archived ? "opacity-55" : "active:opacity-100"
            )}
          >
            <span className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "min-w-0 truncate text-[14px]",
                  unread ? "font-semibold" : "font-medium"
                )}
              >
                {name}
              </span>
              {chat.private && (
                <HugeiconsIcon
                  icon={SquareLock02Icon}
                  aria-label="Private"
                  className="size-3 shrink-0 self-center text-muted-foreground"
                  strokeWidth={2}
                />
              )}
              {mute && (
                <HugeiconsIcon
                  icon={NotificationOff01Icon}
                  aria-label="Muted"
                  className="size-3 shrink-0 self-center text-muted-foreground"
                  strokeWidth={2}
                />
              )}
              {place && (
                <HugeiconsIcon
                  icon={DiscordIcon}
                  aria-label="In Discord"
                  className="size-3 shrink-0 self-center text-muted-foreground"
                  strokeWidth={2}
                />
              )}
              {archived && (
                <HugeiconsIcon
                  icon={Archive02Icon}
                  aria-label="Archived"
                  className="size-3 shrink-0 self-center text-muted-foreground"
                  strokeWidth={2}
                />
              )}
              <span className="flex-1" />
              <span
                className={cn(
                  "shrink-0 text-[11px] text-muted-foreground tabular-nums",
                  // The pin button takes the time's place on hover.
                  !quiet &&
                    "group-hover/chat:invisible group-has-[[data-pin]:focus-visible]/chat:invisible"
                )}
              >
                {chatTime(chatActivityAt(chat))}
              </span>
            </span>
            <span
              className={cn(
                "mt-0.5 flex items-center gap-2",
                approval && "pr-6"
              )}
            >
              <Preview chat={chat} agent={lastAgent} me={me} unread={unread} />
              {running > 0 && (
                <span
                  role="img"
                  aria-label={runningLabel}
                  title={runningLabel}
                  className="flex shrink-0 items-center gap-1 text-agent text-xs tabular-nums"
                >
                  <span className="size-3 shrink-0 rounded-full border-[1.5px] border-agent/20 border-t-agent motion-safe:animate-spin" />
                  {running}
                </span>
              )}
              <MentionBadge count={mentionCount} />
              {unread && mentionCount === 0 && (
                <span
                  role="img"
                  aria-label="Unread"
                  className={cn(
                    sidebarRowMarkIn,
                    "size-2 shrink-0 rounded-full bg-primary"
                  )}
                />
              )}
            </span>
          </button>
          {approval && (
            <button
              type="button"
              onClick={() => onOpenNeed(approval)}
              aria-label={`Waiting on your approval in ${name}`}
              title="Waiting on your approval"
              className="absolute right-2 bottom-1.5 z-10 flex size-[18px] cursor-pointer items-center justify-center rounded-full bg-warning/15 font-semibold text-[11px] text-warning-foreground outline-none transition-[transform,background-color] duration-150 ease-out hover:bg-warning/25 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.92]"
            >
              !
            </button>
          )}
          {!quiet && (
            <button
              type="button"
              data-pin
              onClick={onPin}
              aria-label={chat.pinnedAt ? `Unpin ${name}` : `Pin ${name}`}
              title={chat.pinnedAt ? "Unpin" : "Pin"}
              className="absolute top-1 right-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[transform,background-color,color,opacity] duration-150 ease-out hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94] group-hover/chat:opacity-100"
            >
              <HugeiconsIcon
                icon={chat.pinnedAt ? PinOffIcon : PinIcon}
                className="size-3.5"
                strokeWidth={2}
              />
            </button>
          )}
        </ContextMenuTrigger>
        <ContextMenuPopup align="start">
          {place ? (
            <ContextMenuItem
              render={
                // biome-ignore lint/a11y/useAnchorContent: the item renders its label inside
                <a href={place.url} target="_blank" rel="noreferrer" />
              }
            >
              <HugeiconsIcon icon={DiscordIcon} strokeWidth={2} />
              Open in Discord
            </ContextMenuItem>
          ) : archived ? (
            canManage && (
              <ContextMenuItem onClick={onUnarchive}>
                <HugeiconsIcon icon={ArchiveRestoreIcon} strokeWidth={2} />
                Unarchive Chat
              </ContextMenuItem>
            )
          ) : (
            <>
              <ContextMenuItem onClick={onPin}>
                <HugeiconsIcon
                  icon={chat.pinnedAt ? PinOffIcon : PinIcon}
                  strokeWidth={2}
                />
                {chat.pinnedAt ? "Unpin Chat" : "Pin Chat"}
              </ContextMenuItem>
              <ContextMenuItem onClick={onHide}>
                <HugeiconsIcon icon={ViewOffSlashIcon} strokeWidth={2} />
                Hide Chat
              </ContextMenuItem>
              {mute ? (
                <ContextMenuItem onClick={() => unmuteChannel(chat.id)}>
                  <HugeiconsIcon icon={Notification01Icon} strokeWidth={2} />
                  Unmute Chat
                </ContextMenuItem>
              ) : (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <HugeiconsIcon
                      icon={NotificationOff01Icon}
                      strokeWidth={2}
                    />
                    Mute Chat
                  </ContextMenuSubTrigger>
                  <ContextMenuSubPopup>
                    {MUTE_DURATIONS.map((duration) => (
                      <ContextMenuItem
                        key={duration.label}
                        onClick={() =>
                          muteChannel({
                            channelId: chat.id,
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
              {channel && canEdit && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => openEdit("overview")}>
                    <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
                    Edit Chat
                  </ContextMenuItem>
                </>
              )}
              {channel && canEdit && canManage && (
                <>
                  <ContextMenuItem onClick={() => openEdit("agent")}>
                    <HugeiconsIcon icon={Layers01Icon} strokeWidth={2} />
                    Agents
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => openEdit("webhooks")}>
                    <HugeiconsIcon icon={WebhookIcon} strokeWidth={2} />
                    Webhooks
                  </ContextMenuItem>
                </>
              )}
            </>
          )}
          {channel && canDelete && (
            <>
              {!(archived && !canManage) && <ContextMenuSeparator />}
              <ContextMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Delete Chat
              </ContextMenuItem>
            </>
          )}
        </ContextMenuPopup>
      </ContextMenu>
      {/* Under the chat's name, as sessions sat under a channel. */}
      {sessions.length > 0 && (
        <div className="mb-1 pl-[26px]">
          <ChannelSessionRows
            channelId={chat.id}
            sessions={sessions}
            collapsed={false}
          />
        </div>
      )}
      {channel && canEdit && (
        <EditChannelDialog
          channel={channel}
          open={editOpen}
          onOpenChange={setEditOpen}
          overviewOnly={!canManage}
          initialTab={editTab}
        />
      )}
      {channel && canDelete && (
        <DeleteChannelDialog
          channel={channel}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  )
}
