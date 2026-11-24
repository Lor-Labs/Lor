import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelAgentContext } from "@/components/agent/channel-agent"
import { useAgentDialog } from "@/hooks/use-agent-dialog"

const STATE_TEXT = {
  asleep: "is resting. Mention it to wake it.",
  idle: "is here.",
  working: "is working.",
  needs_you: "is waiting on you.",
} as const

// The agent that answers in the channel, in its header: its creature in its
// real state and its name. It opens the agent's own dialog. Adding one is in
// the channel's right panel.
export function AgentHeaderChip() {
  const agent = useChannelAgentContext()
  const dialog = useAgentDialog()
  if (!agent) return null
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
