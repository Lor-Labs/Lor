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

// Normal access and billing under the hosted beta: an exempt internal
// workspace, or a trial team that subscribed (subscribing ends beta mode).
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
