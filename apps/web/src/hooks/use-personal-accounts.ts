import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// The person's own accounts (GitHub), never shared with the workspace
// (reference/planned/code-sessions-runbook.md, chunk 4).

export const personalAccountsKey = ["personal-accounts"] as const

// Where the GitHub callback page goes back to. Unset in the desktop app's
// flow, which finishes in the system browser; the app refetches on focus.
export const GITHUB_CONNECT_RETURN_KEY = "lor:github-connect-return"

export function usePersonalAccounts() {
  return useQuery({
    queryKey: personalAccountsKey,
    queryFn: async () => {
      const res = await apiClient.v1["personal-accounts"].$get()
      if (!res.ok) throw new Error("Failed to load your accounts")
      return res.json()
    },
  })
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
