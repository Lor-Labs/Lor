import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { readLastChannelId } from "@/lib/last-location"
import {
  firstTextChannelId,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

export const Route = createFileRoute("/_authenticated/$workspaceSlug/")({
  component: WorkspaceHome,
})

function WorkspaceHome() {
  const { workspaceSlug } = Route.useParams()
  const { settings, tab, mcpServerId } = Route.useSearch()
  const navigate = useNavigate()
  const lastChannelId = readLastChannelId(workspaceSlug)
  const { data: channels } = useQuery({
    ...workspaceChannelsQueryOptions(workspaceSlug),
    enabled: !lastChannelId,
  })

  // First visit (invite accept, new device): no remembered channel, so land
  // in the first text channel rather than an empty page.
  const targetChannelId =
    lastChannelId ?? (channels ? firstTextChannelId(channels) : null)

  useEffect(() => {
    if (!targetChannelId) return
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId: targetChannelId },
      search: { settings, tab, mcpServerId },
      replace: true,
    })
  }, [workspaceSlug, targetChannelId, settings, tab, mcpServerId, navigate])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <HeaderNavControls className="-ml-2" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          Select a channel to start chatting
        </span>
      </div>
    </div>
  )
}
