import { ArrowLeft01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { AgentChatMessage } from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  AGENTS_MENTION,
  MessageMarkdown,
} from "@/components/chat/message-markdown"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useSocket } from "@/context/socket-context"
import { agentCreature, useAgentsById } from "@/hooks/use-agents"
import { useRealtimeRoom } from "@/hooks/use-realtime-room"
import { apiClient } from "@/lib/api-client"
import { toSearchPreviewText } from "@/lib/search-preview"

// A chat's agents talking to each other about its work
// (reference/agents-and-chats.md, decision 39): one conversation, oldest
// first, shown in place of the chat. Bubbles and no composer: it is theirs,
// people only read it. It exists in Lor only.

const LIST = new Intl.ListFormat("en", { type: "conjunction" })
const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
})
const TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})
// How much of the post it answers a reply's line shows.
const REPLY_PREVIEW_CHARS = 140
// A pause this long starts a new stretch, with its time above it.
const STRETCH_GAP_MS = 30 * 60_000

const agentMessagesKey = (workspaceSlug: string, channelId: string) =>
  ["agent-messages", workspaceSlug, channelId] as const

function agentMessagesQueryOptions(workspaceSlug: string, channelId: string) {
  return {
    queryKey: agentMessagesKey(workspaceSlug, channelId),
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].chats[
        ":channelId"
      ]["agent-messages"].$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to load the agents' chat")
      return (await res.json()).messages
    },
  }
}

// The chat's room carries agent-message:created; joining refetches history so
// posts made before the join are not missed.
function useAgentMessages(workspaceSlug: string, channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const key = agentMessagesKey(workspaceSlug, channelId)
  useRealtimeRoom(socket, "channel", channelId, key)
  const query = useQuery(agentMessagesQueryOptions(workspaceSlug, channelId))
  // Live posts are kept so one that lands while history loads (or before a
  // racing history response) is merged in by id once the list is there.
  const live = useRef(new Map<string, AgentChatMessage>())
  const merge = useCallback(() => {
    queryClient.setQueryData<AgentChatMessage[]>(
      agentMessagesKey(workspaceSlug, channelId),
      (messages) => {
        if (!messages) return messages
        const have = new Set(messages.map((item) => item.id))
        const missing = [...live.current.values()].filter(
          (item) => !have.has(item.id)
        )
        if (missing.length === 0) return messages
        return [...messages, ...missing].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )
      }
    )
  }, [queryClient, workspaceSlug, channelId])
  useEffect(() => {
    if (!socket) return
    const onCreated = (payload: {
      channelId: string
      message: AgentChatMessage
    }) => {
      if (payload.channelId !== channelId) return
      live.current.set(payload.message.id, payload.message)
      merge()
    }
    socket.on("agent-message:created", onCreated)
    return () => {
      socket.off("agent-message:created", onCreated)
    }
  }, [socket, channelId, merge])
  useEffect(() => {
    if (query.data) merge()
  }, [query.data, merge])
  return query
}

function stamp(iso: string) {
  const at = new Date(iso)
  const today = at.toDateString() === new Date().toDateString()
  return `${today ? "Today" : DAY.format(at)} ${TIME.format(at)}`
}

export function AgentsChatView({
  workspaceSlug,
  channelId,
  chatName,
  focusId,
  onBack,
}: {
  workspaceSlug: string
  channelId: string
  chatName: string
  // The message the "messaged" line was pressed for.
  focusId?: string
  onBack: () => void
}) {
  const agentsById = useAgentsById(workspaceSlug)
  const {
    data: messages,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useAgentMessages(workspaceSlug, channelId)

  const scroller = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())
  const count = messages?.length ?? 0
  const opened = useRef(false)
  // Follows new posts only while the reader is at the bottom.
  const atBottom = useRef(true)
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    if (count === 0) return
    // Opens at the message asked for, else at the newest; then follows.
    const focused = focusId ? rows.current.get(focusId) : undefined
    if (!opened.current && focused) {
      focused.scrollIntoView({ block: "start" })
    } else if (scroller.current && (!opened.current || atBottom.current)) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
    opened.current = true
  }, [count, focusId])
  // Only the newest 200 posts load (no cursor in the API): say so when the
  // post a feed line points at is older than that.
  const focusMissing =
    focusId !== undefined &&
    focusId !== "all" &&
    messages !== undefined &&
    messages.length > 0 &&
    !messages.some((item) => item.id === focusId)

  // A reply's line jumps to the post it answers and marks it for a moment.
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashId) return
    const timer = setTimeout(() => setFlashId(null), 1400)
    return () => clearTimeout(timer)
  }, [flashId])
  const jumpTo = (id: string) => {
    rows.current
      .get(id)
      ?.scrollIntoView({ block: "center", behavior: "smooth" })
    setFlashId(id)
  }
  // Agents are mentioned by id, as in a chat: the chips need their names.
  const mentions = useMemo(
    () =>
      [...agentsById.values()].map((agent) => ({
        id: agent.id,
        name: agent.name,
        image: null,
        avatarColor: null,
      })),
    [agentsById]
  )

  const agentIds = [
    ...new Set(
      (messages ?? []).flatMap((item) => [item.fromAgentId, ...item.toAgentIds])
    ),
  ]
  const nameOf = (id: string) => agentsById.get(id)?.name ?? "An agent"
  const face = (id: string, size: number) => {
    const agent = agentsById.get(id)
    return agent ? (
      <AgentCreature creature={agentCreature(agent)} size={size} still />
    ) : (
      <span
        className="rounded-full bg-foreground/10"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div className="fade-in-0 relative flex h-full min-w-0 flex-1 animate-in flex-col duration-200 motion-reduce:animate-none">
      <header className="relative flex h-12 shrink-0 items-center justify-center border-border border-b px-4">
        <div className="absolute left-4 flex items-center gap-1">
          <HeaderNavControls className="-ml-2" withDivider />
          <button
            type="button"
            onClick={onBack}
            aria-label={`Back to ${chatName}`}
            title={`Back to ${chatName}`}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground/[0.06] text-foreground/80 outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.1] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              className="size-4"
              strokeWidth={2}
            />
          </button>
        </div>
        <span className="flex h-8 max-w-[60%] items-center gap-2 rounded-full bg-foreground/[0.06] pr-3.5 pl-1.5 text-[13px]">
          <span className="flex shrink-0 items-center">
            {agentIds.map((id, index) => (
              <span
                key={id}
                className={cn(
                  "flex rounded-full ring-2 ring-background",
                  index > 0 && "-ml-2"
                )}
              >
                {face(id, 22)}
              </span>
            ))}
          </span>
          <span className="truncate font-medium">
            {agentIds.length > 0
              ? LIST.format(agentIds.map(nameOf))
              : "Between agents"}
          </span>
        </span>
      </header>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-24"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
          {isPending && !isError && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              Loading…
            </p>
          )}
          {isError && !messages && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground text-sm">
              <p>Couldn't load the agents' chat.</p>
              <button
                type="button"
                disabled={isRefetching}
                onClick={() => void refetch()}
                className="cursor-pointer rounded-sm underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60"
              >
                Try again
              </button>
            </div>
          )}
          {focusMissing && (
            <p className="pb-2 text-center text-[12px] text-muted-foreground">
              That message is older than what's shown here.
            </p>
          )}
          {messages?.length === 0 && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              The agents in {chatName} haven't messaged each other yet.
            </p>
          )}
          {messages?.map((message, index) => {
            const before = messages[index - 1]
            const after = messages[index + 1]
            const at = new Date(message.createdAt).getTime()
            const stretch =
              !before ||
              at - new Date(before.createdAt).getTime() > STRETCH_GAP_MS
            const stretchEnds =
              !after ||
              new Date(after.createdAt).getTime() - at > STRETCH_GAP_MS
            // As in a chat: an answer the agent marked as one is a reply
            // to the post it answers, and any other post names who it is
            // for with a mention.
            const parent = message.replyToId
              ? messages.find((item) => item.id === message.replyToId)
              : undefined
            const named = message.toEveryone
              ? `${AGENTS_MENTION} `
              : parent
                ? ""
                : message.toAgentIds.map((id) => `<@${id}> `).join("")
            // A run is one agent writing on: a reply starts a new one.
            const sameRun = (other: (typeof messages)[number] | undefined) =>
              other !== undefined && other.fromAgentId === message.fromAgentId
            const first = stretch || !sameRun(before) || parent !== undefined
            const last =
              stretchEnds || !sameRun(after) || Boolean(after?.replyToId)
            return (
              <div
                key={message.id}
                ref={(el) => {
                  if (el) rows.current.set(message.id, el)
                  else rows.current.delete(message.id)
                }}
                className="scroll-mt-4"
              >
                {stretch && (
                  <div
                    className={cn(
                      "pb-2 text-center text-[12px] text-muted-foreground/80 tabular-nums",
                      index > 0 && "pt-6"
                    )}
                  >
                    {stamp(message.createdAt)}
                  </div>
                )}
                <div className={cn("flex items-end gap-2", first && "pt-2")}>
                  {/* The face sits by the last bubble of a run. */}
                  <span className="flex w-6 shrink-0 justify-center pb-0.5">
                    {last && face(message.fromAgentId, 22)}
                  </span>
                  <div className="min-w-0 max-w-[85%]">
                    {parent && (
                      <button
                        type="button"
                        onClick={() => jumpTo(parent.id)}
                        title="Go to the post it answers"
                        className="mb-0.5 flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm pl-4 text-xs outline-none transition-opacity duration-150 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="mt-2 h-3 w-6 shrink-0 rounded-tl-md border-muted-foreground/40 border-t-2 border-l-2" />
                        {face(parent.fromAgentId, 16)}
                        <span className="shrink-0 font-semibold text-foreground/80">
                          {nameOf(parent.fromAgentId)}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {toSearchPreviewText(parent.content, mentions).slice(
                            0,
                            REPLY_PREVIEW_CHARS
                          )}
                        </span>
                      </button>
                    )}
                    {first && (
                      <div className="pb-1 pl-4 text-[12px] text-muted-foreground">
                        {nameOf(message.fromAgentId)}
                      </div>
                    )}
                    <div
                      className={cn(
                        "text-pretty rounded-[22px] bg-foreground/[0.06] px-4 py-2.5 text-[14px] text-foreground/90 leading-relaxed transition-colors duration-500 ease-out",
                        flashId === message.id && "bg-foreground/[0.13]"
                      )}
                    >
                      <MessageMarkdown
                        content={`${named}${message.content}`}
                        mentions={mentions}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Where the composer would be: people can't write here. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/80 to-transparent pt-10 pb-5">
        <span className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-[13px] text-muted-foreground shadow-sm">
          <HugeiconsIcon
            icon={SquareLock02Icon}
            className="size-4"
            strokeWidth={2}
          />
          Read-only
        </span>
      </div>
    </div>
  )
}
