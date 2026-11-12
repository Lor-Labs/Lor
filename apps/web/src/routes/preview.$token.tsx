import { createFileRoute } from "@tanstack/react-router"
import { PreviewPage } from "@/components/preview/preview-page"

// A preview link (reference/planned/sandbox-browser-runbook.md §8): a code
// session's live browser on its own page, outside the app shell, for
// stakeholders. Signed-out visitors reach it too; the API decides what each
// visitor sees.
export const Route = createFileRoute("/preview/$token")({
  component: PreviewRoute,
})

function PreviewRoute() {
  const { token } = Route.useParams()
  return <PreviewPage key={token} token={token} />
}
