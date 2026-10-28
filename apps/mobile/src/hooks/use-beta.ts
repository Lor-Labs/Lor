import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useBetaAvailability() {
  return useQuery({
    queryKey: ["beta-availability"],
    staleTime: 15_000,
    queryFn: async () => {
      const response = await api.beta.availability.$get()
      if (!response.ok)
        throw new Error("Signup availability is temporarily unavailable")
      return response.json()
    },
  })
}

export function useBetaEntitlements(workspaceSlug?: string) {
  return useQuery({
    queryKey: ["entitlements", workspaceSlug],
    enabled: Boolean(workspaceSlug),
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!workspaceSlug) throw new Error("Choose a workspace")
      const response = await api.v1.workspaces[
        ":workspaceSlug"
      ].entitlements.$get({ param: { workspaceSlug } })
      if (!response.ok)
        throw new Error("Beta access is temporarily unavailable")
      return response.json()
    },
  })
}
