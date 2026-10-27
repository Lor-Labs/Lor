import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

// The person's own accounts (GitHub, a Claude subscription), never shared
// with the workspace. Connecting them is on web for now. Same key as web.

export const personalAccountsKey = ["personal-accounts"] as const

export function usePersonalAccounts(enabled = true) {
  return useQuery({
    queryKey: personalAccountsKey,
    enabled,
    queryFn: async () => {
      const res = await api.v1["personal-accounts"].$get()
      if (!res.ok) throw new Error("Failed to load your accounts")
      return res.json()
    },
  })
}
