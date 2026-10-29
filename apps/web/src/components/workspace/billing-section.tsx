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
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"
import { ProviderKeysSettings } from "./provider-keys-settings"
import {
  PILL_BUTTON,
  SettingsCard,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"

// Auto top-up presets; manual top-ups take any whole-dollar amount.
const TOPUPS = [
  { credits: 2_500, label: "2,500", price: "$25" },
  { credits: 10_000, label: "10,000", price: "$100" },
  { credits: 50_000, label: "50,000", price: "$500" },
] as const

type PackCredits = (typeof TOPUPS)[number]["credits"]

// $1 = 100 credits; the API accepts any whole-dollar amount from $5.
const TOPUP_MIN_USD = 5
const TOPUP_PRESETS_USD = [10, 20, 50] as const

function BuyCreditsSection({
  caption,
  onBuy,
  pending,
  disabled,
}: {
  caption: string
  onBuy: (usd: number) => void
  pending: boolean
  disabled?: boolean
}) {
  const [choice, setChoice] = useState<number | "custom">(20)
  const [custom, setCustom] = useState("")
  const usd = choice === "custom" ? Number(custom) : choice
  const valid = Number.isSafeInteger(usd) && usd >= TOPUP_MIN_USD
  const option = (selected: boolean) =>
    cn(PILL_BUTTON, selected && "border-primary bg-primary/10")
  return (
    <SettingsSection title="Buy credits" caption={caption}>
      <SettingsCard>
        <div className="flex flex-wrap items-center gap-2">
          {TOPUP_PRESETS_USD.map((amount) => (
            <Button
              key={amount}
              variant="outline"
              className={option(choice === amount)}
              aria-pressed={choice === amount}
              onClick={() => setChoice(amount)}
            >
              ${amount}
            </Button>
          ))}
          <Button
            variant="outline"
            className={option(choice === "custom")}
            aria-pressed={choice === "custom"}
            onClick={() => setChoice("custom")}
          >
            Custom
          </Button>
          {choice === "custom" && (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                autoFocus
                inputMode="numeric"
                aria-label="Amount in dollars"
                placeholder={`${TOPUP_MIN_USD} or more`}
                className="w-32 pl-6"
                value={custom}
                onChange={(event) =>
                  setCustom(event.target.value.replace(/\D/g, ""))
                }
              />
            </div>
          )}
        </div>
        <Button
          className={PILL_BUTTON}
          disabled={disabled || pending || !valid}
          onClick={() => onBuy(usd)}
        >
          {pending && <Spinner className="size-4" />}
          {valid
            ? `Buy ${(usd * 100).toLocaleString()} credits for $${usd.toLocaleString()}`
            : `Minimum $${TOPUP_MIN_USD}`}
        </Button>
      </SettingsCard>
    </SettingsSection>
  )
}

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
    mutationFn: async (usd: number) => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].billing.topup.$post({ param: { workspaceSlug }, json: { usd } })
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
    <ProviderKeysSettings workspaceSlug={workspaceSlug} expired={expired} />
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
          </SettingsGroup>
        </SettingsSection>
        <SettingsSection
          title="Lor Pro"
          caption="Subscribing ends the beta limits. Unused credits stay."
        >
          <SettingsGroup>
            <Row
              title={`$${billing.seatPriceUsd}/member a month`}
              detail="Yours for life as a beta team"
              action={subscribeButton(blocked)}
            />
          </SettingsGroup>
        </SettingsSection>
        {!beta.expired && (
          <BuyCreditsSection
            caption="$1 = 100 credits. No automatic refill."
            onBuy={(usd) => topup.mutate(usd)}
            pending={topup.isPending}
            disabled={!billing.enabled || !beta.available}
          />
        )}
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
        </SettingsGroup>
      </SettingsSection>
      <BuyCreditsSection
        caption="$1 = 100 credits. Bought credits never expire."
        onBuy={(usd) => topup.mutate(usd)}
        pending={topup.isPending}
      />
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
