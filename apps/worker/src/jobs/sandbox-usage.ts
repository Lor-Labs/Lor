import { blockedSandboxes, chargeSandboxUsage } from "@repo/billing"
import { stopBlockedSandboxes } from "@repo/lor/beta-compute"
import { boatSandboxUsage, deleteIdleBoatSandboxes } from "@repo/lor/boat"
import { blaxelSandboxUsage } from "@repo/lor/sandbox-usage"
import { logger } from "@/lib/logger"

export const SANDBOX_STOP_SWEEP_EVERY_MS = 5 * 60 * 1000
export const SANDBOX_CHARGE_EVERY_MS = 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
// Blaxel's billing data lags a few minutes, so an hour is charged once it
// has been closed this long. Two hours back gives each hour one retry.
const SETTLE_MS = 30 * 60 * 1000
const CHARGE_HOURS = 2

// Both providers' hourly compute: Blaxel's Billing API, and Boat's per
// sandbox usage for those that went there when Blaxel was full.
// A Boat failure never holds up Blaxel's charges: its hours are charged on
// a later run (each hour has a retry, and charges are idempotent).
async function sandboxUsage(start: Date, end: Date) {
  const [blaxel, boat] = await Promise.all([
    blaxelSandboxUsage(start, end),
    boatSandboxUsage(start, end).catch((err: unknown) => {
      logger.error({ err }, "Boat sandbox usage failed; the next run retries")
      return []
    }),
  ])
  return [...blaxel, ...boat]
}

// Every 5 minutes: beta teams out of credits, expired or halted get the
// sandboxes still running this hour stopped.
export async function sweepBlockedSandboxes() {
  const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
  const buckets = await sandboxUsage(
    new Date(thisHour),
    new Date(thisHour + HOUR_MS)
  )
  await stopBlockedSandboxes(await blockedSandboxes(buckets))
}

// Hourly: charge closed sandbox-hours to the credit pool, and delete Boat
// sandboxes stopped longer than the idle TTL (Blaxel deletes its own).
export async function chargeClosedSandboxHours() {
  const settledBefore = Math.floor((Date.now() - SETTLE_MS) / HOUR_MS) * HOUR_MS
  await chargeSandboxUsage(
    await sandboxUsage(
      new Date(settledBefore - CHARGE_HOURS * HOUR_MS),
      new Date(settledBefore)
    )
  )
  await deleteIdleBoatSandboxes().catch((err: unknown) =>
    logger.error({ err }, "Deleting idle Boat sandboxes failed")
  )
}
