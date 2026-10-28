import { readServerEnv } from "@repo/env/server-fields"
import { db, eq, schema } from "../index"

export class BetaAccessError extends Error {
  readonly status = 403
}

export function hostedBetaEnabled() {
  return readServerEnv("LOR_HOSTED_BETA").LOR_HOSTED_BETA
}

export async function workspaceBetaAccess(workspaceId: string) {
  if (!hostedBetaEnabled()) return { state: "active" as const, trial: null }
  const trial = await db
    .select()
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
    .then((rows) => rows[0] ?? null)
  if (!trial) return { state: "not_enrolled" as const, trial }
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
        ? "This team's beta has ended. Saved work remains readable; new work is paused."
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
