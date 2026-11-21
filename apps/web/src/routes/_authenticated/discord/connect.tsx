import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useRef } from "react"
import { apiClient } from "@/lib/api-client"

type ConnectSearch = { token?: string }

// `/lor connect` in Discord links here: the signed-in person's Lor account
// takes the Discord account the token names (reference/always-on-agents.md
// §10), so their Discord messages post as them and they can decide
// approvals from Discord.
export const Route = createFileRoute("/_authenticated/discord/connect")({
  component: DiscordConnect,
  validateSearch: (search: Record<string, unknown>): ConnectSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
})

function DiscordConnect() {
  const { token } = Route.useSearch()
  const router = useRouter()
  const ranRef = useRef(false)
  // Set once the person leaves: a late answer must not move them.
  const leftRef = useRef(false)
  useEffect(
    () => () => {
      leftRef.current = true
    },
    []
  )

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    void (async () => {
      const res = token
        ? await apiClient.v1.discord.connect
            .$post({ json: { token } })
            .catch(() => null)
        : null
      if (leftRef.current) return
      if (res?.ok) {
        const { account } = await res.json()
        toast.success(`Linked Discord account ${account?.username ?? ""}`)
      } else {
        const message =
          res && !res.ok
            ? (
                (await res.json().catch(() => null)) as {
                  message?: string
                } | null
              )?.message
            : null
        toast.error(message ?? "Couldn't link your Discord account")
      }
      router.history.replace("/")
    })()
  }, [token, router])

  return (
    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
      <Spinner />
      Linking your Discord account…
    </div>
  )
}
