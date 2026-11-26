import {
  Cancel01Icon,
  DocumentAttachmentIcon,
  PlusSignIcon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type { RealtimeMessage } from "@repo/realtime-types"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { ScrollArea } from "@repo/ui/components/scroll-area"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { useIsMobile } from "@repo/ui/hooks/use-mobile"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { ChannelAgentProvider } from "@/components/agent/channel-agent"
import { ChatAvatar } from "@/components/sidebar/chat-panel/chat-avatar"
import { ChannelAgentsSection } from "@/components/sidebar/right-panel/channel-agents-section"
import { FollowUpsSection } from "@/components/sidebar/right-panel/follow-ups-section"
import { LoopsOverviewSection } from "@/components/sidebar/right-panel/loops-overview-section"
import { useRightSidebar } from "@/components/sidebar/right-panel/right-sidebar-context"
import type { WorkspaceMembersSidebarView } from "@/components/sidebar/right-panel/right-sidebar-types"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSocket } from "@/context/socket-context"
import { useAgentsById } from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { useChannelDiscord } from "@/hooks/use-channel-discord"
import { type Chat, chatsKey, orderChats } from "@/hooks/use-chats"
import { apiClient } from "@/lib/api-client"
import { patchChannelList, upsertChannel } from "@/lib/channel-list-cache"
import { channelQueryOptions } from "@/lib/channel-query"

// A chat's details, beside it (reference/agents-and-chats.md, decisions 31
// and 35): its name, the agents in it and the people in it. The people are
// the chat's own, not the workspace's: anyone in an open chat can add
// someone, and anyone can leave.

const chatPeopleKey = (workspaceSlug: string, channelId: string) =>
  ["chat-people", workspaceSlug, channelId] as const

export function chatPeopleQueryOptions(
  workspaceSlug: string,
  channelId: string
) {
  return {
    queryKey: chatPeopleKey(workspaceSlug, channelId),
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].chats[
        ":channelId"
      ].people.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to load the people in this chat")
      return (await res.json()).people
    },
  }
}

const ROW =
  "group relative flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5"
const ROW_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96] disabled:pointer-events-none group-hover:opacity-100"
const SECTION_LABEL = "px-1 pb-1 text-[11px] text-muted-foreground"

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

export function ChatDetailsPanel({
  view,
}: {
  view: WorkspaceMembersSidebarView
}) {
  const { workspaceSlug, channelId } = view
  const { setView, toggleCollapsed, clearView } = useRightSidebar()
  const isMobile = useIsMobile()
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const canManage = useCanManageChannels(workspaceSlug)
  const agentsById = useAgentsById(workspaceSlug)
  const { data: chat } = useQuery(channelQueryOptions(workspaceSlug, channelId))
  const { data: people } = useQuery(
    chatPeopleQueryOptions(workspaceSlug, channelId)
  )
  if (!chat) return null

  const agents = chat.agentIds.flatMap((id) => agentsById.get(id) ?? [])
  const others = (people ?? []).filter((person) => person.id !== me)
  // Only the people in a private chat can see it.
  const isPrivate = chat.audience === "members" && chat.parentId === null
  // A Discord channel agents are in (decision 51): its name and agents are
  // managed from the Discord connector, and it has no people in Lor.
  const place = chat.kind === "place"
  const open = !chat.archivedAt
  // Whoever made a chat may rename it.
  const canRename =
    open && !place && (canManage || (!!me && chat.creatorId === me))
  // A chat's loops are listed in its agent's page, since that agent runs
  // them. Only a chat with no agent lists its own here.
  const loopsHere = chat.agentIds.length === 0

  return (
    <ChannelAgentProvider workspaceSlug={workspaceSlug} channelId={channelId}>
      <div className="flex h-full w-full flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <div className="-ml-1.5 flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Browse attachments"
                    onClick={() =>
                      setView({
                        type: "attachments",
                        kind: "upload",
                        workspaceSlug,
                        channelId,
                      })
                    }
                    className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                  />
                }
              >
                <HugeiconsIcon icon={DocumentAttachmentIcon} size={15} />
              </TooltipTrigger>
              <TooltipContent>Attachments</TooltipContent>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={isMobile ? clearView : toggleCollapsed}
            aria-label={isMobile ? "Close details" : "Collapse details"}
            className="-mr-1.5 flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <SidebarToggleIcon
              isOpen={true}
              className="size-4 -scale-x-100"
              strokeWidth={1.5}
            />
          </button>
        </div>

        <ScrollArea className="min-w-0 flex-1 overflow-x-hidden px-2 pb-2">
          <div className="min-w-0 space-y-4 px-1 pb-3">
            <div className="flex flex-col items-center gap-2.5 px-1 pt-1 pb-1 text-center">
              <ChatAvatar
                agents={agents}
                people={
                  others.length + agents.length > 0 ? others : (people ?? [])
                }
                total={agents.length + others.length}
                size={64}
              />
              <div className="w-full min-w-0">
                <ChatName
                  key={chat.id}
                  workspaceSlug={workspaceSlug}
                  chat={chat}
                  editable={canRename}
                />
                {place ? (
                  <PlaceNote
                    workspaceSlug={workspaceSlug}
                    channelId={channelId}
                  />
                ) : (
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                    {isPrivate && (
                      <HugeiconsIcon
                        icon={SquareLock02Icon}
                        className="size-3"
                        strokeWidth={2}
                      />
                    )}
                    {isPrivate
                      ? "Private: only the people in it can see it"
                      : "Anyone in the workspace can find it and join"}
                  </p>
                )}
              </div>
            </div>

            <ChannelAgentsSection
              workspaceSlug={workspaceSlug}
              channelId={channelId}
            />
            {!place && (
              <ChatPeople
                workspaceSlug={workspaceSlug}
                channelId={channelId}
                people={people}
                me={me}
                // In a private chat the list is also who can see it.
                canAdd={open && (!isPrivate || canManage)}
                canRemove={canManage}
              />
            )}
            {loopsHere && (
              <LoopsOverviewSection
                workspaceSlug={workspaceSlug}
                channelId={channelId}
              />
            )}
            <FollowUpsSection
              workspaceSlug={workspaceSlug}
              channelId={channelId}
            />
          </div>
        </ScrollArea>
      </div>
    </ChannelAgentProvider>
  )
}

// The chat's name: a field for whoever may rename it, saved when they leave
// it or press Enter.
function ChatName({
  workspaceSlug,
  chat,
  editable,
}: {
  workspaceSlug: string
  chat: { id: string; name: string | null }
  editable: boolean
}) {
  const queryClient = useQueryClient()
  const saved = chat.name ?? ""
  const [draft, setDraft] = useState(saved)
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug, channelId: chat.id },
        json: { name },
      })
      if (!res.ok) throw await failure(res, "Couldn't rename the chat")
      return res.json()
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(
        channelQueryOptions(workspaceSlug, chat.id).queryKey,
        updated
      )
      void patchChannelList(queryClient, workspaceSlug, (list) =>
        upsertChannel(list, updated)
      )
      void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
    },
    onError: (error) => {
      setDraft(saved)
      toast.error(error.message)
    },
  })
  const commit = () => {
    const name = draft.trim()
    if (!name) return setDraft(saved)
    if (name !== saved) rename.mutate(name)
  }
  if (!editable) {
    return <p className="truncate font-semibold text-[15px]">{saved}</p>
  }
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          setDraft(saved)
          // Let the field lose focus without saving the abandoned draft.
          requestAnimationFrame(() => event.currentTarget?.blur())
        }
      }}
      maxLength={100}
      aria-label="Chat name"
      className="w-full truncate rounded-md bg-transparent px-1.5 py-0.5 text-center font-semibold text-[15px] outline-none transition-colors duration-150 hover:bg-foreground/[0.05] focus:bg-foreground/[0.07]"
    />
  )
}

// Where a place is, and where its agents are managed.
function PlaceNote({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const navigate = useNavigate()
  const { data } = useChannelDiscord(workspaceSlug, channelId)
  const link = data?.link
  return (
    <p className="mt-0.5 text-[11px] text-muted-foreground">
      In Discord
      {link?.guildName ? ` on ${link.guildName}` : ""}. Its agents are set up in{" "}
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: ".",
            search: (prev) => ({
              ...prev,
              settings: "workspace",
              tab: "connectors",
              connector: "discord",
            }),
          })
        }
        className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
      >
        Connectors
      </button>
      .
    </p>
  )
}

function ChatPeople({
  workspaceSlug,
  channelId,
  people,
  me,
  canAdd,
  canRemove,
}: {
  workspaceSlug: string
  channelId: string
  people:
    | {
        id: string
        name: string
        image: string | null
        avatarColor: string | null
      }[]
    | undefined
  me: string | undefined
  canAdd: boolean
  canRemove: boolean
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const peopleKey = chatPeopleKey(workspaceSlug, channelId)
  const route =
    apiClient.v1.workspaces[":workspaceSlug"].chats[":channelId"].people
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: peopleKey })
    void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
  }

  // Someone else adding or leaving says so in the chat: follow it.
  useEffect(() => {
    if (!socket) return
    const onMessage = (message: RealtimeMessage) => {
      if (message.channelId !== channelId) return
      if (!message.eventType?.startsWith("member_")) return
      void queryClient.invalidateQueries({
        queryKey: ["chat-people", workspaceSlug, channelId],
      })
    }
    socket.on("message:created", onMessage)
    return () => {
      socket.off("message:created", onMessage)
    }
  }, [socket, queryClient, workspaceSlug, channelId])

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const res = await route[":userId"].$delete({
        param: { workspaceSlug, channelId, userId },
      })
      if (!res.ok) throw await failure(res, "Couldn't do that")
    },
    onSuccess: (_data, userId) => {
      refresh()
      if (userId !== me) return
      // A chat you left is out of your list: go to the top one you are in.
      const { pinned, recent } = orderChats(
        (
          queryClient.getQueryData<Chat[]>(chatsKey(workspaceSlug)) ?? []
        ).filter((chat) => chat.id !== channelId)
      )
      const next = pinned[0] ?? recent[0]
      void navigate(
        next
          ? {
              to: "/$workspaceSlug/$channelId",
              params: { workspaceSlug, channelId: next.id },
            }
          : { to: "/$workspaceSlug/new", params: { workspaceSlug } }
      )
    },
    onError: (error) => toast.error(error.message),
  })

  const join = useMutation({
    mutationFn: async (userId: string) => {
      const res = await route.$post({
        param: { workspaceSlug, channelId },
        json: { userIds: [userId] },
      })
      if (!res.ok) throw await failure(res, "Couldn't join the chat")
    },
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })

  const inChat = people?.some((person) => person.id === me) ?? false
  return (
    <section aria-label="People">
      <div className={SECTION_LABEL}>
        {people ? `People · ${people.length}` : "People"}
      </div>
      <div className="space-y-0.5">
        {people?.map((person) => {
          const isMe = person.id === me
          return (
            <div key={person.id} className={ROW}>
              <span className="flex size-8 shrink-0 items-center justify-center">
                <UserAvatar
                  avatarColor={person.avatarColor}
                  name={person.name}
                  src={person.image}
                  size="sm"
                  className="size-7"
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {person.name}
              </span>
              {isMe && (
                <span className="shrink-0 text-[11px] text-muted-foreground group-hover:hidden">
                  You
                </span>
              )}
              {isMe ? (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(person.id)}
                  className="hidden shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:block focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:block"
                >
                  Leave
                </button>
              ) : (
                canRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${person.name} from this chat`}
                    title="Remove from this chat"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(person.id)}
                    className={ROW_BUTTON}
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      className="size-3.5"
                      strokeWidth={2}
                    />
                  </button>
                )
              )}
            </div>
          )
        })}
        {/* Someone looking at a chat they are not in joins it here. */}
        {canAdd && people && me && !inChat && (
          <button
            type="button"
            disabled={join.isPending}
            onClick={() => join.mutate(me)}
            className="mt-1 flex h-8 w-full cursor-pointer items-center justify-center rounded-md bg-foreground/[0.07] font-medium text-[13px] outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-60"
          >
            Join chat
          </button>
        )}
        {canAdd && people && (
          <AddPeople
            workspaceSlug={workspaceSlug}
            channelId={channelId}
            here={[...people.map((person) => person.id), ...(me ? [me] : [])]}
            onAdded={refresh}
          />
        )}
      </div>
    </section>
  )
}

// The row that adds people: everyone in the workspace who is not in the
// chat yet, with a search field once there are many.
function AddPeople({
  workspaceSlug,
  channelId,
  here,
  onAdded,
}: {
  workspaceSlug: string
  channelId: string
  here: string[]
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { data } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const add = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].chats[
        ":channelId"
      ].people.$post({
        param: { workspaceSlug, channelId },
        json: { userIds: [userId] },
      })
      if (!res.ok) throw await failure(res, "Couldn't add them")
    },
    onSuccess: onAdded,
    onError: (error) => toast.error(error.message),
  })
  const others = (data?.members ?? []).filter(
    (member) => !member.isBot && !here.includes(member.userId)
  )
  const needle = query.trim().toLowerCase()
  const shown = others.filter(
    (member) => !needle || member.name.toLowerCase().includes(needle)
  )
  if (others.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              ROW,
              "w-full cursor-pointer text-left text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
            )}
          />
        }
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          <span className="flex size-7 items-center justify-center rounded-full border border-muted-foreground/40 border-dashed transition-colors duration-150 group-hover:border-foreground/60 group-data-popup-open:border-foreground/60">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </span>
        </span>
        <span className="text-[13px]">Add people</span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-24px)]"
        viewportClassName="p-1.5"
      >
        <PopoverTitle className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
          Add to this chat
        </PopoverTitle>
        {others.length > 8 && (
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find someone"
            aria-label="Find someone"
            className="mx-1 mb-1 h-8 w-[calc(100%-0.5rem)] rounded-md border border-border bg-transparent px-2 text-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-foreground/25"
          />
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.map((member) => (
            <div
              key={member.userId}
              className="flex h-9 items-center gap-2 rounded-md px-2 text-sm"
            >
              <UserAvatar
                avatarColor={member.avatarColor}
                name={member.name}
                src={member.image}
                size="sm"
                className="size-[22px]"
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {member.name}
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={add.isPending}
                onClick={() => add.mutate(member.userId)}
                aria-label={`Add ${member.name}`}
                className="shrink-0"
              >
                Add
              </Button>
            </div>
          ))}
          {shown.length === 0 && (
            <p className="px-2 py-2 text-muted-foreground text-xs">
              Nobody by that name.
            </p>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  )
}

// Above the composer of a chat the person is only looking at: it is not in
// their list until they join, or write in it.
export function JoinChatBar({
  workspaceSlug,
  channelId,
  me,
}: {
  workspaceSlug: string
  channelId: string
  me: string | undefined
}) {
  const queryClient = useQueryClient()
  const { data: people } = useQuery(
    chatPeopleQueryOptions(workspaceSlug, channelId)
  )
  const join = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].chats[
        ":channelId"
      ].people.$post({
        param: { workspaceSlug, channelId },
        json: { userIds: [userId] },
      })
      if (!res.ok) throw await failure(res, "Couldn't join the chat")
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chatPeopleKey(workspaceSlug, channelId),
      })
      void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
    },
    onError: (error) => toast.error(error.message),
  })
  if (!me || !people || people.some((person) => person.id === me)) return null
  return (
    <div className="px-4 pb-2">
      <div className="flex items-center gap-3 rounded-xl bg-foreground/[0.04] py-2 pr-2 pl-3.5 text-[13px] text-muted-foreground">
        <span className="min-w-0 flex-1">
          You're not in this chat, so it isn't in your list.
        </span>
        <button
          type="button"
          disabled={join.isPending}
          onClick={() => join.mutate(me)}
          className="h-7 shrink-0 cursor-pointer rounded-full bg-foreground/[0.08] px-3 font-medium text-foreground outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.12] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-60"
        >
          Join chat
        </button>
      </div>
    </div>
  )
}
