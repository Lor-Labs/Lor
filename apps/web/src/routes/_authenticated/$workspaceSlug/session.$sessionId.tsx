import { createFileRoute } from "@tanstack/react-router"
import { AnimatePresence } from "framer-motion"
import { ArtifactOverlay } from "@/components/artifacts/artifact-overlay"
import { SessionView } from "@/components/session/session-view"

type SessionSearchParams = {
  // Opens the artifact viewer over the session (file cards in the transcript
  // and the rail).
  artifactId?: string
}

export const Route = createFileRoute(
  "/_authenticated/$workspaceSlug/session/$sessionId"
)({
  component: SessionRoute,
  validateSearch: (search: Record<string, unknown>): SessionSearchParams => ({
    artifactId:
      typeof search.artifactId === "string" ? search.artifactId : undefined,
  }),
})

function SessionRoute() {
  const { workspaceSlug, sessionId } = Route.useParams()
  const { artifactId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <SessionView workspaceSlug={workspaceSlug} sessionId={sessionId} />
      <AnimatePresence>
        {artifactId && (
          <ArtifactOverlay
            key={artifactId}
            artifactId={artifactId}
            onClose={() =>
              void navigate({
                search: (prev) => ({ ...prev, artifactId: undefined }),
                replace: true,
              })
            }
          />
        )}
      </AnimatePresence>
    </div>
  )
}
