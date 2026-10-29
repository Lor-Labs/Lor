import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { apiClient } from "@/lib/api-client"
import { takeGithubInstallReturn } from "@/lib/github-connect"

type SetupSearch = {
  installation_id?: string
  setup_action?: string
  state?: string
}

// GitHub's Setup URL: after an install (or a configure-page update) it lands
// here with ?installation_id=… and, usually, the signed state. The server
// picks the workspace from the state or the recorded connect intent, links
// the install, and says where to go.
export const Route = createFileRoute(
  "/_authenticated/integrations/github/setup"
)({
  component: GithubSetup,
  validateSearch: (search: Record<string, unknown>): SetupSearch => {
    // GitHub sends a numeric installation id; ignore anything that isn't one.
    const raw =
      typeof search.installation_id === "string"
        ? search.installation_id
        : typeof search.installation_id === "number"
          ? String(search.installation_id)
          : undefined
    return {
      installation_id: raw && /^\d+$/.test(raw) ? raw : undefined,
      setup_action:
        typeof search.setup_action === "string"
          ? search.setup_action
          : undefined,
      state: typeof search.state === "string" ? search.state : undefined,
    }
  },
})

async function errorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { message?: unknown }
    return typeof body.message === "string" ? body.message : fallback
  } catch {
    return fallback
  }
}

function GithubSetup() {
  const { installation_id, setup_action, state } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    const back = takeGithubInstallReturn()
    const leave = () =>
      back ? router.history.replace(back) : navigate({ to: "/", replace: true })

    void (async () => {
      // A member of a GitHub org without install rights only sends a request;
      // an org owner has to approve it on GitHub.
      if (setup_action === "request") {
        toast.info("GitHub sent the install request to an organization owner")
        await leave()
        return
      }
      if (!installation_id) {
        toast.error("Missing GitHub install details")
        await leave()
        return
      }
      try {
        const res = await apiClient.v1.integrations.github.setup.$post({
          json: { installationId: installation_id, state },
        })
        if (!res.ok) {
          toast.error(await errorMessage(res, "Couldn't connect GitHub"))
          await leave()
          return
        }
        const { workspaceSlug } = await res.json()
        toast.success("GitHub connected")
        if (back?.startsWith(`/${workspaceSlug}/`)) {
          router.history.replace(back)
          return
        }
        // The workspace root routes ?connector= to setup or the connector's
        // detail.
        await navigate({
          to: "/$workspaceSlug",
          params: { workspaceSlug },
          search: { connector: "github" },
          replace: true,
        })
      } catch {
        toast.error("Couldn't connect GitHub")
        await leave()
      }
    })()
  }, [installation_id, setup_action, state, navigate, router])

  return (
    <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-4" />
      Connecting GitHub…
    </div>
  )
}
