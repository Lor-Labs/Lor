import { useQuery } from "@tanstack/react-query"
import { authClient } from "@/lib/auth-client"

// Own membership in the active workspace; keyed by workspace so switching
// workspaces refetches even though better-auth resolves "the active org".
export function useActiveMember(workspaceId?: string) {
  return useQuery({
    queryKey: ["active-member", workspaceId ?? null],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const result = await authClient.organization.getActiveMember()
      return result.data ?? null
    },
  })
}
