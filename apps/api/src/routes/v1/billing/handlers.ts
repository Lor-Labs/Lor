import {
  attachPro,
  attachTopup,
  billingEnabled,
  CREDITS_PER_SEAT,
  countSeats,
  getBillingSummary,
  portalUrl,
  SEAT_PRICE_USD,
  setAutoTopup,
} from "@repo/billing"
import { env } from "@repo/env/server"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { assertWorkspacePermission } from "@/lib/permissions"
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

export const getBilling: AppRouteHandler<GetBillingRoute> = async (c) => {
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, {
    organization: ["update"],
  })

  const base = {
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
  assertWorkspacePermission(c.var.member, workspace, {
    organization: ["update"],
  })
  const config = c.req.valid("json")
  if (!billingEnabled) {
    return c.json(
      { success: false, message: "Billing is not enabled" },
      HttpStatusCodes.BAD_REQUEST
    )
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
  const workspace = c.var.workspace
  assertWorkspacePermission(c.var.member, workspace, {
    organization: ["update"],
  })
  if (!billingEnabled) {
    return c.json(
      { success: false, message: "Billing is not enabled" },
      HttpStatusCodes.BAD_REQUEST
    )
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
  assertWorkspacePermission(c.var.member, workspace, {
    organization: ["update"],
  })
  const { size } = c.req.valid("json")
  if (!billingEnabled) {
    return c.json(
      { success: false, message: "Billing is not enabled" },
      HttpStatusCodes.BAD_REQUEST
    )
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
  assertWorkspacePermission(c.var.member, workspace, {
    organization: ["update"],
  })
  if (!billingEnabled) {
    return c.json(
      { success: false, message: "Billing is not enabled" },
      HttpStatusCodes.BAD_REQUEST
    )
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
