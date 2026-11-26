import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/menu"
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactElement, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  DISCLOSURE_MOTION,
  SettingsAction,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  TriggerEffects,
  type TriggerEffectsPatch,
  TriggerRow,
} from "@/components/workspace/trigger-effects"
import {
  agentCreature,
  useAgents,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"
import type { IntegrationStatus } from "@/lib/api-types"
import { integrationsQueryOptions } from "@/lib/integrations-query"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

// Who listens to each of a connector's events (reference/agents-and-chats.md,
// decisions 40 and 42). At rest it is a list, one line an event: the agents
// that hear it, or the agent whose role fits when nobody does. Opening an
// event shows its listeners as chips and the picked one's settings.

type ConnectorEvent = IntegrationStatus["events"][number]
type Listener = ConnectorEvent["listeners"][number]
type Chat = ReturnType<typeof openTextChannels>[number]
type ListenerPatch = TriggerEffectsPatch & { channelId?: string }

const PRESS =
  "transition-[transform,background-color,color,box-shadow] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
// A raised pill on the filled settings surface: a listener chip, a suggestion.
const RAISED = "bg-background shadow-xs/5 ring-1 ring-border"

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

function namesOf(agents: WorkspaceAgent[]): string {
  const [first, second] = agents
  if (!first) return ""
  if (!second) return first.name
  if (agents.length === 2) return `${first.name} and ${second.name}`
  return `${first.name} and ${agents.length - 1} more`
}

export function ConnectorEvents({
  workspaceSlug,
  provider,
  connectionId,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
  connectionId: string
}) {
  const queryClient = useQueryClient()
  const { canManage, events } = provider
  const queryKey = integrationsQueryOptions(workspaceSlug).queryKey
  const listenersRoute =
    apiClient.v1.workspaces[":workspaceSlug"].integrations[":connectionId"]
      .listeners

  const agents = useAgents(workspaceSlug)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const { data: channelList } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const chats = channelList ? openTextChannels(channelList) : []
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]))
  // The chats an agent is in, first one first.
  const chatsOf = (agentId: string) =>
    chats.filter((chat) => chat.agentIds.includes(agentId))
  // An agent reports in a chat it is in, so one in no chat can't listen yet.
  const placed = agents.filter((agent) => chatsOf(agent.id).length > 0)

  // One event open at a time, and which of its listeners is showing.
  const [openEvent, setOpenEvent] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState<Record<string, true>>({})

  const hasOff = events.some((ev) => ev.listeners.length === 0)
  const suggestions = useQuery({
    queryKey: ["listener-suggestions", workspaceSlug, connectionId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].suggestions.$get({ param: { workspaceSlug, connectionId } })
      if (!res.ok) return []
      return (await res.json()).suggestions
    },
    enabled: canManage && hasOff && placed.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const editListeners = (edit: (listeners: Listener[]) => Listener[]) =>
    queryClient.setQueryData(queryKey, (prev) =>
      prev
        ? {
            providers: prev.providers.map((item) =>
              item.connectionId === connectionId
                ? {
                    ...item,
                    events: item.events.map((ev) => ({
                      ...ev,
                      listeners: edit(ev.listeners),
                    })),
                  }
                : item
            ),
          }
        : prev
    )
  const mutationKey = ["listener-save", connectionId]
  // Refetch once the last save lands: an earlier refetch would show a later
  // change, still on its way, undone for a moment.
  const settle = () => {
    if (queryClient.isMutating({ mutationKey }) === 1) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }

  const add = useMutation({
    mutationFn: async (input: {
      event: string
      agentId: string
      channelId: string
    }) => {
      const res = await listenersRoute.$post({
        param: { workspaceSlug, connectionId },
        json: input,
      })
      if (!res.ok) throw await failure(res, "Could not add the agent")
      const { id } = await res.json()
      await queryClient.invalidateQueries({ queryKey })
      return id
    },
    onMutate: (input) =>
      setAdding((prev) => ({ ...prev, [input.event]: true })),
    onSuccess: (id, input) =>
      setPicked((prev) => ({ ...prev, [input.event]: id })),
    onError: (err) => toast.error(err.message),
    onSettled: (_id, _err, input) =>
      setAdding(({ [input.event]: _done, ...rest }) => rest),
  })

  // Saved as it changes, and shown at once: each change sends only its own
  // fields, so two in a row never overwrite each other.
  const update = useMutation({
    mutationKey,
    mutationFn: async (input: { id: string; patch: ListenerPatch }) => {
      const res = await listenersRoute[":listenerId"].$patch({
        param: { workspaceSlug, connectionId, listenerId: input.id },
        json: input.patch,
      })
      if (!res.ok) throw await failure(res, "Could not save the change")
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey })
      editListeners((listeners) =>
        listeners.map((item) => (item.id === id ? { ...item, ...patch } : item))
      )
    },
    onError: (err) => toast.error(err.message),
    onSettled: settle,
  })

  // No confirm: the toast's Undo adds it back with the same settings.
  const remove = useMutation({
    mutationKey,
    mutationFn: async (input: { event: string; listener: Listener }) => {
      const res = await listenersRoute[":listenerId"].$delete({
        param: { workspaceSlug, connectionId, listenerId: input.listener.id },
      })
      if (!res.ok) throw await failure(res, "Could not remove the agent")
    },
    onMutate: async ({ listener }) => {
      await queryClient.cancelQueries({ queryKey })
      editListeners((listeners) =>
        listeners.filter((item) => item.id !== listener.id)
      )
    },
    onSuccess: (_data, { event, listener }) => {
      const name = agentsById.get(listener.agentId ?? "")?.name
      toast(name ? `${name} stopped listening` : "Removed", {
        action: {
          label: "Undo",
          onClick: () =>
            void listenersRoute
              .$post({
                param: { workspaceSlug, connectionId },
                json: {
                  event,
                  agentId: listener.agentId,
                  channelId: listener.channelId,
                  filter: listener.filter,
                  post: listener.post,
                  notify: listener.notify,
                  actInstructions: listener.actInstructions,
                },
              })
              .then(async (res) => {
                if (!res.ok) throw await failure(res, "Could not undo")
                await queryClient.invalidateQueries({ queryKey })
              })
              .catch((err: Error) => toast.error(err.message)),
        },
      })
    },
    onError: (err) => toast.error(err.message),
    onSettled: settle,
  })

  const listenWith = (event: string, agentId: string, channelId?: string) => {
    const chatId = channelId ?? chatsOf(agentId)[0]?.id
    if (!chatId) {
      toast.error("Add this agent to a chat first")
      return
    }
    add.mutate({ event, agentId, channelId: chatId })
  }

  // Every event nobody listens to that has a fitting agent: one press takes
  // them all.
  const suggested = events.flatMap((ev) => {
    const pick = suggestions.data?.find((item) => item.event === ev.key)
    return ev.listeners.length === 0 && pick && agentsById.has(pick.agentId)
      ? [pick]
      : []
  })
  const addAll = useMutation({
    mutationFn: async (items: typeof suggested) => {
      const results = await Promise.all(
        items.map((json) =>
          listenersRoute.$post({ param: { workspaceSlug, connectionId }, json })
        )
      )
      await queryClient.invalidateQueries({ queryKey })
      if (results.some((res) => !res.ok)) {
        throw new Error("Some agents could not be added")
      }
    },
    onMutate: (items) =>
      setAdding((prev) => ({
        ...prev,
        ...Object.fromEntries(items.map((item) => [item.event, true as const])),
      })),
    onError: (err) => toast.error(err.message),
    onSettled: (_data, _err, items) =>
      setAdding((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(
            ([event]) => !items.some((item) => item.event === event)
          )
        )
      ),
  })

  const on = events.filter((ev) => ev.listeners.length > 0).length

  return (
    <SettingsSection
      title="Events"
      count={events.length}
      description={`When something happens in ${provider.name}, the agents you pick hear about it.`}
      action={
        canManage && suggested.length > 1 && !addAll.isPending ? (
          <SettingsAction onClick={() => addAll.mutate(suggested)}>
            Add all suggested
          </SettingsAction>
        ) : (
          on > 0 && (
            <span className="text-muted-foreground text-xs">{on} on</span>
          )
        )
      }
    >
      <SettingsGroup>
        {events.map((ev) => {
          const suggestion = suggestions.data?.find(
            (item) => item.event === ev.key
          )
          // Agents that could still be added: each listens to an event once.
          const free = placed.filter(
            (agent) => !ev.listeners.some((item) => item.agentId === agent.id)
          )
          const addMenu = (variant: "plus" | "caret" | "pill") => (
            <AddAgentMenu
              variant={variant}
              label={
                variant === "pill"
                  ? "Add agent"
                  : variant === "caret"
                    ? `Choose another agent for ${ev.label}`
                    : "Add another agent"
              }
              agents={free}
              onPick={(agentId) => listenWith(ev.key, agentId)}
            />
          )
          if (ev.listeners.length === 0) {
            return (
              <IdleEvent
                key={ev.key}
                label={ev.label}
                canManage={canManage}
                loading={suggestions.isLoading}
                busy={ev.key in adding}
                suggested={agentsById.get(suggestion?.agentId ?? "")}
                hasAgents={free.length > 0}
                onAccept={() =>
                  suggestion &&
                  listenWith(ev.key, suggestion.agentId, suggestion.channelId)
                }
                addMenu={addMenu}
              />
            )
          }
          const listener =
            ev.listeners.find((item) => item.id === picked[ev.key]) ??
            ev.listeners[0]
          return (
            <ActiveEvent
              key={ev.key}
              event={ev}
              open={openEvent === ev.key}
              onOpenChange={(open) => setOpenEvent(open ? ev.key : null)}
              agentsById={agentsById}
              chatsById={chatsById}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {ev.listeners.map((item) => (
                  <ListenerChip
                    key={item.id}
                    agent={agentsById.get(item.agentId ?? "")}
                    chat={chatsById.get(item.channelId)}
                    selected={item.id === listener?.id}
                    onSelect={() =>
                      setPicked((prev) => ({ ...prev, [ev.key]: item.id }))
                    }
                    onRemove={
                      canManage
                        ? () => remove.mutate({ event: ev.key, listener: item })
                        : undefined
                    }
                  />
                ))}
                {canManage &&
                  free.length > 0 &&
                  (ev.key in adding ? (
                    <span className="flex size-7 items-center justify-center">
                      <Spinner className="size-3.5 text-muted-foreground" />
                    </span>
                  ) : (
                    addMenu("plus")
                  ))}
                {listener && (
                  <ListenerActivity
                    key={listener.id}
                    workspaceSlug={workspaceSlug}
                    connectionId={connectionId}
                    listenerId={listener.id}
                    agentName={agentsById.get(listener.agentId ?? "")?.name}
                  />
                )}
              </div>
              {listener && (
                <ListenerSettings
                  key={listener.id}
                  workspaceSlug={workspaceSlug}
                  connectionId={connectionId}
                  listener={listener}
                  agent={agentsById.get(listener.agentId ?? "")}
                  chat={chatsById.get(listener.channelId)}
                  chats={listener.agentId ? chatsOf(listener.agentId) : chats}
                  canManage={canManage}
                  onPatch={(patch) => update.mutate({ id: listener.id, patch })}
                />
              )}
            </ActiveEvent>
          )
        })}
      </SettingsGroup>
    </SettingsSection>
  )
}

// An event nobody listens to: its name, and one press to add the agent whose
// role fits. The menu beside it holds everyone else.
function IdleEvent({
  label,
  canManage,
  loading,
  busy,
  suggested,
  hasAgents,
  onAccept,
  addMenu,
}: {
  label: string
  canManage: boolean
  loading: boolean
  busy: boolean
  suggested: WorkspaceAgent | undefined
  hasAgents: boolean
  onAccept: () => void
  addMenu: (variant: "caret" | "pill") => ReactElement
}) {
  let control = <span className="text-muted-foreground text-xs">Off</span>
  if (canManage && loading) {
    // The suggestion takes about a second: hold its place so nothing jumps.
    control = (
      <span
        aria-hidden="true"
        className="h-7 w-24 animate-pulse rounded-full bg-foreground/[0.06]"
      />
    )
  } else if (canManage && busy) {
    control = <Spinner className="mr-1.5 size-3.5 text-muted-foreground" />
  } else if (canManage && hasAgents) {
    control = (
      <span className="flex items-center gap-0.5 starting:opacity-0 transition-opacity duration-200 ease-out">
        {suggested && (
          <button
            type="button"
            onClick={onAccept}
            className={cn(
              "flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-1 font-medium text-xs hover:bg-background/70",
              RAISED,
              PRESS,
              FOCUS
            )}
          >
            <AgentCreature
              creature={agentCreature(suggested)}
              size={20}
              still
            />
            Add {suggested.name}
          </button>
        )}
        {addMenu(suggested ? "caret" : "pill")}
      </span>
    )
  }
  return (
    // The group's divider sits on the outer box, so the row is as tall as
    // one that opens and nothing shifts when it turns on.
    <div>
      <div className="flex min-h-14 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {control}
      </div>
    </div>
  )
}

const ROUND_BUTTON =
  "flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"

// The agents that can still be added to an event, behind a plus (beside the
// chips), a caret (beside a suggestion) or an "Add agent" pill.
function AddAgentMenu({
  variant,
  label,
  agents,
  onPick,
}: {
  variant: "plus" | "caret" | "pill"
  label: string
  agents: WorkspaceAgent[]
  onPick: (agentId: string) => void
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={variant === "pill" ? undefined : label}
            className={cn(
              variant === "pill"
                ? "flex h-7 cursor-pointer items-center gap-1 rounded-full pr-3 pl-2 text-muted-foreground text-xs hover:bg-foreground/[0.06] hover:text-foreground"
                : ROUND_BUTTON,
              PRESS,
              FOCUS
            )}
          />
        }
      >
        <HugeiconsIcon
          icon={variant === "caret" ? ArrowDown01Icon : Add01Icon}
          className="size-3.5"
          strokeWidth={2}
        />
        {variant === "pill" && label}
      </MenuTrigger>
      <MenuPopup
        align={variant === "plus" ? "start" : "end"}
        className="min-w-52"
      >
        <MenuGroup>
          <MenuGroupLabel>Who should hear about it</MenuGroupLabel>
          {agents.map((agent) => (
            <MenuItem key={agent.id} onClick={() => onPick(agent.id)}>
              <AgentCreature creature={agentCreature(agent)} size={20} still />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {agent.role && (
                <span className="text-muted-foreground text-xs">
                  {agent.role}
                </span>
              )}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}

// An event with listeners: one line saying who hears it, which opens to
// their settings.
function ActiveEvent({
  event,
  open,
  onOpenChange,
  agentsById,
  chatsById,
  children,
}: {
  event: ConnectorEvent
  open: boolean
  onOpenChange: (open: boolean) => void
  agentsById: Map<string, WorkspaceAgent>
  chatsById: Map<string, Chat>
  children: React.ReactNode
}) {
  // A keyboard toggle skips the motion.
  const [instant, setInstant] = useState(false)
  const only = event.listeners.length === 1 ? event.listeners[0] : undefined
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        onClick={(e) => setInstant(e.detail === 0)}
        className={cn(
          "group flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-sm text-left",
          FOCUS
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 transition-transform duration-200 ease-out motion-reduce:transition-none",
            // Open, the condition fades and the name settles to the middle.
            open && only?.filter && "translate-y-2",
            instant && "transition-none"
          )}
        >
          <span className="block truncate text-sm">{event.label}</span>
          {only?.filter && (
            // Open, the field below says it: fade, and keep the title still.
            <span
              className={cn(
                "block truncate text-muted-foreground text-xs transition-opacity duration-150 ease-out",
                open && "opacity-0"
              )}
            >
              Only when {only.filter}
            </span>
          )}
        </span>
        <ListenerSummary
          listeners={event.listeners}
          agentsById={agentsById}
          chatsById={chatsById}
          // Open, the chips below say it.
          className={cn(
            "transition-opacity duration-150 ease-out starting:opacity-0",
            open && "opacity-0"
          )}
        />
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out group-hover:text-foreground motion-reduce:transition-none",
            open && "rotate-90",
            instant && "transition-none"
          )}
          strokeWidth={2}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel
        className={cn(
          DISCLOSURE_MOTION,
          instant && "transition-none motion-reduce:transition-none"
        )}
      >
        <div className="space-y-4 pt-1 pb-5">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

// Who hears an event, in a few words: the agents it wakes, else the chat it
// is only posted in.
function ListenerSummary({
  listeners,
  agentsById,
  chatsById,
  className,
}: {
  listeners: Listener[]
  agentsById: Map<string, WorkspaceAgent>
  chatsById: Map<string, Chat>
  className?: string
}) {
  const woken = listeners.flatMap((item) => {
    const agent =
      item.actInstructions !== null && agentsById.get(item.agentId ?? "")
    return agent ? [agent] : []
  })
  const posted = listeners.find((item) => item.post)
  let body: React.ReactNode = "Paused"
  if (woken.length > 0) {
    body = (
      <>
        <span className="flex -space-x-1.5">
          {woken.slice(0, 3).map((agent) => (
            <span
              key={agent.id}
              className="flex rounded-full ring-2 ring-muted dark:ring-[color-mix(in_oklab,var(--muted)_60%,var(--background))]"
            >
              <AgentCreature creature={agentCreature(agent)} size={20} still />
            </span>
          ))}
        </span>
        <span className="truncate">{namesOf(woken)}</span>
      </>
    )
  } else if (posted) {
    body = (
      <>
        <HugeiconsIcon
          icon={BubbleChatIcon}
          className="size-3.5 shrink-0"
          strokeWidth={2}
        />
        <span className="truncate">
          Posted in {chatsById.get(posted.channelId)?.name ?? "a chat"}
        </span>
      </>
    )
  }
  return (
    <span
      className={cn(
        "flex min-w-0 max-w-[55%] shrink-0 items-center gap-2 text-muted-foreground text-sm",
        className
      )}
    >
      {body}
    </span>
  )
}

// A listener as a chip. Hovering it puts an X over the face, which removes
// it.
function ListenerChip({
  agent,
  chat,
  selected,
  onSelect,
  onRemove,
}: {
  agent: WorkspaceAgent | undefined
  chat: Chat | undefined
  selected: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  const name = agent?.name ?? chat?.name ?? "Chat"
  return (
    <span className="group/chip relative flex">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-1 text-sm",
          selected
            ? cn(RAISED, "text-foreground")
            : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
          PRESS,
          FOCUS
        )}
      >
        {agent ? (
          <AgentCreature creature={agentCreature(agent)} size={20} still />
        ) : (
          <span className="flex size-5 items-center justify-center">
            <HugeiconsIcon
              icon={BubbleChatIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </span>
        )}
        {name}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className={cn(
            "absolute top-1 left-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-background/75 text-foreground opacity-0 backdrop-blur-[2px] transition-[opacity,transform] duration-150 ease-out active:scale-90 group-hover/chip:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none",
            FOCUS
          )}
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            className="size-3"
            strokeWidth={2.5}
          />
        </button>
      )}
    </span>
  )
}

function ListenerSettings({
  workspaceSlug,
  connectionId,
  listener,
  agent,
  chat,
  chats,
  canManage,
  onPatch,
}: {
  workspaceSlug: string
  connectionId: string
  listener: Listener
  agent: WorkspaceAgent | undefined
  chat: Chat | undefined
  // The chats it could report in: the ones its agent is in.
  chats: Chat[]
  canManage: boolean
  onPatch: (patch: ListenerPatch) => void
}) {
  const chatItems = chats.map((item) => ({
    value: item.id,
    label: item.name ?? "Chat",
  }))
  return (
    <TriggerEffects
      idPrefix={`listener-${listener.id}`}
      channelLabel={chat?.name}
      agentName={agent?.name ?? null}
      disabled={!canManage}
      value={{
        post: listener.post,
        notify: listener.notify,
        filter: listener.filter,
        actInstructions: listener.actInstructions,
        actSessionMode: listener.actSessionMode,
        actCode: listener.actCode,
        actWindowSeconds: listener.actWindowSeconds,
        hourlyRunCap: listener.hourlyRunCap,
        dailyRunCap: listener.dailyRunCap,
        lastAct: listener.lastAct,
      }}
      lead={
        <TriggerRow
          id={`listener-${listener.id}-chat`}
          label={agent ? "Reports in" : "Chat"}
        >
          {chats.length > 1 ? (
            <Select
              items={chatItems}
              value={listener.channelId}
              disabled={!canManage}
              onValueChange={(value) => {
                if (value && value !== listener.channelId) {
                  onPatch({ channelId: value })
                }
              }}
            >
              <SelectTrigger
                id={`listener-${listener.id}-chat`}
                size="sm"
                className="w-44"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {chats.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground text-sm">
              {chat?.name ?? "Chat"}
            </span>
          )}
        </TriggerRow>
      }
      onPatch={onPatch}
    />
  )
}

// What became of a delivery, as the activity list says it.
const OUTCOME_LABEL: Record<string, string> = {
  wake: "Woke the agent",
  wait: "Left for the agent to read later",
  filtered: "Turned away by “Only when”",
  hourly_cap: "Hourly limit reached, left for later",
  daily_cap: "Daily limit reached, left for later",
  no_agent: "No agent in the chat",
  off: "Posted only",
  error: "Could not be delivered",
}

const ACTIVITY_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

// What arrived for a listener and what became of it. Out of the way: a place
// to look when someone wonders what is going on.
function ListenerActivity({
  workspaceSlug,
  connectionId,
  listenerId,
  agentName,
}: {
  workspaceSlug: string
  connectionId: string
  listenerId: string
  agentName?: string
}) {
  const [open, setOpen] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: ["listener-activity", workspaceSlug, connectionId, listenerId],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].listeners[":listenerId"].activity.$get({
        param: { workspaceSlug, connectionId, listenerId },
      })
      if (!res.ok) throw new Error("Failed to load activity")
      return (await res.json()).deliveries
    },
    enabled: open,
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Activity"
        title="Activity"
        className={cn(
          "ml-auto flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground data-popup-open:text-foreground",
          PRESS,
          FOCUS
        )}
      >
        <HugeiconsIcon
          icon={Clock01Icon}
          className="size-3.5"
          strokeWidth={2}
        />
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80">
        <div className="space-y-2.5">
          <p className="font-medium text-sm">
            {agentName ? `What ${agentName} heard` : "Activity"}
          </p>
          {isPending && <Spinner className="size-3.5 text-muted-foreground" />}
          {data?.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Nothing has arrived yet.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="-mr-2 max-h-64 space-y-2 overflow-y-auto pr-2">
              {data.map((delivery) => (
                <li key={delivery.id} className="text-xs">
                  <span className="block">
                    {OUTCOME_LABEL[delivery.outcome ?? ""] ??
                      (delivery.posted ? "Posted" : "Received")}
                  </span>
                  <span className="block text-muted-foreground tabular-nums">
                    {ACTIVITY_TIME.format(new Date(delivery.at))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
