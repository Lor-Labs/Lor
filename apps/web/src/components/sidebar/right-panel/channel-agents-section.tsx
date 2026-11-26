import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
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
import { type ReactElement, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelAgentsContext } from "@/components/agent/channel-agent"
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
// (reference/agents-and-chats.md, decisions 19 and 32). A row opens that
// agent's dialog. People who manage channels get a row that adds one while
// the channel has room, and a button on each row that takes that agent out.
// A channel other than a text channel has no agents and shows nothing.
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
  // What each one is doing here now.
  const live = useChannelAgentsContext()
  const dialog = useAgentDialog()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<string | null>(null)
  if (!channel || channel.type !== "text") return null

  const here = channel.agentIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? []
  )
  // A Discord channel's agents are set up from the Discord connector.
  const canChange = canManage && !channel.archivedAt && channel.kind !== "place"
  if (here.length === 0 && !canChange) return null
  const full = here.length >= MAX_CHANNEL_AGENTS
  const remove = async (agent: WorkspaceAgent) => {
    setRemoving(agent.id)
    try {
      await setChannelAgents(
        workspaceSlug,
        channelId,
        here.filter((item) => item !== agent).map((item) => item.id)
      )
      await refreshAgents(queryClient, workspaceSlug)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove the agent"
      )
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section aria-label="Agents">
      <div className="px-1 pb-1 text-[11px] text-muted-foreground">
        {here.length > 0 ? `Agents · ${here.length}` : "Agents"}
      </div>
      <div className="space-y-0.5">
        {here.map((agent) => {
          const state =
            live.find((item) => item.id === agent.id)?.state ??
            ("asleep" as const)
          return (
            <div
              key={agent.id}
              className="group relative flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/[0.04] has-[[data-agent-row]:active]:scale-[0.98]"
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <AgentCreature
                  creature={agentCreature(agent)}
                  state={state}
                  size={28}
                  still={state !== "working"}
                />
              </span>
              {/* The whole row opens the agent, under the button that takes
                  it out of the channel. */}
              <button
                type="button"
                data-agent-row
                onClick={() => dialog.open(agent.id)}
                className="min-w-0 flex-1 cursor-pointer text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
              >
                <span className="block truncate font-medium text-[13px]">
                  {agent.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {agent.role ?? "Agent"}
                </span>
              </button>
              <span className="max-w-16 shrink-0 truncate pl-2 text-[11px] text-muted-foreground">
                {STATE_LABELS[state]}
              </span>
              {canChange && (
                <button
                  type="button"
                  aria-label={`Remove ${agent.name} from this chat`}
                  title="Remove from this chat"
                  disabled={removing !== null}
                  onClick={() => void remove(agent)}
                  className="relative z-10 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color,color,transform] duration-150 ease-out hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96] disabled:pointer-events-none group-hover:opacity-100"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </button>
              )}
            </div>
          )
        })}
        {canChange && !full && (
          <AgentRoster
            workspaceSlug={workspaceSlug}
            channelId={channelId}
            here={here}
            others={agents.filter((agent) => !here.includes(agent))}
            trigger={
              <button
                type="button"
                className={cn(
                  row,
                  "group text-muted-foreground hover:text-foreground data-popup-open:bg-foreground/[0.04] data-popup-open:text-foreground"
                )}
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
              </button>
            }
          />
        )}
      </div>
    </section>
  )
}

// The workspace's other agents, to put in this channel, and a way to make a
// new one. An agent's name opens its dialog, so one that is in no channel
// can still be set up or deleted from here.
function AgentRoster({
  workspaceSlug,
  channelId,
  here,
  others,
  trigger,
}: {
  workspaceSlug: string
  channelId: string
  here: WorkspaceAgent[]
  others: WorkspaceAgent[]
  trigger: ReactElement
}) {
  const queryClient = useQueryClient()
  const dialog = useAgentDialog()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const place = async (agent: WorkspaceAgent) => {
    setBusy(true)
    try {
      await setChannelAgents(workspaceSlug, channelId, [
        ...here.map((item) => item.id),
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
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        align="start"
        sideOffset={6}
        className="w-64 max-w-[calc(100vw-24px)]"
        viewportClassName="p-1.5"
      >
        <PopoverTitle className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">
          Add to this chat
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
              aria-label={`Add ${agent.name}`}
              className="mr-1 shrink-0"
            >
              Add
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
      </PopoverPopup>
    </Popover>
  )
}
