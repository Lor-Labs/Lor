import { createFileRoute } from "@tanstack/react-router"
import { SessionView } from "@/components/session/session-view"

type SessionSearchParams = {
  // Opens a file in the right panel (file cards in the transcript and the
  // rail): one of Lor's, or an upload as "<messageId>.<index>".
  artifactId?: string
  upload?: string
  // A search result or citation: centers and highlights that message.
  msgId?: string
}

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/session/$sessionId"
)({
  component: SessionRoute,
  validateSearch: (search: Record<string, unknown>): SessionSearchParams => ({
    artifactId:
      typeof search.artifactId === "string" ? search.artifactId : undefined,
    upload: typeof search.upload === "string" ? search.upload : undefined,
    msgId: typeof search.msgId === "string" ? search.msgId : undefined,
  }),
})

function SessionRoute() {
  const { workspaceSlug, sessionId } = Route.useParams()
  const msgId = Route.useSearch({ select: (search) => search.msgId })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SessionView
        workspaceSlug={workspaceSlug}
        sessionId={sessionId}
        targetMessageId={msgId}
      />
    </div>
  )
}
