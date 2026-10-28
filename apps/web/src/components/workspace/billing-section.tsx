import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Progress } from "@repo/ui/components/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Skeleton } from "@repo/ui/components/skeleton"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"
import { InferenceSettings } from "./inference-settings"

const TOPUPS = [
  { size: "small", credits: 2_500, label: "2,500", price: "$25" },
  { size: "medium", credits: 10_000, label: "10,000", price: "$100" },
  { size: "large", credits: 50_000, label: "50,000", price: "$500" },
] as const

type PackCredits = (typeof TOPUPS)[number]["credits"]

export function BillingSection({ workspaceSlug }: { workspaceSlug: string }) {
  const socket = useSocket()
  const queryClient = useQueryClient()

  const { data: billing, isPending } = useQuery({
    refetchInterval: 30_000,
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
      if (url) openExternal(url)
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
      if (url) openExternal(url)
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
      openExternal(url)
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

  if (billing.beta) {
    const beta = billing.beta
    const expires = new Date(beta.expiresAt).toLocaleString()
    const credits = (usd: number) => Math.floor(usd * 100).toLocaleString()
    const blocked =
      beta.expired ||
      (beta.available &&
        beta.freeRemainingUsd + beta.purchasedRemainingUsd <= 0)
    const subscribeCard = (
      <div className="rounded-lg border border-border p-5">
        <div className="text-base font-semibold">Keep working with Lor Pro</div>
        <p className="mt-1 text-sm text-muted-foreground">
          ${billing.seatPriceUsd} per member per month, kept for life as a beta
          team. Subscribing ends the beta limits: invite your whole team, with
          usage pooled across it. Unused beta credits stay on your account.
        </p>
        <div className="mt-3 text-sm text-muted-foreground">
          {billing.seats} {billing.seats === 1 ? "member" : "members"} · $
          {billing.seats * billing.seatPriceUsd}/month
        </div>
        <Button
          className="mt-4"
          variant={blocked ? "default" : "outline"}
          onClick={() => subscribe.mutate()}
          disabled={!billing.enabled || subscribe.isPending}
        >
          {subscribe.isPending && <Spinner className="size-4" />}
          Subscribe
        </Button>
      </div>
    )
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-base font-semibold">Private beta</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {beta.expired ? "Your beta ended" : "Your workspace is free until"}{" "}
            {expires}. Buying credits does not start a seat subscription or
            extend this date.
          </p>
        </div>
        {blocked && subscribeCard}
        {beta.available ? (
          <div className="rounded-lg border p-5 space-y-2">
            <p>
              Included credits:{" "}
              <strong>{credits(beta.freeRemainingUsd)}</strong> of{" "}
              {credits(beta.creditGrantUsd)} remaining
            </p>
            <p>
              Purchased credits:{" "}
              <strong>{credits(beta.purchasedRemainingUsd)}</strong>
              {beta.expired
                ? " available again when workspace access resumes"
                : " remaining"}
            </p>
            {!beta.expired &&
              beta.freeRemainingUsd + beta.purchasedRemainingUsd <= 0 && (
                <p className="text-sm text-muted-foreground">
                  Your credits are used up. Subscribe or buy more to keep
                  working.
                </p>
              )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Credit balances are temporarily unavailable. New Lor-funded AI work
            is paused until billing recovers.
          </p>
        )}
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            One credit is $0.01, shared by AI and sandbox time across your team.
          </p>
          <p>
            AI: the highest listed Gateway provider token price for the model
            that answers, including long-context and peak rates, with no markup
            or per-request minimum. Your own API key uses no credits for AI.
          </p>
          <p>
            Sandbox time: 10 credits an hour for a code sandbox (8 GB), 5 for a
            chat sandbox (4 GB), while it runs. Standby is free. Usage appears a
            few minutes after it happens.
          </p>
        </div>
        {!beta.expired && (
          <div className="space-y-2">
            <Button
              onClick={() => topup.mutate("small")}
              disabled={!billing.enabled || !beta.available || topup.isPending}
            >
              {topup.isPending && <Spinner className="size-4" />} Buy 2,500
              credits ($25)
            </Button>
            <p className="text-xs text-muted-foreground">
              One-time purchase. No automatic refill. Unused purchased credits
              remain on your account after the beta.
            </p>
          </div>
        )}
        <InferenceSettings
          workspaceSlug={workspaceSlug}
          expired={beta.expired}
        />
        <p className="text-sm text-muted-foreground">
          Search, voice transcription and code storage are included. Browser
          automation is not included in this launch.
        </p>
        {!blocked && subscribeCard}
      </div>
    )
  }

  // A workspace's own provider key works in every billing mode.
  const keySettings = (
    <InferenceSettings workspaceSlug={workspaceSlug} expired={false} />
  )

  if (!billing.enabled) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Billing is not enabled on this deployment.
        </p>
        {keySettings}
      </div>
    )
  }

  if (!billing.available) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Billing is temporarily unavailable. Lor keeps working — try again in a
          moment.
        </p>
        {keySettings}
      </div>
    )
  }

  if (!billing.subscribed) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border p-5">
          <div className="text-base font-semibold">Lor Pro</div>
          <p className="mt-1 text-sm text-muted-foreground">
            ${billing.seatPriceUsd} per member per month. Includes Lor in your
            channels, with usage pooled across the whole team.
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
            {subscribe.isPending && <Spinner className="size-4" />}
            Subscribe
          </Button>
        </div>
        {billing.balance && billing.balance.total > 0 && (
          <p className="text-sm text-muted-foreground">
            {billing.balance.total.toLocaleString()} free credits remaining —
            subscribe to keep Lor available once they run out.
          </p>
        )}
        {keySettings}
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
              <Spinner className="size-4" />
            ) : (
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                className="size-4"
                strokeWidth={2}
              />
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
              {pack.label} for {pack.price}
            </Button>
          ))}
        </div>
      </div>

      <AutoTopupCard
        workspaceSlug={workspaceSlug}
        autoTopup={billing.autoTopup}
        canAutoTopup={billing.canAutoTopup}
      />
      {keySettings}
    </div>
  )
}

function AutoTopupCard({
  workspaceSlug,
  autoTopup,
  canAutoTopup,
}: {
  workspaceSlug: string
  autoTopup: { enabled: boolean; threshold: number; quantity: number } | null
  canAutoTopup: boolean
}) {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(autoTopup?.enabled ?? false)
  const [threshold, setThreshold] = useState(autoTopup?.threshold ?? 500)
  const [quantity, setQuantity] = useState<PackCredits>(
    (TOPUPS.find((p) => p.credits === autoTopup?.quantity)?.credits ??
      2_500) as PackCredits
  )

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].billing[
        "auto-topup"
      ].$put({
        param: { workspaceSlug },
        json: { enabled, threshold, quantity },
      })
      if (!res.ok) throw new Error("Failed to update auto top-up")
      return res.json()
    },
    onSuccess: ({ url }) => {
      if (url) {
        openExternal(url)
        return
      }
      toast.success(enabled ? "Auto top-up enabled" : "Auto top-up disabled")
      void queryClient.invalidateQueries({
        queryKey: ["billing", workspaceSlug],
      })
    },
    onError: () => toast.error("Failed to update auto top-up"),
  })

  const dirty =
    enabled !== (autoTopup?.enabled ?? false) ||
    threshold !== (autoTopup?.threshold ?? 500) ||
    quantity !== (autoTopup?.quantity ?? 2_500)
  // The first pack purchase is what registers the top-up price Autumn charges
  // refills against, so enabling before any top-up also buys one.
  const buysFirstPack = enabled && !canAutoTopup
  const pack = TOPUPS.find((p) => p.credits === quantity)

  return (
    <div className="rounded-lg border border-border p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Auto top-up</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Automatically buy a credit pack when the pooled balance runs low.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>
      {enabled && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label
            htmlFor="auto-topup-threshold"
            className="flex flex-col gap-1.5 text-sm"
          >
            <span className="text-muted-foreground">When balance is below</span>
            <Input
              id="auto-topup-threshold"
              type="number"
              className="w-32"
              min={100}
              max={50_000}
              step={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Buy</span>
            <Select
              items={TOPUPS.map((p) => ({
                value: String(p.credits),
                label: `${p.label} credits · ${p.price}`,
              }))}
              value={String(quantity)}
              onValueChange={(v) => setQuantity(Number(v) as PackCredits)}
            >
              <SelectTrigger className="w-44" aria-label="Auto top-up pack">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOPUPS.map((p) => (
                  <SelectItem key={p.size} value={String(p.credits)}>
                    {p.label} credits · {p.price}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {dirty && (
        <Button
          className="mt-4"
          onClick={() => save.mutate()}
          disabled={save.isPending || threshold < 100}
        >
          {save.isPending && <Spinner className="size-4" />}
          {buysFirstPack ? `Enable & buy first pack (${pack?.price})` : "Save"}
        </Button>
      )}
    </div>
  )
}
