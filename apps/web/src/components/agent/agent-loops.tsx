import { ArrowRight01Icon, Infinity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import { cn } from "@repo/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { sortLoops } from "@/components/loops/loop-row"
import {
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import type { WorkspaceAgent } from "@/hooks/use-agents"
import { type ChannelLoop, useAgentLoops } from "@/hooks/use-channel-loops"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

const STATUS_WORD: Partial<Record<ChannelLoop["status"], string>> = {
  paused: "Paused",
  draft: "Draft",
  completed: "Completed",
}

// Paused because the agent was taken out of the chat the Loop reports in.
const statusWord = (loop: ChannelLoop) =>
  loop.status === "paused" && loop.pausedReason === "agent_left"
    ? "Not in this chat"
    : STATUS_WORD[loop.status]

// An agent's loops: the ones it runs, by the chat each reports in. A loop
// belongs to its agent (reference/agents-and-chats.md, decisions 15 and 23),
// whichever other agents are in that chat. A loop opens in its chat, where
// it is paused, edited, handed to another agent and deleted.
export function AgentLoops({
  workspaceSlug,
  agent,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
}) {
  const navigate = useNavigate()
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const { data: loops } = useAgentLoops(workspaceSlug, agent.id)

  if (!list || !loops) {
    return <p className="px-4 text-muted-foreground text-sm">Loading…</p>
  }
  // In the order of the chat list; a chat that is put away comes last.
  const chats = openTextChannels(list)
  const groups = [...new Set(loops.map((loop) => loop.channelId))]
    .map((channelId) => ({
      channel: chats.find((chat) => chat.id === channelId) ?? {
        id: channelId,
        name: null,
      },
      loops: sortLoops(loops.filter((loop) => loop.channelId === channelId)),
    }))
    .sort(
      (a, b) =>
        (chats.findIndex((chat) => chat.id === a.channel.id) + 1 ||
          chats.length + 1) -
        (chats.findIndex((chat) => chat.id === b.channel.id) + 1 ||
          chats.length + 1)
    )
  if (groups.length === 0) {
    return (
      <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground text-sm dark:bg-muted/60">
        No loops yet. Ask {agent.name} in a chat to do something on a schedule,
        and it sets one up there.
      </p>
    )
  }

  const openLoop = (loop: ChannelLoop) =>
    // Leaves this dialog: the loop's panel opens beside its channel.
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId: loop.channelId },
      search: { loop: loop.id },
    })

  return (
    <>
      {groups.map(({ channel, loops }) => (
        <SettingsSection
          key={channel.id}
          title={channel.name ?? "A chat that was put away"}
          count={loops.length}
        >
          <SettingsGroup>
            {loops.map((loop) => {
              const live = loop.status === "active" || loop.status === "draft"
              return (
                <button
                  key={loop.id}
                  type="button"
                  onClick={() => openLoop(loop)}
                  className={cn(
                    "group flex min-h-14 w-full cursor-pointer items-center gap-3 text-left outline-none transition-opacity duration-150 focus-visible:[&_[data-name]]:underline",
                    loop.status === "completed" && "opacity-60"
                  )}
                >
                  <HugeiconsIcon
                    icon={Infinity01Icon}
                    size={16}
                    className={cn(
                      "shrink-0",
                      live ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      data-name
                      className="block truncate font-medium text-sm"
                    >
                      {loop.name}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {describeLoopSchedule(loop.schedule, null)}
                    </span>
                  </span>
                  {statusWord(loop) && (
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {statusWord(loop)}
                    </span>
                  )}
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={16}
                    className="shrink-0 text-muted-foreground/60 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
                  />
                </button>
              )
            })}
          </SettingsGroup>
        </SettingsSection>
      ))}
    </>
  )
}
