import { createFileRoute } from "@tanstack/react-router"
import { NewSessionView } from "@/components/session/new-session-view"

type NewSessionSearchParams = {
  // Preselects the session's channel (the channel the person was in).
  channelId?: string
  // "Ask Lor about this": the message the session starts with, from
  // `channelId` (the channel is then fixed).
  about?: string
  // Prefills the prompt (a meeting card's suggested question).
  draft?: string
  // "Continue in Code": the session to continue, from `channelId` (the
  // channel is then fixed and the mode starts on Code).
  continueFrom?: string
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
    about: typeof search.about === "string" ? search.about : undefined,
    draft:
      typeof search.draft === "string" ? search.draft.slice(0, 500) : undefined,
    continueFrom:
      typeof search.continueFrom === "string" ? search.continueFrom : undefined,
  }),
})

function NewSessionRoute() {
  const { workspaceSlug } = Route.useParams()
  const { channelId, about, draft, continueFrom } = Route.useSearch()
  return (
    <NewSessionView
      key={`${workspaceSlug}:${about ?? ""}:${continueFrom ?? ""}`}
      workspaceSlug={workspaceSlug}
      channelId={channelId}
      aboutMessageId={about}
      continueFromSessionId={continueFrom}
      draft={draft}
    />
  )
}
