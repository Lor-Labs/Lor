import { createFileRoute } from "@tanstack/react-router"
import { SessionView } from "@/components/session/session-view"

type SessionSearchParams = {
  // Opens a file in the right panel (file cards in the transcript and the
  // rail): one of Lor's, or an upload as "<messageId>.<index>".
  artifactId?: string
  upload?: string
}

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/session/$sessionId"
)({
  component: SessionRoute,
  validateSearch: (search: Record<string, unknown>): SessionSearchParams => ({
    artifactId:
      typeof search.artifactId === "string" ? search.artifactId : undefined,
    upload: typeof search.upload === "string" ? search.upload : undefined,
  }),
})

function SessionRoute() {
  const { workspaceSlug, sessionId } = Route.useParams()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SessionView workspaceSlug={workspaceSlug} sessionId={sessionId} />
    </div>
  )
}
