import { ArrowLeft01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { AgentChatMessage } from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useSocket } from "@/context/socket-context"
import { agentCreature, useAgentsById } from "@/hooks/use-agents"
import { apiClient } from "@/lib/api-client"

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
// A pause this long starts a new stretch, with its time above it.
const STRETCH_GAP_MS = 30 * 60_000

export const agentMessagesKey = (workspaceSlug: string, channelId: string) =>
  ["agent-messages", workspaceSlug, channelId] as const

export function agentMessagesQueryOptions(
  workspaceSlug: string,
  channelId: string
) {
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

// Adds what the agents say as they say it, for whoever has the chat open.
export function useAgentMessagesLive(workspaceSlug: string, channelId: string) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!socket) return
    const onCreated = (payload: {
      channelId: string
      message: AgentChatMessage
    }) => {
      if (payload.channelId !== channelId) return
      queryClient.setQueryData<AgentChatMessage[]>(
        agentMessagesKey(workspaceSlug, channelId),
        (messages) =>
          messages && !messages.some((item) => item.id === payload.message.id)
            ? [...messages, payload.message]
            : messages
      )
    }
    socket.on("agent-message:created", onCreated)
    return () => {
      socket.off("agent-message:created", onCreated)
    }
  }, [socket, queryClient, workspaceSlug, channelId])
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
  const { data: messages, isPending } = useQuery(
    agentMessagesQueryOptions(workspaceSlug, channelId)
  )
  useAgentMessagesLive(workspaceSlug, channelId)

  const scroller = useRef<HTMLDivElement>(null)
  const focused = useRef<HTMLDivElement>(null)
  const count = messages?.length ?? 0
  const opened = useRef(false)
  useEffect(() => {
    if (count === 0) return
    // Opens at the message asked for, else at the newest; then follows.
    if (!opened.current && focused.current) {
      focused.current.scrollIntoView({ block: "start" })
    } else if (scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight
    }
    opened.current = true
  }, [count])

  const agentIds = [
    ...new Set(
      (messages ?? []).flatMap((item) => [item.fromAgentId, item.toAgentId])
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
        className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-24"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
          {isPending && (
            <p className="py-10 text-center text-muted-foreground text-sm">
              Loading…
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
            // A run is one agent writing to one other: with three in the
            // chat, who a bubble is for matters as much as who wrote it.
            const sameRun = (other: (typeof messages)[number] | undefined) =>
              other?.fromAgentId === message.fromAgentId &&
              other?.toAgentId === message.toAgentId
            const first = stretch || !sameRun(before)
            const last = stretchEnds || !sameRun(after)
            return (
              <div
                key={message.id}
                ref={message.id === focusId ? focused : undefined}
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
                    {first && (
                      <div className="pb-1 pl-4 text-[12px] text-muted-foreground">
                        {nameOf(message.fromAgentId)}
                        {agentIds.length > 2 && (
                          <span className="text-muted-foreground/70">
                            {" "}
                            to {nameOf(message.toAgentId)}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="text-pretty rounded-[22px] bg-foreground/[0.06] px-4 py-2.5 text-[14px] text-foreground/90 leading-relaxed">
                      <MessageMarkdown
                        content={message.content}
                        mentions={[]}
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
