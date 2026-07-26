import { Button } from "@repo/ui/components/button"
import { Progress } from "@repo/ui/components/progress"
import { Skeleton } from "@repo/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2 } from "lucide-react"
import { useEffect } from "react"
import { toast } from "sonner"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"

const TOPUPS = [
  { size: "small" as const, credits: "2,500", price: "$25" },
  { size: "medium" as const, credits: "10,000", price: "$100" },
  { size: "large" as const, credits: "50,000", price: "$500" },
]

export function BillingSection({ workspaceSlug }: { workspaceSlug: string }) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const { data: billing, isPending } = useQuery({
    queryKey: ["billing", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].billing.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to load billing")
      return res.json()
    },
  })

  useEffect(() => {
    if (!socket) return
    const onUpdated = () => {
      void queryClient.invalidateQueries({
        queryKey: ["billing", workspaceSlug],
      })
    }
    socket.on("billing:updated", onUpdated)
    return () => {
      socket.off("billing:updated", onUpdated)
    }
  }, [socket, queryClient, workspaceSlug])

  const subscribe = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].billing.subscribe.$post({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to start checkout")
      return res.json()
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url
      else {
        toast.success("Subscribed")
        void queryClient.invalidateQueries({
          queryKey: ["billing", workspaceSlug],
        })
      }
    },
    onError: () => toast.error("Failed to start checkout"),
  })

  const topup = useMutation({
    mutationFn: async (size: "small" | "medium" | "large") => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].billing.topup.$post({ param: { workspaceSlug }, json: { size } })
      if (!res.ok) throw new Error("Failed to start checkout")
      return res.json()
    },
    onSuccess: ({ url }) => {
      if (url) window.location.href = url
      else {
        toast.success("Credits added")
        void queryClient.invalidateQueries({
          queryKey: ["billing", workspaceSlug],
        })
      }
    },
    onError: () => toast.error("Failed to start checkout"),
  })

  const portal = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].billing.portal.$post({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to open billing portal")
      return res.json()
    },
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: () => toast.error("Failed to open billing portal"),
  })

  if (isPending || !billing) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!billing.enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Billing is not enabled on this deployment.
      </p>
    )
  }

  if (!billing.available) {
    return (
      <p className="text-sm text-muted-foreground">
        Billing is temporarily unavailable. Merlin keeps working — try again in
        a moment.
      </p>
    )
  }

  if (!billing.subscribed) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border p-5">
          <div className="text-base font-semibold">Lor Pro</div>
          <p className="mt-1 text-sm text-muted-foreground">
            ${billing.seatPriceUsd} per member per month. Includes Merlin in
            your channels, with usage pooled across the whole team.
          </p>
          <div className="mt-3 text-sm text-muted-foreground">
            {billing.seats} {billing.seats === 1 ? "member" : "members"} · $
            {billing.seats * billing.seatPriceUsd}/month
          </div>
          <Button
            className="mt-4"
            onClick={() => subscribe.mutate()}
            disabled={subscribe.isPending}
          >
            {subscribe.isPending && <Loader2 className="size-4 animate-spin" />}
            Subscribe
          </Button>
        </div>
        {billing.balance && billing.balance.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {billing.balance.total.toLocaleString()} free credits remaining —
            subscribe to keep Merlin available once they run out.
          </p>
        )}
      </div>
    )
  }

  const included = billing.seats * billing.creditsPerSeat
  const monthly = billing.balance?.monthly ?? 0
  const purchased = billing.balance?.purchased ?? 0
  const renewsAt = billing.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      })
    : null

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Lor Pro</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {billing.seats} {billing.seats === 1 ? "member" : "members"} · $
              {billing.seats * billing.seatPriceUsd}/month
              {renewsAt ? ` · renews ${renewsAt}` : ""}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
          >
            {portal.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ExternalLink className="size-4" />
            )}
            Manage billing
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-5">
        <div className="text-sm font-semibold">Monthly credits</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {monthly.toLocaleString()} of {included.toLocaleString()} left this
          cycle, pooled across the team.
        </p>
        <Progress
          className="mt-3"
          value={included > 0 ? Math.min(100, (monthly / included) * 100) : 0}
        />
        {purchased > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            +{purchased.toLocaleString()} purchased credits that never expire
            (used after monthly credits).
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-5">
        <div className="text-sm font-semibold">Top up</div>
        <p className="mt-1 text-sm text-muted-foreground">
          One-time credit packs. They roll over month to month.
        </p>
        <div className="mt-3 flex gap-2">
          {TOPUPS.map((pack) => (
            <Button
              key={pack.size}
              variant="outline"
              onClick={() => topup.mutate(pack.size)}
              disabled={topup.isPending}
            >
              {pack.credits} for {pack.price}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
