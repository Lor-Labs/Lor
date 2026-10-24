import { GitHubLogo } from "@repo/ui/components/logos/github"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import {
  GITHUB_CONNECT_RETURN_KEY,
  personalAccountsKey,
} from "@/hooks/use-personal-accounts"
import { apiClient } from "@/lib/api-client"

type CallbackSearch = {
  code?: string
  state?: string
  error?: string
}

// GitHub redirects here after a person authorizes the GitHub App for their
// own account (?code=…&state=…, or ?error=… on denial). The API verifies the
// state was minted for this user, then stores the tokens.
export const Route = createFileRoute(
  "/_authenticated/accounts/github/callback"
)({
  component: GithubAccountCallback,
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
})

function GithubAccountCallback() {
  const { code, state, error } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    void (async () => {
      if (error || !code || !state) {
        toast.error(
          error ? "GitHub connection cancelled" : "Missing GitHub authorization"
        )
      } else {
        const ok = await apiClient.v1["personal-accounts"].github.connect
          .$post({ json: { code, state } })
          .then((res) => res.ok)
          .catch(() => false)
        toast[ok ? "success" : "error"](
          ok ? "GitHub connected" : "Couldn't connect GitHub"
        )
        if (ok) {
          await queryClient.invalidateQueries({ queryKey: personalAccountsKey })
        }
      }
      let back: string | null = null
      try {
        back = localStorage.getItem(GITHUB_CONNECT_RETURN_KEY)
        localStorage.removeItem(GITHUB_CONNECT_RETURN_KEY)
      } catch {}
      router.history.replace(back ?? "/")
    })()
  }, [code, state, error, router, queryClient])

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4">
      <GitHubLogo className="size-10 text-foreground" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Connecting GitHub…
      </div>
    </div>
  )
}
