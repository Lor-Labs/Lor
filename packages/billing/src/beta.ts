import { and, count, db, eq, ne, schema } from "@repo/db"
import { isBetaExempt } from "@repo/db/queries/beta-access"
import type {
  BetaTrialChanges,
  BetaTrialTerms,
  WorkspaceBetaTrial,
} from "@repo/db/schema"
import { readServerEnv } from "@repo/env/server-fields"
import {
  BETA_POLICY,
  betaDate,
  betaDaysAfter,
  betaTrialTerms,
} from "./beta-policy"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class BetaAdmissionError extends Error {
  readonly status = 403
}

async function availableCampaign(tx: Transaction) {
  const config = hostedBetaConfig()
  if (!config.enabled || !config.campaignKey)
    throw new BetaAdmissionError("Beta enrollment is not configured")
  const campaign = await tx
    .select()
    .from(schema.betaCampaign)
    .where(eq(schema.betaCampaign.key, config.campaignKey))
    .for("update")
    .then((rows) => rows[0])
  const now = new Date()
  if (
    !campaign ||
    campaign.paused ||
    now < campaign.enrollmentStartsAt ||
    now >= campaign.enrollmentEndsAt
  )
    throw new BetaAdmissionError(
      "Beta enrollment is closed. Join the waitlist for the next opening."
    )
  const policy = await tx
    .select()
    .from(schema.betaPolicy)
    .where(eq(schema.betaPolicy.version, campaign.policyVersion))
    .then((rows) => rows[0])
  if (!policy) throw new Error("Beta policy is missing")
  const used = await tx
    .select({ count: count() })
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.campaignKey, campaign.key))
    .then((rows) => rows[0]?.count ?? 0)
  if (used >= policy.cohortLimit)
    throw new BetaAdmissionError(
      "All 25 beta team places are taken. Join the waitlist for the next opening."
    )
  return { campaign, policy, now }
}

// Workspace creation and its cohort place commit together, including direct auth calls.
export async function createWithBetaTrial<T>(
  create: (tx: Transaction) => Promise<T>,
  workspaceId: (created: T) => string
): Promise<T> {
  return db.transaction(async (tx) => {
    const { campaign, policy, now } = await availableCampaign(tx)
    const created = await create(tx)
    await tx.insert(schema.workspaceBetaTrial).values({
      workspaceId: workspaceId(created),
      campaignKey: campaign.key,
      ...betaTrialTerms(policy, now),
    })
    return created
  })
}

export async function getBetaAvailability() {
  if (!hostedBetaConfig().enabled) return { enabled: false, open: false }
  try {
    await db.transaction(availableCampaign)
    return { enabled: true, open: true }
  } catch (error) {
    if (!(error instanceof BetaAdmissionError)) throw error
    return { enabled: true, open: false }
  }
}

export async function setBetaEnrollment(key: string, paused: boolean) {
  const campaign = await db
    .update(schema.betaCampaign)
    .set({ paused })
    .where(eq(schema.betaCampaign.key, key))
    .returning()
    .then((rows) => rows[0])
  if (!campaign) throw new Error("Beta campaign not found")
  return campaign
}

// Every membership insertion must hold this workspace lock through its commit.
export async function assertBetaMemberCapacity(
  tx: Transaction,
  workspaceId: string,
  userId: string
) {
  if (!hostedBetaConfig().enabled) return
  await tx
    .select({ id: schema.workspace.id })
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
    .for("update")
  const trial = await tx
    .select()
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
    .then((rows) => rows[0])
  if (!trial && (await isBetaExempt(workspaceId))) return
  if (!trial || trial.expiresAt <= new Date())
    throw new BetaAdmissionError(
      "This workspace does not have an active beta trial"
    )
  const user = await tx
    .select({ isBot: schema.user.isBot })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .then((rows) => rows[0])
  if (user?.isBot) return
  const members = await tx
    .select({ userId: schema.workspaceMember.userId })
    .from(schema.workspaceMember)
    .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMember.userId))
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        ne(schema.user.isBot, true)
      )
    )
  if (members.some((member) => member.userId === userId)) return
  if (members.length >= trial.memberLimit)
    throw new BetaAdmissionError(
      `This beta team includes ${trial.memberLimit} members. Ask the owner to contact Lor for more space.`
    )
}

function requiredText(value: string, name: string): string {
  const text = value.trim()
  if (!text || text.length > 2_000) throw new Error(`Invalid ${name}`)
  return text
}

export function hostedBetaConfig() {
  const config = readServerEnv("LOR_HOSTED_BETA", "LOR_BETA_CAMPAIGN")
  return {
    enabled: config.LOR_HOSTED_BETA,
    campaignKey: config.LOR_BETA_CAMPAIGN ?? null,
  }
}

async function ensurePolicy(tx: Transaction) {
  await tx.insert(schema.betaPolicy).values(BETA_POLICY).onConflictDoNothing()
  const policy = await tx
    .select()
    .from(schema.betaPolicy)
    .where(eq(schema.betaPolicy.version, BETA_POLICY.version))
    .limit(1)
    .then((rows) => rows[0])
  if (!policy) throw new Error("Beta policy was not saved")
  for (const key of Object.keys(BETA_POLICY) as (keyof typeof BETA_POLICY)[]) {
    if (policy[key] !== BETA_POLICY[key]) {
      throw new Error(
        "This beta policy version already has different terms; create a new version"
      )
    }
  }
  return policy
}

// Operator setup only. Creating a campaign never opens signup or starts trials.
export async function configureBetaCampaign(key: string, startsAt: Date) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
    throw new Error(
      "Campaign key must be 1–64 lowercase letters, digits or hyphens"
    )
  }
  if (!Number.isFinite(startsAt.getTime()))
    throw new Error("Invalid enrollment start")
  return db.transaction(async (tx) => {
    const policy = await ensurePolicy(tx)
    const endsAt = betaDaysAfter(startsAt, policy.enrollmentDays)
    await tx
      .insert(schema.betaCampaign)
      .values({
        key,
        policyVersion: policy.version,
        enrollmentStartsAt: startsAt,
        enrollmentEndsAt: endsAt,
      })
      .onConflictDoNothing()
    const campaign = await tx
      .select()
      .from(schema.betaCampaign)
      .where(eq(schema.betaCampaign.key, key))
      .limit(1)
      .then((rows) => rows[0])
    if (!campaign) throw new Error("Beta campaign was not saved")
    if (
      campaign.policyVersion !== policy.version ||
      campaign.enrollmentStartsAt.getTime() !== startsAt.getTime() ||
      campaign.enrollmentEndsAt.getTime() !== endsAt.getTime()
    ) {
      throw new Error(
        "Campaign already exists with different dates or terms; use a new key"
      )
    }
    return campaign
  })
}

// A trial always wins over an exemption, so a trial workspace is refused.
export async function exemptFromBeta(input: {
  workspaceId: string
  operator: string
  reason: string
}) {
  const operator = requiredText(input.operator, "operator")
  const reason = requiredText(input.reason, "reason")
  if (await getWorkspaceBetaTrial(input.workspaceId))
    throw new Error("This workspace has a beta trial; it cannot be exempt")
  await db
    .insert(schema.betaExemption)
    .values({ workspaceId: input.workspaceId, operator, reason })
    .onConflictDoUpdate({
      target: schema.betaExemption.workspaceId,
      set: { operator, reason },
    })
}

export async function removeBetaExemption(workspaceId: string) {
  await db
    .delete(schema.betaExemption)
    .where(eq(schema.betaExemption.workspaceId, workspaceId))
}

export async function getWorkspaceBetaTrial(workspaceId: string) {
  return db
    .select()
    .from(schema.workspaceBetaTrial)
    .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

// Existing-workspace activation; new workspaces use createWithBetaTrial.
// Activation and its cohort place are atomic; this does not debit any balance.
export async function activateBetaTrial(workspaceId: string) {
  const config = hostedBetaConfig()
  if (!config.enabled || !config.campaignKey) {
    throw new Error("Hosted beta enrollment is not configured")
  }
  const campaignKey = config.campaignKey
  return db.transaction(async (tx) => {
    const workspace = await tx
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, workspaceId))
      .for("update")
      .then((rows) => rows[0])
    if (!workspace) throw new Error("Workspace does not exist")
    const existing = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
      .limit(1)
      .then((rows) => rows[0])
    if (existing) return existing

    const campaign = await tx
      .select()
      .from(schema.betaCampaign)
      .where(eq(schema.betaCampaign.key, campaignKey))
      .for("update")
      .then((rows) => rows[0])
    const now = new Date()
    if (
      !campaign ||
      campaign.paused ||
      now < campaign.enrollmentStartsAt ||
      now >= campaign.enrollmentEndsAt
    ) {
      throw new Error("Beta enrollment is closed")
    }
    const policy = await tx
      .select()
      .from(schema.betaPolicy)
      .where(eq(schema.betaPolicy.version, campaign.policyVersion))
      .limit(1)
      .then((rows) => rows[0])
    if (!policy) throw new Error("Beta campaign policy is missing")
    const used = await tx
      .select({ count: count() })
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.campaignKey, campaignKey))
      .then((rows) => rows[0]?.count ?? 0)
    if (used >= policy.cohortLimit) throw new Error("Beta cohort is full")

    const trial = await tx
      .insert(schema.workspaceBetaTrial)
      .values({
        workspaceId,
        campaignKey,
        ...betaTrialTerms(policy, now),
      })
      .returning()
      .then((rows) => rows[0])
    if (!trial) throw new Error("Beta trial was not saved")
    return trial
  })
}

function snapshot(trial: WorkspaceBetaTrial): BetaTrialTerms {
  return {
    expiresAt: trial.expiresAt.toISOString(),
    readOnlyUntil: trial.readOnlyUntil.toISOString(),
    memberLimit: trial.memberLimit,
    aiGrantMicroUsd: trial.aiGrantMicroUsd,
    sandboxGrantSeconds: trial.sandboxGrantSeconds,
    browserGrantSeconds: trial.browserGrantSeconds,
  }
}

const LIMIT_FIELDS = [
  "memberLimit",
  "aiGrantMicroUsd",
  "sandboxGrantSeconds",
  "browserGrantSeconds",
] as const

function normalizeChanges(input: BetaTrialChanges): BetaTrialChanges {
  const changes: BetaTrialChanges = {}
  if (input.expiresAt !== undefined)
    changes.expiresAt = betaDate(input.expiresAt).toISOString()
  for (const key of LIMIT_FIELDS) {
    const value = input[key]
    if (value === undefined) continue
    const max =
      key === "aiGrantMicroUsd" ? Number.MAX_SAFE_INTEGER : 2_147_483_647
    const min = key === "memberLimit" ? 1 : 0
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Invalid ${key}`)
    }
    changes[key] = value
  }
  if (Object.keys(changes).length === 0)
    throw new Error("Provide at least one trial change")
  return changes
}

// Absolute new totals, not increments, with a stable request id for retries.
export async function adjustBetaTrial(input: {
  workspaceId: string
  requestId: string
  operator: string
  reason: string
  changes: BetaTrialChanges
}) {
  const requestId = requiredText(input.requestId, "request id")
  const operator = requiredText(input.operator, "operator")
  const reason = requiredText(input.reason, "reason")
  const changes = normalizeChanges(input.changes)
  return db.transaction(async (tx) => {
    const trial = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.workspaceId, input.workspaceId))
      .for("update")
      .then((rows) => rows[0])
    if (!trial) throw new Error("Workspace has no beta trial")
    const existing = await tx
      .select()
      .from(schema.betaTrialAdjustment)
      .where(
        and(
          eq(schema.betaTrialAdjustment.trialId, trial.id),
          eq(schema.betaTrialAdjustment.requestId, requestId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])
    if (existing) {
      if (
        existing.operator !== operator ||
        existing.reason !== reason ||
        JSON.stringify(normalizeChanges(existing.changes)) !==
          JSON.stringify(changes)
      ) {
        throw new Error(
          "This request id was already used for a different adjustment"
        )
      }
      return { trial, adjustment: existing, replayed: true }
    }
    const policy = await tx
      .select()
      .from(schema.betaPolicy)
      .where(eq(schema.betaPolicy.version, trial.policyVersion))
      .limit(1)
      .then((rows) => rows[0])
    if (!policy) throw new Error("Trial policy is missing")
    const expiresAt = changes.expiresAt
      ? betaDate(changes.expiresAt)
      : trial.expiresAt
    if (expiresAt < trial.expiresAt)
      throw new Error("An extension cannot shorten the trial")
    for (const key of LIMIT_FIELDS) {
      if (changes[key] !== undefined && changes[key] < trial[key]) {
        throw new Error(`An extension cannot reduce ${key}`)
      }
    }
    const before = snapshot(trial)
    const after: BetaTrialTerms = {
      ...before,
      ...changes,
      expiresAt: expiresAt.toISOString(),
      readOnlyUntil: betaDaysAfter(
        expiresAt,
        policy.retentionDays
      ).toISOString(),
    }
    const updated = await tx
      .update(schema.workspaceBetaTrial)
      .set({
        ...after,
        expiresAt,
        readOnlyUntil: betaDate(after.readOnlyUntil),
      })
      .where(eq(schema.workspaceBetaTrial.id, trial.id))
      .returning()
      .then((rows) => rows[0])
    if (!updated) throw new Error("Beta trial was not updated")
    const adjustment = await tx
      .insert(schema.betaTrialAdjustment)
      .values({
        trialId: trial.id,
        requestId,
        operator,
        reason,
        changes,
        before,
        after,
      })
      .returning()
      .then((rows) => rows[0])
    if (!adjustment) throw new Error("Beta adjustment was not saved")
    return { trial: updated, adjustment, replayed: false }
  })
}
