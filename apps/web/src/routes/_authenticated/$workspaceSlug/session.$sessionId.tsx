import { createFileRoute } from "@tanstack/react-router"
import { SessionView } from "@/components/session/session-view"

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/session/$sessionId"
)({
  component: SessionRoute,
})

function SessionRoute() {
  const { workspaceSlug, sessionId } = Route.useParams()
  return <SessionView workspaceSlug={workspaceSlug} sessionId={sessionId} />
}
