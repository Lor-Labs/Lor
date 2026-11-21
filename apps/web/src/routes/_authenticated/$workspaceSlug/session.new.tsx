import { createFileRoute } from "@tanstack/react-router"
import type { SessionHarness } from "@/components/session/harness-picker"
import { NewSessionView } from "@/components/session/new-session-view"

type NewSessionSearchParams = {
  // Preselects the session's channel (the channel the person was in).
  channelId?: string
  // Prefills the prompt.
  draft?: string
  // "Continue in Code": the session to continue, from `channelId` (the
  // channel is then fixed).
  continueFrom?: string
  // Opens on this harness.
  harness?: SessionHarness
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
    draft:
      typeof search.draft === "string" ? search.draft.slice(0, 500) : undefined,
    continueFrom:
      typeof search.continueFrom === "string" ? search.continueFrom : undefined,
    harness:
      search.harness === "claude_code" || search.harness === "codex"
        ? search.harness
        : undefined,
  }),
})

function NewSessionRoute() {
  const { workspaceSlug } = Route.useParams()
  const { channelId, draft, continueFrom, harness } = Route.useSearch()
  return (
    <NewSessionView
      key={`${workspaceSlug}:${continueFrom ?? ""}`}
      workspaceSlug={workspaceSlug}
      channelId={channelId}
      continueFromSessionId={continueFrom}
      startHarness={harness}
      draft={draft}
    />
  )
}
