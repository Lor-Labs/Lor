import { NotionLogo } from "@repo/ui/components/logos/notion"
import { Spinner } from "@repo/ui/components/spinner"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"

type CallbackSearch = {
  code?: string
  state?: string
  error?: string
}

export const Route = createFileRoute(
  "/_authenticated/integrations/notion/callback"
)({
  component: NotionCallback,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
})

function NotionCallback() {
  const { code, state, error } = Route.useSearch()
  const navigate = useNavigate()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      if (error || !code || !state) {
        toast.error(
          error ? "Notion connection cancelled" : "Missing Notion authorization"
        )
        await navigate({ to: "/", replace: true })
        return
      }
      // signOAuthState in apps/api/src/lib/oauth-state.ts emits
      // `${slug}.${expMs}.${sig}`. This split is only for callback routing;
      // verifyOAuthState in the API remains authoritative for validation.
      const slug = state.split(".")[0] ?? state
      let connected = false
      try {
        const res = await apiClient.v1.workspaces[
          ":workspaceSlug"
        ].integrations.notion.connect.$post({
          param: { workspaceSlug: slug },
          json: { code, state },
        })
        connected = res.ok
        const body = res.ok
          ? null
          : ((await res.json().catch(() => null)) as {
              message?: string
            } | null)
        toast[res.ok ? "success" : "error"](
          res.ok
            ? "Notion connected"
            : (body?.message ?? "Couldn't connect Notion")
        )
      } catch {
        toast.error("Couldn't connect Notion")
      }
      await navigate({
        to: "/$workspaceSlug",
        params: { workspaceSlug: slug },
        search: connected ? { settings: "workspace", tab: "connectors" } : {},
        replace: true,
      })
    })()
  }, [code, state, error, navigate])

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4">
      <NotionLogo className="size-10" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Connecting Notion…
      </div>
    </div>
  )
}
