import { blockedSandboxes, chargeSandboxUsage } from "@repo/billing"
import { stopBlockedSandboxes } from "@repo/lor/beta-compute"
import { blaxelSandboxUsage } from "@repo/lor/sandbox-usage"

export const SANDBOX_STOP_SWEEP_EVERY_MS = 5 * 60 * 1000
export const SANDBOX_CHARGE_EVERY_MS = 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
// Blaxel's billing data lags a few minutes, so an hour is charged once it
// has been closed this long. Two hours back gives each hour one retry.
const SETTLE_MS = 30 * 60 * 1000
const CHARGE_HOURS = 2

// Every 5 minutes: beta teams out of credits, expired or halted get the
// sandboxes still running this hour stopped.
export async function sweepBlockedSandboxes() {
  const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
  const buckets = await blaxelSandboxUsage(
    new Date(thisHour),
    new Date(thisHour + HOUR_MS)
  )
  await stopBlockedSandboxes(await blockedSandboxes(buckets))
}

// Hourly: charge closed sandbox-hours to the credit pool.
export async function chargeClosedSandboxHours() {
  const settledBefore = Math.floor((Date.now() - SETTLE_MS) / HOUR_MS) * HOUR_MS
  await chargeSandboxUsage(
    await blaxelSandboxUsage(
      new Date(settledBefore - CHARGE_HOURS * HOUR_MS),
      new Date(settledBefore)
    )
  )
}
