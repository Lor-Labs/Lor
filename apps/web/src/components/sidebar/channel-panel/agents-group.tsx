import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { useParams } from "@tanstack/react-router"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useAllChannelActivity } from "@/components/sidebar/channel-panel/channel-activity"
import { useAgentDialog } from "@/hooks/use-agent-dialog"
import { agentStateIn } from "@/hooks/use-agent-state"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"

const STATE_LABELS = {
  asleep: "is resting",
  idle: "is here",
  working: "is working",
  needs_you: "is waiting on you",
} as const

const row =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-sm outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98]"

// The workspace's agents, above the channels they are in
// (reference/agents-and-chats.md). A row opens that agent's dialog; the last
// one makes a new agent, for people who manage channels.
export function AgentsGroup() {
  const { workspaceSlug } = useParams({ strict: false })
  const agents = useAgents(workspaceSlug)
  const canManage = useCanManageChannels(workspaceSlug)
  const activity = useAllChannelActivity()
  const dialog = useAgentDialog()
  if (!workspaceSlug || (agents.length === 0 && !canManage)) return null
  return (
    <section aria-label="Agents" className="mb-3">
      <h3 className="px-2 pb-1 font-medium text-muted-foreground text-xs">
        Agents
      </h3>
      {agents.map((agent) => {
        const state = agentStateIn(activity, agent)
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => dialog.open(agent.id)}
            title={`${agent.name} ${STATE_LABELS[state]}`}
            className={cn(
              row,
              dialog.agentId === agent.id && "bg-sidebar-accent"
            )}
          >
            <AgentCreature
              creature={agentCreature(agent)}
              state={state}
              size={22}
              still={state !== "working"}
              className="-my-1"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {agent.name}
            </span>
            {agent.role && (
              <span className="max-w-[45%] shrink-0 truncate text-muted-foreground text-xs">
                {agent.role}
              </span>
            )}
          </button>
        )
      })}
      {canManage && (
        <button
          type="button"
          onClick={() => dialog.open("new")}
          className={cn(
            row,
            "group text-muted-foreground hover:text-foreground"
          )}
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
      )}
    </section>
  )
}
