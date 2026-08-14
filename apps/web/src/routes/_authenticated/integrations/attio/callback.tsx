import { AttioLogo } from "@repo/ui/components/logos/attio"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { apiClient } from "@/lib/api-client"

type CallbackSearch = {
  code?: string
  state?: string
  error?: string
}

export const Route = createFileRoute(
  "/_authenticated/integrations/attio/callback"
)({
  component: AttioCallback,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
})

function AttioCallback() {
  const { code, state, error } = Route.useSearch()
  const navigate = useNavigate()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      if (error || !code || !state) {
        toast.error(
          error ? "Attio connection cancelled" : "Missing Attio authorization"
        )
        await navigate({ to: "/" })
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
        ].integrations.attio.connect.$post({
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
            ? "Attio connected"
            : (body?.message ?? "Couldn't connect Attio")
        )
      } catch {
        toast.error("Couldn't connect Attio")
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
      <AttioLogo className="size-10" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Connecting Attio…
      </div>
    </div>
  )
}
