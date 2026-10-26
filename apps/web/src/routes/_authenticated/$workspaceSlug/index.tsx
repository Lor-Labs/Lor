import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { useWorkspaceSetup } from "@/hooks/use-workspace-setup"
import { readLastChannelId, readLastSessionId } from "@/lib/last-location"
import {
  firstTextChannelId,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

export const Route = createFileRoute("/_authenticated/$workspaceSlug/")({
  component: WorkspaceHome,
})

function WorkspaceHome() {
  const { workspaceSlug } = Route.useParams()
  const { settings, tab, mcpServerId, connector } = Route.useSearch()
  const navigate = useNavigate()
  const { status: setupStatus } = useWorkspaceSetup(workspaceSlug)
  const lastSessionId = readLastSessionId(workspaceSlug)
  const lastChannelId = readLastChannelId(workspaceSlug)
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )

  // First visit (invite accept, new device): no remembered channel, so land
  // in the first text channel rather than an empty page.
  const rememberedChannel =
    channels &&
    [
      ...channels.uncategorized,
      ...channels.categories.flatMap((category) => category.channels),
    ].find((channel) => channel.id === lastChannelId)
  const targetChannelId =
    rememberedChannel?.id ?? (channels ? firstTextChannelId(channels) : null)

  // Connector callbacks return with only ?connector=<id>, so nothing opens on
  // this page: unfinished setup shows the checklist, otherwise the
  // connector's settings detail opens over the channel.
  useEffect(() => {
    if (setupStatus === "loading") return
    if (setupStatus === "open") {
      void navigate({
        to: "/$workspaceSlug/setup",
        params: { workspaceSlug },
        replace: true,
      })
      return
    }
    const isConnectorReturn = connector !== undefined && settings === undefined
    const search = isConnectorReturn
      ? { settings: "workspace" as const, tab: "connectors", connector }
      : { settings, tab, mcpServerId, connector }
    if (lastSessionId) {
      void navigate({
        to: "/$workspaceSlug/session/$sessionId",
        params: { workspaceSlug, sessionId: lastSessionId },
        search,
        replace: true,
      })
      return
    }
    if (!targetChannelId) return
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId: targetChannelId },
      search,
      replace: true,
    })
  }, [
    workspaceSlug,
    setupStatus,
    lastSessionId,
    targetChannelId,
    settings,
    tab,
    mcpServerId,
    connector,
    navigate,
  ])

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
