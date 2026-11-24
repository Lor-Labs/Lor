import {
  BubbleChatQuestionIcon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import type {
  AgentNeed,
  ServerToClientEvents,
  SidebarSession,
} from "@repo/realtime-types"
import { cn } from "@repo/ui/lib/utils"
import type { CreatureId } from "@repo/utils/bestiary"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useMemo } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import {
  SessionStateIndicator,
  useActivityWorkspaceId,
  useAllChannelActivity,
} from "@/components/sidebar/channel-panel/channel-activity"
import { useSocket } from "@/context/socket-context"
import {
  agentCreature,
  channelAgentOf,
  useAgentsById,
} from "@/hooks/use-agents"
import { workspaceActivityKey } from "@/hooks/use-workspace-activity"
import { toSearchPreviewText } from "@/lib/search-preview"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

type NeedRow = AgentNeed & { channelId: string }

// The asking agent's face. An empty slot keeps the rows aligned when the
// channel has no agent any more.
function NeedFace({ creature }: { creature: CreatureId | null }) {
  return creature ? (
    <AgentCreature creature={creature} size={24} still className="-mt-0.5" />
  ) : (
    <span className="size-6 shrink-0" />
  )
}
type SessionRow = SidebarSession & { channelId: string }

// What needs the person, gathered from every channel
// (reference/always-on-agents.md §9, decision 24): the channel agents'
// approvals and questions for them, and the sessions waiting on them.
// Requests get lost in chat scroll; here they stay until answered.
function useNeedsYou() {
  const channels = useAllChannelActivity()
  return useMemo(() => {
    const needs: NeedRow[] = []
    const waiting: SessionRow[] = []
    for (const activity of channels.values()) {
      for (const need of activity.agentNeeds) {
        needs.push({ ...need, channelId: activity.channelId })
      }
      for (const session of activity.sessions) {
        if (session.state === "needs_you") {
          waiting.push({ ...session, channelId: activity.channelId })
        }
      }
    }
    needs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { needs, waiting }
  }, [channels])
}

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

const rowClass =
  "flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent"

// The group above the channels. It shows only while something waits, so
// the sidebar has one list and no tab to check.
export function NeedsYouGroup() {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const workspaceId = useActivityWorkspaceId()
  const { data: session } = authClient.useSession()
  const { needs, waiting } = useNeedsYou()
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug ?? "")
  )
  const byId = useMemo(
    () =>
      new Map(
        (channels ? openTextChannels(channels) : []).map((channel) => [
          channel.id,
          channel,
        ])
      ),
    [channels]
  )
  const channelName = (channelId: string) =>
    byId.get(channelId)?.name ?? "channel"
  // A need whose channel has since lost its agent still shows, as Lor's.
  const agents = useAgentsById(workspaceSlug)
  const agentOf = (channelId: string) => {
    const agent = channelAgentOf(byId.get(channelId), agents)
    return agent
      ? { name: agent.name, creature: agentCreature(agent) }
      : { name: "Lor", creature: null }
  }

  // A question leaves once the person writes where it was asked: the
  // snapshot doesn't refetch on every chat message, so their own does it.
  const questionChannels = useMemo(
    () =>
      new Set(
        needs.filter((n) => n.kind === "question").map((n) => n.channelId)
      ),
    [needs]
  )
  useEffect(() => {
    if (!socket || !workspaceId || questionChannels.size === 0) return
    const onCreated: ServerToClientEvents["message:created"] = (message) => {
      if (message.author.id !== session?.user.id) return
      if (!questionChannels.has(message.channelId)) return
      void queryClient.invalidateQueries({
        queryKey: workspaceActivityKey(workspaceId),
      })
    }
    socket.on("message:created", onCreated)
    return () => {
      socket.off("message:created", onCreated)
    }
  }, [socket, workspaceId, questionChannels, session?.user.id, queryClient])

  if (!workspaceSlug) return null
  const openNeed = (need: NeedRow) =>
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId: need.channelId },
      search: need.threadRootId
        ? { threadId: need.threadRootId, threadMessageId: need.messageId }
        : { msgId: need.messageId },
    })
  const openSession = (row: SessionRow) =>
    void navigate({
      to: "/$workspaceSlug/session/$sessionId",
      params: { workspaceSlug, sessionId: row.id },
    })

  const count = needs.length + waiting.length
  const announcement =
    count === 0
      ? ""
      : `${count} ${count === 1 ? "item needs" : "items need"} you`

  return (
    <>
      {/* Stays mounted while the group is hidden, so a new need is announced. */}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {count > 0 && (
        <section aria-label="Needs you" className="mb-3">
          <h3 className="flex items-center gap-1.5 px-2 pb-1 font-medium text-muted-foreground text-xs">
            Needs you
            <span className="rounded-full bg-warning/20 px-1.5 font-semibold text-[11px] text-warning-foreground tabular-nums">
              {count}
            </span>
          </h3>
          {needs.map((need) => (
            <button
              key={`${need.kind}-${need.messageId}`}
              type="button"
              onClick={() => openNeed(need)}
              className={rowClass}
            >
              <NeedFace creature={agentOf(need.channelId).creature} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <HugeiconsIcon
                      icon={
                        need.kind === "approval"
                          ? SecurityCheckIcon
                          : BubbleChatQuestionIcon
                      }
                      className="mr-1 inline size-3.5 -translate-y-px text-warning"
                      strokeWidth={2}
                      aria-label={
                        need.kind === "approval" ? "Approval" : "Question"
                      }
                    />
                    {agentOf(need.channelId).name}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      in #{channelName(need.channelId)}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {timeAgo(need.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-muted-foreground text-xs">
                  {toSearchPreviewText(need.text, [], {
                    dropUnresolvedMentions: true,
                  }).trim()}
                </span>
              </span>
            </button>
          ))}
          {waiting.map((row) => (
            <SessionNeedRow
              key={row.id}
              row={row}
              channel={channelName(row.channelId)}
              onOpen={() => openSession(row)}
            />
          ))}
        </section>
      )}
    </>
  )
}

function SessionNeedRow({
  row,
  channel,
  onOpen,
}: {
  row: SessionRow
  channel: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(rowClass, "items-center")}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <SessionStateIndicator state={row.state} />
      </span>
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      <span className="shrink-0 text-muted-foreground text-xs">#{channel}</span>
    </button>
  )
}
