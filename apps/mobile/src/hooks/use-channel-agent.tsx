import { type CreatureId, channelAgentIdentity } from "@repo/utils/bestiary"
import { createContext, type ReactNode, useContext, useMemo } from "react"
import { useChannelDetail } from "@/hooks/use-channel-detail"

export type ChannelAgent = { name: string; creature: CreatureId }

const ChannelAgentContext = createContext<ChannelAgent | null>(null)

// Lor's messages in a text channel's chat and threads are its agent's: the
// name and creature the team picked (reference/always-on-agents.md,
// decisions 32 and 33). Sessions have no provider, so Lor stays Lor there.
export function ChannelAgentProvider({
  workspaceSlug,
  channelId,
  children,
}: {
  workspaceSlug: string
  channelId: string
  children: ReactNode
}) {
  const { channel } = useChannelDetail({ workspaceSlug, channelId })
  const agent = useMemo(
    () =>
      channel && channel.type === "text" ? channelAgentIdentity(channel) : null,
    [channel]
  )
  return <ChannelAgentContext value={agent}>{children}</ChannelAgentContext>
}

export function useChannelAgent() {
  return useContext(ChannelAgentContext)
}
