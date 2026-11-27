import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { apiClient } from "@/lib/api-client"

type ConnectSearch = { token?: string }

// `/lor connect-account` in Discord links here: the signed-in person's Lor account
// takes the Discord account the token names (reference/always-on-agents.md
// §10), so their Discord messages post as them and they can decide
// approvals from Discord.
export const Route = createFileRoute("/_authenticated/discord/connect")({
  component: DiscordConnect,
  validateSearch: (search: Record<string, unknown>): ConnectSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
})

// Display only: the server checks the token's signature and expiry.
function discordUsernameOf(token: string | undefined): string | null {
  const payload = token?.split(".")[0]
  if (!payload) return null
  try {
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    const json = new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0))
    )
    const data = JSON.parse(json) as { n?: unknown }
    return typeof data.n === "string" ? data.n : null
  } catch {
    return null
  }
}

function DiscordConnect() {
  const { token } = Route.useSearch()
  const router = useRouter()
  const { data: session } = authClient.useSession()
  const [linking, setLinking] = useState(false)
  const discordUsername = discordUsernameOf(token)
  // Set once the person leaves: a late answer must not move them.
  const leftRef = useRef(false)
  useEffect(() => {
    leftRef.current = false
    return () => {
      leftRef.current = true
    }
  }, [])

  // Linking needs the person's consent: someone else's `/lor connect-account` link
  // would otherwise attach their Discord account to this Lor account.
  const link = async () => {
    if (!token) return
    setLinking(true)
    try {
      const res = await apiClient.v1.discord.connect
        .$post({ json: { token } })
        .catch(() => null)
      if (res?.ok) {
        // The link is made even if its body can't be read.
        const body = await res.json().catch(() => null)
        if (leftRef.current) return
        toast.success(
          `Linked Discord account ${body?.account?.username ?? ""}`.trim()
        )
      } else {
        const message = res
          ? (
              (await res.json().catch(() => null)) as {
                message?: string
              } | null
            )?.message
          : null
        if (leftRef.current) return
        toast.error(message ?? "Couldn't link your Discord account")
      }
      router.history.replace("/")
    } finally {
      if (!leftRef.current) setLinking(false)
    }
  }

  if (!token || !discordUsername) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-muted-foreground">
          This link is wrong or expired. Run /lor connect-account again.
        </p>
        <Button variant="outline" onClick={() => router.history.replace("/")}>
          Go back
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col gap-4 text-sm">
        <h1 className="font-medium text-base">Link your Discord account?</h1>
        <p className="text-muted-foreground">
          Discord account{" "}
          <span className="font-medium text-foreground">{discordUsername}</span>{" "}
          will post and decide approvals as{" "}
          <span className="font-medium text-foreground">
            {session?.user.name ?? "you"}
          </span>
          {session?.user.email ? ` (${session.user.email})` : ""}. Only continue
          if you ran /lor connect-account yourself.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={linking}
            onClick={() => router.history.replace("/")}
          >
            Cancel
          </Button>
          <Button disabled={linking} onClick={() => void link()}>
            {linking && <Spinner />}
            Link account
          </Button>
        </div>
      </div>
    </div>
  )
}
