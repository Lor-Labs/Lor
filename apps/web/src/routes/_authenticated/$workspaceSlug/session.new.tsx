import { createFileRoute } from "@tanstack/react-router"
import type { SessionHarness } from "@/components/session/harness-picker"
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
  // Opens on this harness ("Continue with Lor" from a Claude Code session).
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
    about: typeof search.about === "string" ? search.about : undefined,
    draft:
      typeof search.draft === "string" ? search.draft.slice(0, 500) : undefined,
    continueFrom:
      typeof search.continueFrom === "string" ? search.continueFrom : undefined,
    harness:
      search.harness === "pi" || search.harness === "claude_code"
        ? search.harness
        : undefined,
  }),
})

function NewSessionRoute() {
  const { workspaceSlug } = Route.useParams()
  const { channelId, about, draft, continueFrom, harness } = Route.useSearch()
  return (
    <NewSessionView
      key={`${workspaceSlug}:${about ?? ""}:${continueFrom ?? ""}`}
      workspaceSlug={workspaceSlug}
      channelId={channelId}
      aboutMessageId={about}
      continueFromSessionId={continueFrom}
      startHarness={harness}
      draft={draft}
    />
  )
}
