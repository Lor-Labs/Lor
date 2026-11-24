import { PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { toast } from "@repo/ui/components/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelAgentContext } from "@/components/agent/channel-agent"
import { useAgentDialog } from "@/hooks/use-agent-dialog"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { refreshAgents, setChannelAgents } from "@/lib/agent-api"
import { channelQueryOptions } from "@/lib/channel-query"

const STATE_TEXT = {
  asleep: "is resting. Mention it to wake it.",
  idle: "is here.",
  working: "is working.",
  needs_you: "is waiting on you.",
} as const

// The agent in the channel, in its header: its creature in its real state
// and its name. It opens the agent's own dialog. A text channel with no
// agent shows people who manage channels where to add one.
export function AgentHeaderChip({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const agent = useChannelAgentContext()
  const canManage = useCanManageChannels(workspaceSlug)
  const dialog = useAgentDialog()
  const { data: channel } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )
  if (!agent) {
    return canManage && channel?.type === "text" && !channel.archivedAt ? (
      <AddAgentMenu workspaceSlug={workspaceSlug} channelId={channelId} />
    ) : null
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => dialog.open(agent.id)}
            className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-1 text-sm outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
          />
        }
      >
        <AgentCreature
          creature={agent.creature}
          state={agent.state}
          size={24}
        />
        <span className="font-medium">{agent.name}</span>
      </TooltipTrigger>
      <TooltipContent>
        {agent.name} {STATE_TEXT[agent.state]}
      </TooltipContent>
    </Tooltip>
  )
}

function AddAgentMenu({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const queryClient = useQueryClient()
  const dialog = useAgentDialog()
  const agents = useAgents(workspaceSlug)
  const add = async (agentId: string) => {
    try {
      await setChannelAgents(workspaceSlug, channelId, [agentId])
      await refreshAgents(queryClient, workspaceSlug)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add the agent"
      )
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-muted-foreground/40 border-dashed pr-2.5 pl-2 text-muted-foreground text-sm outline-none transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-foreground/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97] data-popup-open:border-foreground/50 data-popup-open:text-foreground"
          />
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} className="size-3" strokeWidth={2} />
        Add agent
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        {agents.map((agent) => (
          <DropdownMenuItem key={agent.id} onClick={() => void add(agent.id)}>
            <AgentCreature creature={agentCreature(agent)} size={20} still />
            <span className="min-w-0 flex-1 truncate">{agent.name}</span>
            {agent.role && (
              <span className="max-w-24 shrink-0 truncate text-muted-foreground text-xs">
                {agent.role}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {agents.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => dialog.open("new")}>
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="size-4"
            strokeWidth={2}
          />
          New agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
