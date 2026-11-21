import { authClient } from "@repo/auth/client"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/tooltip"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { useChannelAgentContext } from "@/components/agent/channel-agent"
import { EditChannelDialog } from "@/components/sidebar/channel-panel/edit-channel-dialog"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { channelQueryOptions } from "@/lib/channel-query"

const STATE_TEXT = {
  asleep: "is resting. Mention it to wake it.",
  idle: "is here.",
  working: "is working.",
  needs_you: "is waiting on you.",
} as const

// The channel agent in the header: its creature in its real state and its
// name. Opens the Agent settings for people who manage channels and for the
// channel's creator.
export function AgentHeaderChip({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const agent = useChannelAgentContext()
  const canManage = useCanManageChannels(workspaceSlug)
  const { data: session } = authClient.useSession()
  const { data: channel } = useQuery(
    channelQueryOptions(workspaceSlug, channelId)
  )
  const [open, setOpen] = useState(false)
  if (!agent) return null
  // Its creator may name the agent too (the API allows it).
  const canEdit =
    canManage ||
    (!!channel?.creatorId && channel.creatorId === session?.user.id)
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setOpen(true)}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1 text-sm transition-colors enabled:cursor-pointer enabled:hover:bg-foreground/5"
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
          {canEdit ? " Click for its settings." : ""}
        </TooltipContent>
      </Tooltip>
      {canEdit && channel && (
        <EditChannelDialog
          channel={channel}
          open={open}
          onOpenChange={setOpen}
          overviewOnly={!canManage}
          initialTab="profile"
        />
      )}
    </>
  )
}
