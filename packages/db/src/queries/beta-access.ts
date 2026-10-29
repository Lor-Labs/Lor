import { readServerEnv } from "@repo/env/server-fields"
import { db, eq, schema } from "../index"

export class BetaAccessError extends Error {
  readonly status = 403
}

export function hostedBetaEnabled() {
  return readServerEnv("LOR_HOSTED_BETA").LOR_HOSTED_BETA
}

export async function isBetaExempt(workspaceId: string) {
  const [row] = await db
    .select({ workspaceId: schema.betaExemption.workspaceId })
    .from(schema.betaExemption)
    .where(eq(schema.betaExemption.workspaceId, workspaceId))
  return Boolean(row)
}

// No beta limits: an exempt internal workspace (free, unlimited), or a trial
// team that subscribed (subscribing ends beta mode).
export async function betaLimitsLifted(workspaceId: string) {
  const [trial] = await db
    .select({ subscribedAt: schema.workspaceBetaTrial.subscribedAt })
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
  return trial ? Boolean(trial.subscribedAt) : isBetaExempt(workspaceId)
}

// Active with no trial: beta off, an exempt internal workspace, or a
// subscribed team (normal access and billing, no beta limits).
export async function workspaceBetaAccess(workspaceId: string) {
  if (!hostedBetaEnabled()) return { state: "active" as const, trial: null }
  const trial = await db
    .select()
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
    .then((rows) => rows[0] ?? null)
  if (trial?.subscribedAt) return { state: "active" as const, trial: null }
  if (!trial)
    return (await isBetaExempt(workspaceId))
      ? { state: "active" as const, trial: null }
      : { state: "not_enrolled" as const, trial }
  return {
    state:
      trial.expiresAt <= new Date()
        ? ("expired" as const)
        : ("active" as const),
    trial,
  }
}

export async function assertWorkspaceActive(workspaceId: string) {
  const access = await workspaceBetaAccess(workspaceId)
  if (access.state !== "active")
    throw new BetaAccessError(
      access.state === "expired"
        ? "This team's beta has ended. Saved work remains readable; subscribe in billing to keep working."
        : "This workspace is not enrolled in the hosted beta."
    )
  return access.trial
}

// Emergency stop per campaign, cached briefly: it is read on every model
// request and sandbox call.
const HALT_TTL_MS = 10_000
const halted = new Map<string, { value: boolean; until: number }>()

export async function betaUsageHalted(campaignKey: string) {
  const cached = halted.get(campaignKey)
  if (cached && cached.until > Date.now()) return cached.value
  const [campaign] = await db
    .select({ usageHaltedAt: schema.betaCampaign.usageHaltedAt })
    .from(schema.betaCampaign)
    .where(eq(schema.betaCampaign.key, campaignKey))
  const value = Boolean(campaign?.usageHaltedAt)
  halted.set(campaignKey, { value, until: Date.now() + HALT_TTL_MS })
  return value
}

export const BETA_HALTED_MESSAGE =
  "Lor is briefly paused for beta teams. Saved work stays available; try again soon."

// Sandbox work needs an active workspace and, in beta mode, credits left in
// the shared pool. Database only: credits_empty_at is synced from Autumn.
export async function assertBetaSandbox(workspaceId: string) {
  const trial = await assertWorkspaceActive(workspaceId)
  if (trial && (await betaUsageHalted(trial.campaignKey)))
    throw new BetaAccessError(BETA_HALTED_MESSAGE)
  if (trial?.creditsEmptyAt)
    throw new BetaAccessError(
      "Your team's included credits are used up. Subscribe in billing to keep working."
    )
}

export function assertHostedHarness(harness: string) {
  if (hostedBetaEnabled() && harness !== "pi")
    throw new BetaAccessError(
      "Hosted beta supports Lor with credits or a workspace API key. Subscription-based harnesses are not available."
    )
}

export async function assertChannelActive(channelId: string) {
  if (!hostedBetaEnabled()) return
  const [channel] = await db
    .select({ workspaceId: schema.channel.workspaceId })
    .from(schema.channel)
    .where(eq(schema.channel.id, channelId))
  if (channel?.workspaceId) await assertWorkspaceActive(channel.workspaceId)
}
