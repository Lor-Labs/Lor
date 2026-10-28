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
import { type ReactNode, useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"
import { InferenceSettings } from "./inference-settings"
import {
  PILL_BUTTON,
  SettingsCard,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"

const TOPUPS = [
  { size: "small", credits: 2_500, label: "2,500", price: "$25" },
  { size: "medium", credits: 10_000, label: "10,000", price: "$100" },
  { size: "large", credits: 50_000, label: "50,000", price: "$500" },
] as const

type PackCredits = (typeof TOPUPS)[number]["credits"]

const shortDate = (value: string | number) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })

function Row({
  title,
  detail,
  action,
  children,
}: {
  title: ReactNode
  detail?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{title}</div>
          {detail && (
            <div className="text-xs text-muted-foreground">{detail}</div>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

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

  const seats = `${billing.seats} ${billing.seats === 1 ? "member" : "members"}`
  const keySettings = (expired: boolean) => (
    <InferenceSettings workspaceSlug={workspaceSlug} expired={expired} />
  )
  const subscribeButton = (primary: boolean) => (
    <Button
      variant={primary ? "default" : "outline"}
      className={PILL_BUTTON}
      onClick={() => subscribe.mutate()}
      disabled={!billing.enabled || subscribe.isPending}
    >
      {subscribe.isPending && <Spinner className="size-4" />}
      Subscribe
    </Button>
  )

  if (billing.beta) {
    const beta = billing.beta
    const credits = (usd: number) => Math.floor(usd * 100).toLocaleString()
    const left = beta.freeRemainingUsd + beta.purchasedRemainingUsd
    const blocked = beta.expired || (beta.available && left <= 0)
    return (
      <div className="space-y-8">
        <SettingsSection
          title="Plan"
          caption="1 credit = $0.01, shared by AI and sandbox time."
        >
          <SettingsGroup>
            <Row
              title="Private beta"
              detail={
                beta.expired
                  ? `Ended ${shortDate(beta.expiresAt)}`
                  : `Free until ${shortDate(beta.expiresAt)}`
              }
            />
            <Row
              title={
                beta.available
                  ? `${credits(left)} credits left`
                  : "Balance unavailable"
              }
              detail={
                beta.available
                  ? `${credits(beta.creditGrantUsd)} included${beta.purchasedRemainingUsd > 0 ? ` · ${credits(beta.purchasedRemainingUsd)} bought` : ""}`
                  : "AI is paused until billing recovers"
              }
              action={
                !beta.expired && (
                  <Button
                    variant="outline"
                    className={PILL_BUTTON}
                    onClick={() => topup.mutate("small")}
                    disabled={
                      !billing.enabled || !beta.available || topup.isPending
                    }
                  >
                    {topup.isPending && <Spinner className="size-4" />}
                    Buy 2,500 · $25
                  </Button>
                )
              }
            >
              {beta.available && (
                <Progress
                  value={Math.min(
                    100,
                    (beta.freeRemainingUsd / (beta.creditGrantUsd || 1)) * 100
                  )}
                />
              )}
            </Row>
            <Row
              title="Lor Pro"
              detail={`$${billing.seatPriceUsd}/member a month, yours for life`}
              action={subscribeButton(blocked)}
            />
          </SettingsGroup>
        </SettingsSection>
        {keySettings(beta.expired)}
      </div>
    )
  }

  if (!billing.enabled || !billing.available) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Plan">
          <SettingsGroup>
            <Row
              title={
                billing.enabled
                  ? "Billing is temporarily unavailable"
                  : "Billing is off on this deployment"
              }
            />
          </SettingsGroup>
        </SettingsSection>
        {keySettings(false)}
      </div>
    )
  }

  if (!billing.subscribed) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Plan">
          <SettingsGroup>
            <Row
              title="Lor Pro"
              detail={`$${billing.seatPriceUsd}/member a month · ${seats}`}
              action={subscribeButton(true)}
            />
            {billing.balance && billing.balance.total > 0 && (
              <Row
                title={`${billing.balance.total.toLocaleString()} free credits left`}
              />
            )}
          </SettingsGroup>
        </SettingsSection>
        {keySettings(false)}
      </div>
    )
  }

  const included = billing.seats * billing.creditsPerSeat
  const monthly = billing.balance?.monthly ?? 0
  const purchased = billing.balance?.purchased ?? 0

  return (
    <div className="space-y-8">
      <SettingsSection title="Plan">
        <SettingsGroup>
          <Row
            title="Lor Pro"
            detail={`${seats} · $${billing.seats * billing.seatPriceUsd}/month${billing.currentPeriodEnd ? ` · renews ${shortDate(billing.currentPeriodEnd)}` : ""}`}
            action={
              <Button
                variant="outline"
                className={PILL_BUTTON}
                onClick={() => portal.mutate()}
                disabled={portal.isPending}
              >
                {portal.isPending && <Spinner className="size-4" />}
                Manage
              </Button>
            }
          />
          <Row
            title={`${monthly.toLocaleString()} credits left this month`}
            detail={`${included.toLocaleString()} included${purchased > 0 ? ` · ${purchased.toLocaleString()} bought` : ""}`}
          >
            <Progress
              value={
                included > 0 ? Math.min(100, (monthly / included) * 100) : 0
              }
            />
          </Row>
          <Row
            title="Top up"
            detail="Bought credits never expire"
            action={
              <div className="flex gap-2">
                {TOPUPS.map((pack) => (
                  <Button
                    key={pack.size}
                    variant="outline"
                    className={PILL_BUTTON}
                    onClick={() => topup.mutate(pack.size)}
                    disabled={topup.isPending}
                  >
                    {pack.price}
                  </Button>
                ))}
              </div>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <AutoTopup
        workspaceSlug={workspaceSlug}
        autoTopup={billing.autoTopup}
        canAutoTopup={billing.canAutoTopup}
      />
      {keySettings(false)}
    </div>
  )
}

function AutoTopup({
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
      toast.success(enabled ? "Auto top-up on" : "Auto top-up off")
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
  // The first pack purchase registers the price Autumn charges refills
  // against, so enabling before any top-up also buys one.
  const buysFirstPack = enabled && !canAutoTopup
  const pack = TOPUPS.find((p) => p.credits === quantity)
  const packs = TOPUPS.map((p) => ({
    value: String(p.credits),
    label: `${p.label} · ${p.price}`,
  }))

  return (
    <SettingsSection title="Auto top-up">
      <SettingsCard>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">Buy a pack when credits run low</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        {enabled && (
          <div className="flex flex-wrap items-end gap-3">
            <label
              htmlFor="auto-topup-threshold"
              className="flex flex-col gap-1.5 text-xs text-muted-foreground"
            >
              Below
              <Input
                id="auto-topup-threshold"
                type="number"
                className="w-28"
                min={100}
                max={50_000}
                step={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              Buy
              <Select
                items={packs}
                value={String(quantity)}
                onValueChange={(v) => setQuantity(Number(v) as PackCredits)}
              >
                <SelectTrigger className="w-40" aria-label="Auto top-up pack">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {packs.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {dirty && (
          <Button
            className={PILL_BUTTON}
            onClick={() => save.mutate()}
            disabled={save.isPending || threshold < 100}
          >
            {save.isPending && <Spinner className="size-4" />}
            {buysFirstPack ? `Turn on and buy ${pack?.price}` : "Save"}
          </Button>
        )}
      </SettingsCard>
    </SettingsSection>
  )
}
