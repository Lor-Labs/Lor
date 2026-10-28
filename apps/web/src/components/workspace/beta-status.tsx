import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export function BetaStatus({ workspaceSlug }: { workspaceSlug: string }) {
  const { data } = useQuery({
    queryKey: ["entitlements", workspaceSlug],
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].entitlements.$get({ param: { workspaceSlug } })
      if (!response.ok) throw new Error("Could not load beta access")
      return response.json()
    },
  })
  if (!data?.enabled) return null
  const text =
    data.state !== "active"
      ? "This workspace's beta has ended. Saved work remains readable; subscribe in billing to keep working."
      : data.compute?.sandboxRemainingSeconds === 0
        ? "Your team's sandbox allowance is used up. Subscribe in billing to keep working."
        : `Private beta · Free until ${new Date(data.expiresAt ?? "").toLocaleDateString()} · ${((data.compute?.sandboxRemainingSeconds ?? 0) / 3600).toFixed(1)} sandbox hours remaining`
  return (
    <output className="shrink-0 border-b bg-muted/50 px-4 py-2 text-center text-xs text-muted-foreground">
      {text}
    </output>
  )
}
