import { createFileRoute } from "@tanstack/react-router"
import { NewChatView } from "@/components/chat/new-chat-view"

// New chat: a start screen in place of a chat.
export const Route = createFileRoute("/_authenticated/$workspaceSlug/new")({
  component: NewChatRoute,
})

function NewChatRoute() {
  const { workspaceSlug } = Route.useParams()
  return <NewChatView key={workspaceSlug} workspaceSlug={workspaceSlug} />
}
