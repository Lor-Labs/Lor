import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { MAX_CHANNEL_AGENTS } from "@repo/db/constants"
import { Button } from "@repo/ui/components/button"
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelAgentContext } from "@/components/agent/channel-agent"
import { useAgentDialog } from "@/hooks/use-agent-dialog"
import {
  agentCreature,
  useAgents,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { refreshAgents, setChannelAgents } from "@/lib/agent-api"
import { channelQueryOptions } from "@/lib/channel-query"

const STATE_LABELS = {
  asleep: "Resting",
  idle: "Here",
  working: "Working",
  needs_you: "Needs you",
} as const

const row =
  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"

// The agents in a channel, at the top of its right panel
// (reference/agents-and-chats.md, decision 19). A row opens that agent's
// dialog. The last row adds one, for people who manage channels. A channel
// other than a text channel has no agents and shows nothing.
export function ChannelAgentsSection({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const { data: channel } = useQuery({
    ...channelQueryOptions(workspaceSlug, channelId),
    enabled: Boolean(workspaceSlug && channelId),
  })
  const agents = useAgents(workspaceSlug)
  const canManage = useCanManageChannels(workspaceSlug)
  // The one that answers here, with what it is doing now.
  const answering = useChannelAgentContext()
  const dialog = useAgentDialog()
  if (!channel || channel.type !== "text") return null

  const here = channel.agentIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? []
  )
  const canAdd = canManage && !channel.archivedAt
  if (here.length === 0 && !canAdd) return null

  return (
    <section aria-label="Agents">
      <div className="px-1 pb-1 text-[11px] text-muted-foreground">
        {here.length > 0 ? `Agents · ${here.length}` : "Agents"}
      </div>
      <div className="space-y-0.5">
        {here.map((agent) => {
          const state =
            answering?.id === agent.id ? answering.state : ("asleep" as const)
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => dialog.open(agent.id)}
              className={row}
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <AgentCreature
                  creature={agentCreature(agent)}
                  state={state}
                  size={28}
                  still={state !== "working"}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[13px]">
                  {agent.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {agent.role ?? "Agent"}
                </span>
              </span>
              <span className="max-w-16 shrink-0 truncate pl-2 text-[11px] text-muted-foreground">
                {STATE_LABELS[state]}
              </span>
            </button>
          )
        })}
        {canAdd && (
          <AddAgent
            workspaceSlug={workspaceSlug}
            channelId={channelId}
            here={here}
            others={agents.filter((agent) => !here.includes(agent))}
          />
        )}
      </div>
    </section>
  )
}

// The workspace's other agents, to put in this channel, and a way to make a
// new one. An agent's name opens its dialog, so one that is in no channel
// can still be set up or deleted from here.
function AddAgent({
  workspaceSlug,
  channelId,
  here,
  others,
}: {
  workspaceSlug: string
  channelId: string
  here: WorkspaceAgent[]
  others: WorkspaceAgent[]
}) {
  const queryClient = useQueryClient()
  const dialog = useAgentDialog()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // At the limit, the one picked takes the place of the one here.
  const full = here.length >= MAX_CHANNEL_AGENTS
  const replaced = full ? here[here.length - 1] : undefined

  const place = async (agent: WorkspaceAgent) => {
    setBusy(true)
    try {
      await setChannelAgents(workspaceSlug, channelId, [
        ...here.filter((item) => item !== replaced).map((item) => item.id),
        agent.id,
      ])
      await refreshAgents(queryClient, workspaceSlug)
      setOpen(false)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add the agent"
      )
    } finally {
      setBusy(false)
    }
  }
  const openAgent = (id: string) => {
    setOpen(false)
    dialog.open(id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              row,
              "group text-muted-foreground hover:text-foreground data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
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
        <span className="text-[13px]">Add agent</span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-24px)]"
        viewportClassName="p-1.5"
      >
        <PopoverTitle className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
          {replaced ? `Replace ${replaced.name} with` : "Add to this channel"}
        </PopoverTitle>
        {others.map((agent) => (
          <div key={agent.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openAgent(agent.id)}
              title={`${agent.name}'s settings`}
              className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
            >
              <AgentCreature creature={agentCreature(agent)} size={22} still />
              <span className="min-w-0 truncate font-medium">{agent.name}</span>
              {agent.role && (
                <span className="min-w-0 shrink-[2] truncate text-muted-foreground text-xs">
                  {agent.role}
                </span>
              )}
            </button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void place(agent)}
              aria-label={
                replaced
                  ? `Replace ${replaced.name} with ${agent.name}`
                  : `Add ${agent.name}`
              }
              className="mr-1 shrink-0"
            >
              {replaced ? "Replace" : "Add"}
            </Button>
          </div>
        ))}
        {others.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
        <button
          type="button"
          onClick={() => openAgent("new")}
          className="group flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-muted-foreground text-sm outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"
        >
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 border-dashed transition-colors duration-150 group-hover:border-foreground/60">
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-3"
              strokeWidth={2}
            />
          </span>
          New agent
        </button>
        {replaced && (
          <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
            A channel holds one agent for now.
          </p>
        )}
      </PopoverPopup>
    </Popover>
  )
}
