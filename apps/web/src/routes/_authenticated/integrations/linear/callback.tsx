import { LinearLogo } from "@repo/ui/components/logos/linear"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2 } from "lucide-react"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"

type CallbackSearch = {
  code?: string
  state?: string
  error?: string
}

// Linear redirects here after OAuth consent with ?code=…&state=<workspaceSlug>
// (or ?error=… on denial). We exchange the code via the API, then bounce back
// into the workspace.
export const Route = createFileRoute(
  "/_authenticated/integrations/linear/callback"
)({
  component: LinearCallback,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
})

function LinearCallback() {
  const { code, state, error } = Route.useSearch()
  const navigate = useNavigate()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      if (error || !code || !state) {
        toast.error(
          error ? "Linear connection cancelled" : "Missing Linear authorization"
        )
        await navigate({ to: "/" })
        return
      }
      let connected = false
      try {
        const res = await apiClient.v1.workspaces[
          ":workspaceSlug"
        ].integrations.linear.connect.$post({
          param: { workspaceSlug: state },
          json: { code },
        })
        connected = res.ok
        toast[res.ok ? "success" : "error"](
          res.ok ? "Linear connected" : "Couldn't connect Linear"
        )
      } catch {
        toast.error("Couldn't connect Linear")
      }
      await navigate({
        to: "/$workspaceSlug",
        params: { workspaceSlug: state },
        search: connected ? { settings: "workspace", tab: "integrations" } : {},
        replace: true,
      })
    })()
  }, [code, state, error, navigate])

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4">
      <LinearLogo
        variant="logo"
        className="size-10 fill-current text-foreground"
      />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Connecting Linear…
      </div>
    </div>
  )
}
