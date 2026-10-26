import { authClient } from "@repo/auth/client"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// The person's own accounts (GitHub, a Claude subscription), never shared
// with the workspace (reference/planned/code-sessions-runbook.md, chunks 4
// and 7).

export const personalAccountsKey = ["personal-accounts"] as const

// Where the GitHub callback page goes back to. Unset in the desktop app's
// flow, which finishes in the system browser; the app refetches on focus.
export const GITHUB_CONNECT_RETURN_KEY = "lor:github-connect-return"

export function usePersonalAccounts() {
  const { data: session, refetch: refreshSession } = authClient.useSession()
  const accounts = useQuery({
    queryKey: personalAccountsKey,
    queryFn: async () => {
      const res = await apiClient.v1["personal-accounts"].$get()
      if (!res.ok) throw new Error("Failed to load your accounts")
      return res.json()
    },
  })
  useEffect(() => {
    if (!accounts.data?.github.account?.avatarUrl || session?.user.image) return
    // Covers existing connections and returning to desktop after browser OAuth.
    void refreshSession({ query: { disableCookieCache: true } })
  }, [
    accounts.dataUpdatedAt,
    accounts.data,
    session?.user.image,
    refreshSession,
  ])
  return accounts
}

export function useConnectGithubAccount() {
  return useMutation({
    mutationFn: async () => {
      const res =
        await apiClient.v1["personal-accounts"].github["connect-url"].$post()
      if (!res.ok) throw new Error("Couldn't start connecting GitHub")
      const { url } = await res.json()
      return url
    },
    onSuccess: (url) => {
      try {
        localStorage.setItem(
          GITHUB_CONNECT_RETURN_KEY,
          window.location.pathname + window.location.search
        )
      } catch {}
      openExternal(url)
    },
    onError: (err) => toast.error(err.message),
  })
}

// The token `claude setup-token` printed; the server checks it with
// Anthropic before storing it, so its message is the reason to show.
export function useConnectClaudeAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (token: string) => {
      const res = await apiClient.v1["personal-accounts"].claude.$post({
        json: { token },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't connect Claude")
      }
      return res.json()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: personalAccountsKey }),
  })
}

export function useDisconnectClaudeAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1["personal-accounts"].claude.$delete()
      if (!res.ok) throw new Error("Couldn't disconnect Claude")
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: personalAccountsKey }),
    onError: (err) => toast.error(err.message),
  })
}

export function useDisconnectGithubAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1["personal-accounts"].github.$delete()
      if (!res.ok) throw new Error("Couldn't disconnect GitHub")
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: personalAccountsKey }),
    onError: (err) => toast.error(err.message),
  })
}
