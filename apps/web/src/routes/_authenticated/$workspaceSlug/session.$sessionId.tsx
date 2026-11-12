import { createFileRoute } from "@tanstack/react-router"
import { SessionView } from "@/components/session/session-view"

type SessionSearchParams = {
  // Opens a file in the right panel (file cards in the transcript and the
  // rail): one of Lor's, or an upload as "<messageId>.<index>".
  artifactId?: string
  upload?: string
  // A search result or citation: centers and highlights that message.
  msgId?: string
  // A code session's active tab beside the chat (use-session-tabs.ts).
  open?: string
  // The All changes tab scrolls to this file's diff, then drops it.
  at?: string
  // A folder reference reveals its directory in the Files panel.
  folder?: string
  // Opens a code session's side panel on this tab (a shared Browser link).
  // Not `panel`: the channel route's own means something else.
  side?: "browser"
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
    open: typeof search.open === "string" ? search.open : undefined,
    at: typeof search.at === "string" ? search.at : undefined,
    folder: typeof search.folder === "string" ? search.folder : undefined,
    side: search.side === "browser" ? "browser" : undefined,
  }),
})

function SessionRoute() {
  const { workspaceSlug, sessionId } = Route.useParams()
  const msgId = Route.useSearch({ select: (search) => search.msgId })
  const folder = Route.useSearch({ select: (search) => search.folder })
  const side = Route.useSearch({ select: (search) => search.side })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SessionView
        workspaceSlug={workspaceSlug}
        sessionId={sessionId}
        targetMessageId={msgId}
        targetFolder={folder}
        targetPanel={side}
      />
    </div>
  )
}
