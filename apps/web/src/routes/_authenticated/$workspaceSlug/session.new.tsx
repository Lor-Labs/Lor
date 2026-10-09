import { createFileRoute } from "@tanstack/react-router"
import { NewSessionView } from "@/components/session/new-session-view"

type NewSessionSearchParams = {
  // Preselects the session's channel (the channel the person was in).
  channelId?: string
}

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/session/new"
)({
  component: NewSessionRoute,
  validateSearch: (
    search: Record<string, unknown>
  ): NewSessionSearchParams => ({
    channelId:
      typeof search.channelId === "string" ? search.channelId : undefined,
  }),
})

function NewSessionRoute() {
  const { workspaceSlug } = Route.useParams()
  const { channelId } = Route.useSearch()
  return (
    <NewSessionView
      key={workspaceSlug}
      workspaceSlug={workspaceSlug}
      channelId={channelId}
    />
  )
}
