import type { BetaPolicy, WorkspaceBetaTrial } from "@repo/db/schema"

export const MICRO_USD = 1_000_000
const DAY_MS = 86_400_000

// New offers get a new version; an existing version is never overwritten.
export const BETA_POLICY = Object.freeze({
  version: "private-beta-2026-10-28-pool",
  cohortLimit: 25,
  memberLimit: 5,
  enrollmentDays: 30,
  trialDays: 30,
  retentionDays: 30,
  // 3,000 credits shared by AI and sandbox time: $25 of AI plus 50 dev-box
  // hours at 10 credits/hour.
  creditGrantMicroUsd: 30 * MICRO_USD,
  codeSandboxMemoryMb: 8192,
} satisfies Omit<BetaPolicy, "createdAt">)

export function betaDate(value: string): Date {
  const date = new Date(value)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    throw new Error(
      "Use a valid UTC timestamp, for example 2026-11-01T00:00:00Z"
    )
  }
  return date
}

export function betaDaysAfter(date: Date, days: number): Date {
  const result = new Date(date.getTime() + days * DAY_MS)
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid beta date")
  return result
}

export function betaTrialTerms(policy: BetaPolicy, activatedAt: Date) {
  const expiresAt = betaDaysAfter(activatedAt, policy.trialDays)
  return {
    policyVersion: policy.version,
    activatedAt,
    expiresAt,
    readOnlyUntil: betaDaysAfter(expiresAt, policy.retentionDays),
    memberLimit: policy.memberLimit,
    creditGrantMicroUsd: policy.creditGrantMicroUsd,
  }
}

export function betaTrialStatus(
  trial: Pick<WorkspaceBetaTrial, "expiresAt" | "readOnlyUntil">,
  now = new Date()
): "active" | "expired" | "retention_ended" {
  if (now >= trial.readOnlyUntil) return "retention_ended"
  if (now >= trial.expiresAt) return "expired"
  return "active"
}
