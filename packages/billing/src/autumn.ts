import { db, eq, schema } from "@repo/db"
import { createLogger } from "@repo/logger"
import { getAutumn } from "./client"
import {
  CREDITS_FEATURE_ID,
  CREDITS_PER_SEAT,
  PRO_PLAN_ID,
  PROMO_CREDITS,
  TOPUP_PLAN_ID,
  TOPUP_SIZES,
  type TopupSize,
} from "./constants"

const logger = createLogger("billing")

export type DebitStatus = "debited" | "free" | "fail_open"

export type CreditCheck = { allowed: boolean; failOpen: boolean }

async function workspaceName(workspaceId: string): Promise<string | null> {
  const rows = await db
    .select({ name: schema.workspace.name })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
    .limit(1)
  return rows[0]?.name ?? null
}

export async function ensureCustomer(workspaceId: string, name?: string) {
  const autumn = getAutumn()
  if (!autumn) return
  try {
    await autumn.customers.getOrCreate({
      customerId: workspaceId,
      name: name ?? (await workspaceName(workspaceId)),
    })
  } catch (err) {
    logger.warn({ err, workspaceId }, "Autumn ensureCustomer failed")
  }
}

// Fail open: Merlin keeps answering through an Autumn outage; under-billing
// beats downtime. A missing customer is not an outage — it's created and
// re-checked once, and a workspace with no balance is correctly refused.
export async function checkCredits(workspaceId: string): Promise<CreditCheck> {
  const autumn = getAutumn()
  if (!autumn) return { allowed: true, failOpen: false }
  try {
    const res = await autumn.check({
      customerId: workspaceId,
      featureId: CREDITS_FEATURE_ID,
    })
    return { allowed: res.allowed, failOpen: false }
  } catch {
    try {
      await ensureCustomer(workspaceId)
      const res = await autumn.check({
        customerId: workspaceId,
        featureId: CREDITS_FEATURE_ID,
      })
      return { allowed: res.allowed, failOpen: false }
    } catch (err) {
      logger.error({ err, workspaceId }, "Autumn check failed; failing open")
      return { allowed: true, failOpen: true }
    }
  }
}

// "overflow" lets a request that straddles zero deduct fully (balance can go
// negative), so the next check refuses instead of the overage being free.
export async function trackCredits(
  workspaceId: string,
  credits: number
): Promise<DebitStatus> {
  const autumn = getAutumn()
  if (!autumn) return "free"
  try {
    await autumn.track({
      customerId: workspaceId,
      featureId: CREDITS_FEATURE_ID,
      value: credits,
      overageBehavior: "overflow",
    })
    return "debited"
  } catch (err) {
    logger.error(
      { err, workspaceId, credits },
      "Autumn track failed; failing open"
    )
    return "fail_open"
  }
}

// Throws on failure so the caller can revert its idempotency claim.
export async function grantPromoCredits(workspaceId: string): Promise<void> {
  const autumn = getAutumn()
  if (!autumn) return
  await autumn.customers.getOrCreate({
    customerId: workspaceId,
    name: await workspaceName(workspaceId),
  })
  await autumn.balances.create({
    customerId: workspaceId,
    featureId: CREDITS_FEATURE_ID,
    includedGrant: PROMO_CREDITS,
    balanceId: `promo_${workspaceId}`,
  })
}

export type CheckoutResult = { url: string | null }

function mustAutumn() {
  const autumn = getAutumn()
  if (!autumn) throw new Error("billing is disabled (AUTUMN_SECRET_KEY unset)")
  return autumn
}

export async function attachPro(
  workspaceId: string,
  seats: number,
  successUrl: string
): Promise<CheckoutResult> {
  const res = await mustAutumn().billing.attach({
    customerId: workspaceId,
    planId: PRO_PLAN_ID,
    featureQuantities: [
      { featureId: CREDITS_FEATURE_ID, quantity: seats * CREDITS_PER_SEAT },
    ],
    successUrl,
  })
  return { url: res.paymentUrl }
}

export async function attachTopup(
  workspaceId: string,
  size: TopupSize,
  successUrl: string
): Promise<CheckoutResult> {
  const res = await mustAutumn().billing.attach({
    customerId: workspaceId,
    planId: TOPUP_PLAN_ID,
    featureQuantities: [
      { featureId: CREDITS_FEATURE_ID, quantity: TOPUP_SIZES[size] },
    ],
    successUrl,
  })
  return { url: res.paymentUrl }
}

export async function portalUrl(
  workspaceId: string,
  returnUrl: string
): Promise<string> {
  const res = await mustAutumn().billing.openCustomerPortal({
    customerId: workspaceId,
    returnUrl,
  })
  return res.url
}

export type BillingSummary = {
  subscribed: boolean
  currentPeriodEnd: number | null
  balance: { total: number; monthly: number; purchased: number } | null
}

export async function getBillingSummary(
  workspaceId: string
): Promise<BillingSummary | null> {
  const autumn = getAutumn()
  if (!autumn) return null
  try {
    const customer = await autumn.customers.getOrCreate({
      customerId: workspaceId,
      name: await workspaceName(workspaceId),
    })
    const sub = customer.subscriptions.find(
      (s) => s.planId === PRO_PLAN_ID && s.status === "active"
    )
    const balance = customer.balances[CREDITS_FEATURE_ID]
    const breakdown = balance?.breakdown ?? []
    const monthly = breakdown
      .filter((b) => b.reset)
      .reduce((n, b) => n + b.remaining, 0)
    const purchased = breakdown
      .filter((b) => !b.reset)
      .reduce((n, b) => n + b.remaining, 0)
    return {
      subscribed: Boolean(sub),
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      balance: balance
        ? { total: balance.remaining, monthly, purchased }
        : null,
    }
  } catch (err) {
    logger.error({ err, workspaceId }, "Autumn billing summary failed")
    return null
  }
}
