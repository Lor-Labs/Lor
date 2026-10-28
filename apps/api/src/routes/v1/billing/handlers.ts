import {
  attachPro,
  attachTopup,
  billingEnabled,
  CREDITS_PER_SEAT,
  countSeats,
  getBillingSummary,
  getWorkspaceBetaTrial,
  hostedBetaConfig,
  portalUrl,
  SEAT_PRICE_USD,
  setAutoTopup,
  syncBetaCredits,
} from "@repo/billing"
import { betaComputeSummary } from "@repo/db/queries/beta-compute"
import { env } from "@repo/env/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { assertWorkspaceAuthority } from "@/lib/permissions"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetBillingRoute,
  PortalRoute,
  SetAutoTopupRoute,
  SubscribeRoute,
  TopupRoute,
} from "@/routes/v1/billing/routes"

// Stripe redirects land back on the billing tab of the settings dialog.
function billingReturnUrl(slug: string) {
  return `${env.APP_BASE_URL}/${slug}?settings=workspace&tab=billing`
}

const BILLING_DISABLED = {
  success: false,
  message: "Billing is not enabled",
} as const

export const getBilling: AppRouteHandler<GetBillingRoute> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })

  const trial = hostedBetaConfig().enabled
    ? await getWorkspaceBetaTrial(workspace.id)
    : null
  const beta = trial
    ? await syncBetaCredits(workspace.id).catch(() => ({
        expiresAt: trial.expiresAt.toISOString(),
        aiGrantUsd: trial.aiGrantMicroUsd / 1_000_000,
        expired: trial.expiresAt <= new Date(),
        freeRemainingUsd: 0,
        purchasedRemainingUsd: 0,
        available: false,
      }))
    : null
  const base = {
    beta,
    compute: await betaComputeSummary(workspace.id),
    enabled: billingEnabled,
    seats: await countSeats(workspace.id),
    seatPriceUsd: SEAT_PRICE_USD,
    creditsPerSeat: CREDITS_PER_SEAT,
  }
  const unavailable = {
    ...base,
    available: false,
    subscribed: false,
    currentPeriodEnd: null,
    balance: null,
    autoTopup: null,
    canAutoTopup: false,
  }
  if (!billingEnabled) {
    return c.json(unavailable, HttpStatusCodes.OK)
  }

  const summary = await getBillingSummary(workspace.id)
  if (!summary) {
    return c.json(unavailable, HttpStatusCodes.OK)
  }
  return c.json({ ...base, available: true, ...summary }, HttpStatusCodes.OK)
}

export const setAutoTopupHandler: AppRouteHandler<SetAutoTopupRoute> = async (
  c
) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  const config = c.req.valid("json")
  if (hostedBetaConfig().enabled && config.enabled)
    return c.json(
      { success: false, message: "Auto-refill is not offered during the beta" },
      HttpStatusCodes.BAD_REQUEST
    )
  if (!billingEnabled) {
    return c.json(BILLING_DISABLED, HttpStatusCodes.BAD_REQUEST)
  }
  try {
    const { url } = await setAutoTopup(
      workspace.id,
      config,
      billingReturnUrl(workspace.slug)
    )
    return c.json({ url }, HttpStatusCodes.OK)
  } catch (err) {
    logger.error(
      { err, workspaceId: workspace.id },
      "Auto top-up update failed"
    )
    return c.json(
      { success: false, message: "Failed to update auto top-up" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
}

export const subscribe: AppRouteHandler<SubscribeRoute> = async (c) => {
  if (hostedBetaConfig().enabled)
    return c.json(
      {
        success: false,
        message: "The beta workspace stays free; buy AI credits instead",
      },
      HttpStatusCodes.BAD_REQUEST
    )
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  if (!billingEnabled) {
    return c.json(BILLING_DISABLED, HttpStatusCodes.BAD_REQUEST)
  }
  try {
    const seats = await countSeats(workspace.id)
    const { url } = await attachPro(
      workspace.id,
      Math.max(1, seats),
      billingReturnUrl(workspace.slug)
    )
    return c.json({ url }, HttpStatusCodes.OK)
  } catch (err) {
    logger.error({ err, workspaceId: workspace.id }, "Subscribe failed")
    return c.json(
      { success: false, message: "Failed to start checkout" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
}

export const topup: AppRouteHandler<TopupRoute> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  const { size } = c.req.valid("json")
  if (hostedBetaConfig().enabled) {
    const trial = await getWorkspaceBetaTrial(workspace.id)
    if (!trial || trial.expiresAt <= new Date() || size !== "small")
      return c.json(
        {
          success: false,
          message:
            "Only $25 credit packs are available during an active beta trial",
        },
        HttpStatusCodes.BAD_REQUEST
      )
    await syncBetaCredits(workspace.id)
  }
  if (!billingEnabled) {
    return c.json(BILLING_DISABLED, HttpStatusCodes.BAD_REQUEST)
  }
  try {
    const { url } = await attachTopup(
      workspace.id,
      size,
      billingReturnUrl(workspace.slug)
    )
    return c.json({ url }, HttpStatusCodes.OK)
  } catch (err) {
    logger.error({ err, workspaceId: workspace.id }, "Top-up failed")
    return c.json(
      { success: false, message: "Failed to start checkout" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
}

export const portal: AppRouteHandler<PortalRoute> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
  if (!billingEnabled) {
    return c.json(BILLING_DISABLED, HttpStatusCodes.BAD_REQUEST)
  }
  try {
    const url = await portalUrl(workspace.id, billingReturnUrl(workspace.slug))
    return c.json({ url }, HttpStatusCodes.OK)
  } catch (err) {
    logger.error({ err, workspaceId: workspace.id }, "Portal session failed")
    return c.json(
      { success: false, message: "Failed to open billing portal" },
      HttpStatusCodes.INTERNAL_SERVER_ERROR
    )
  }
}
