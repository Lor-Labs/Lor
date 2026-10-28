import { chargeSandboxUsage } from "@repo/billing"
import { stopBlockedSandboxes } from "@repo/lor/beta-compute"
import { blaxelSandboxUsage } from "@repo/lor/sandbox-usage"

export const SANDBOX_USAGE_SWEEP_EVERY_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
// Billing data lags minutes; an hour keeps growing until it closes, so the
// window reaches back far enough to settle closed hours.
const LOOKBACK_HOURS = 3

export async function sweepSandboxUsage() {
  const thisHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
  const buckets = await blaxelSandboxUsage(
    new Date(thisHour - LOOKBACK_HOURS * HOUR_MS),
    new Date(thisHour + HOUR_MS)
  )
  // Beta teams out of credits or past expiry: stop what is still running.
  await stopBlockedSandboxes(await chargeSandboxUsage(buckets))
}
