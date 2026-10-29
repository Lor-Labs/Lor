import { randomUUID } from "node:crypto"
import { and, db, eq, gt, isNotNull, isNull, or, schema } from "@repo/db"
import {
  betaUsageHalted,
  workspaceBetaAccess,
} from "@repo/db/queries/beta-access"
import { workspaceInferenceFunding } from "@repo/db/queries/inference"
import { env } from "@repo/env/server"
import { readServerEnv } from "@repo/env/server-fields"
import { createLogger } from "@repo/logger"
import { getWorkspaceBetaTrial, hostedBetaConfig } from "./beta"
import { MICRO_USD } from "./beta-policy"
import { getAutumn } from "./client"
import {
  AI_USAGE_FEATURE_ID,
  CREDIT_USD,
  CREDITS_FEATURE_ID,
  PRO_PLAN_ID,
  TOPUP_PLAN_ID,
} from "./constants"
import { sendBetaCreditsExhaustedEmail } from "./emails"

const logger = createLogger("beta-billing")
const MICRO_USD_PER_CREDIT = MICRO_USD * CREDIT_USD

// Autumn owns free + purchased balances. Postgres records the offer and delivery state.
export async function syncBetaCredits(workspaceId: string) {
  if (!hostedBetaConfig().enabled) return null
  return db.transaction(async (tx) => {
    const trial = await tx
      .select()
      .from(schema.workspaceBetaTrial)
      .where(eq(schema.workspaceBetaTrial.workspaceId, workspaceId))
      .for("update")
      .then((rows) => rows[0])
    if (!trial) return null
    const autumn = getAutumn()
    if (!autumn) throw new Error("Beta credits require Autumn")
    const balanceId = `beta_${trial.id}`
    let customer = await autumn.customers.getOrCreate({
      customerId: workspaceId,
    })
    // Subscribing ends beta mode; cancelling brings the trial's terms back.
    const subscribed = customer.subscriptions.some(
      (s) => s.planId === PRO_PLAN_ID && s.status === "active"
    )
    if (subscribed !== Boolean(trial.subscribedAt))
      await tx
        .update(schema.workspaceBetaTrial)
        .set({ subscribedAt: subscribed ? new Date() : null })
        .where(eq(schema.workspaceBetaTrial.id, trial.id))
    const base = {
      expiresAt: trial.expiresAt.toISOString(),
      creditGrantUsd: trial.creditGrantMicroUsd / MICRO_USD,
      subscribed,
    }
    const purchasedUsd = () =>
      (customer.balances[CREDITS_FEATURE_ID]?.breakdown
        ?.filter((b) => b.planId === TOPUP_PLAN_ID)
        .reduce((sum, b) => sum + Math.max(0, b.remaining), 0) ?? 0) *
      CREDIT_USD
    if (trial.expiresAt <= new Date())
      return {
        ...base,
        expired: true,
        freeRemainingUsd: 0,
        purchasedRemainingUsd: purchasedUsd(),
        available: true,
      }
    const findGrant = () =>
      customer.balances[CREDITS_FEATURE_ID]?.breakdown?.find(
        (b) => b.id === balanceId
      )
    if (!trial.autumnGrantCreatedAt) {
      if (!findGrant()) {
        try {
          await autumn.balances.create({
            customerId: workspaceId,
            featureId: CREDITS_FEATURE_ID,
            includedGrant: trial.creditGrantMicroUsd / MICRO_USD_PER_CREDIT,
            expiresAt: trial.expiresAt.getTime(),
            balanceId,
          })
        } catch (error) {
          // Recover an accepted grant after a timeout, without treating arbitrary conflicts as success.
          customer = await autumn.customers.getOrCreate({
            customerId: workspaceId,
          })
          if (!findGrant()) throw error
        }
      }
    } else if (
      trial.autumnGrantMicroUsd !== trial.creditGrantMicroUsd ||
      trial.autumnGrantExpiresAt?.getTime() !== trial.expiresAt.getTime()
    ) {
      await autumn.balances.update({
        customerId: workspaceId,
        featureId: CREDITS_FEATURE_ID,
        balanceId,
        includedGrant: trial.creditGrantMicroUsd / MICRO_USD_PER_CREDIT,
        expiresAt: trial.expiresAt.getTime(),
      })
    }
    customer = await autumn.customers.getOrCreate({ customerId: workspaceId })
    const grant = findGrant()
    if (!grant) throw new Error("Beta credit grant is unavailable")
    const freeRemainingUsd = Math.max(0, grant.remaining) * CREDIT_USD
    const purchasedRemainingUsd = purchasedUsd()
    const empty = freeRemainingUsd + purchasedRemainingUsd <= 0
    await tx
      .update(schema.workspaceBetaTrial)
      .set({
        autumnGrantCreatedAt: trial.autumnGrantCreatedAt ?? new Date(),
        autumnGrantMicroUsd: trial.creditGrantMicroUsd,
        autumnGrantExpiresAt: trial.expiresAt,
        creditsEmptyAt: empty ? (trial.creditsEmptyAt ?? new Date()) : null,
      })
      .where(eq(schema.workspaceBetaTrial.id, trial.id))
    // One email when the free grant first runs out (purchased credits may
    // still be left).
    if (grant.remaining <= 0 && !trial.exhaustionEmail && !subscribed) {
      const owner = await tx
        .select({
          email: schema.user.email,
          name: schema.workspace.name,
          slug: schema.workspace.slug,
        })
        .from(schema.workspace)
        .innerJoin(schema.user, eq(schema.workspace.ownerId, schema.user.id))
        .where(eq(schema.workspace.id, workspaceId))
        .then((rows) => rows[0])
      if (!owner) throw new Error("Beta owner is missing")
      await tx
        .update(schema.workspaceBetaTrial)
        .set({
          exhaustionEmail: {
            to: owner.email,
            name: owner.name,
            url: `${env.APP_BASE_URL}/${owner.slug}?settings=workspace&tab=billing`,
            expiresAt: trial.expiresAt.toISOString(),
          },
        })
        .where(eq(schema.workspaceBetaTrial.id, trial.id))
    }
    return {
      ...base,
      expired: false,
      freeRemainingUsd,
      purchasedRemainingUsd,
      available: true,
    }
  })
}

// `sync` reads Autumn (run start). Without it the check is database only:
// credits_empty_at, kept current by each step's debit and the minute sweep,
// so model requests and heartbeats never call Autumn.
export async function checkBetaCredits(
  workspaceId: string,
  { sync = false }: { sync?: boolean } = {}
) {
  if (!hostedBetaConfig().enabled) return null
  try {
    const access = await workspaceBetaAccess(workspaceId)
    if (access.state !== "active") return { allowed: false, failOpen: false }
    // Exempt or subscribed: normal credit billing applies.
    if (!access.trial) return null
    if (await betaUsageHalted(access.trial.campaignKey))
      return { allowed: false, failOpen: false }
    // A workspace key pays for AI, but the run's sandbox still draws on the
    // pool.
    if (access.trial.creditsEmptyAt) return { allowed: false, failOpen: false }
    if ((await workspaceInferenceFunding(workspaceId)).source === "byok")
      return { allowed: true, failOpen: false }
    // A new team's grant is created on its first sync.
    if (sync || !access.trial.autumnGrantCreatedAt) {
      const balance = await syncBetaCredits(workspaceId)
      if (
        !balance ||
        balance.expired ||
        balance.freeRemainingUsd + balance.purchasedRemainingUsd <= 0
      )
        return { allowed: false, failOpen: false }
    }
    const pending = await db
      .select({ id: schema.usageEvent.id })
      .from(schema.usageEvent)
      .where(
        and(
          eq(schema.usageEvent.workspaceId, workspaceId),
          eq(schema.usageEvent.debitStatus, "pending"),
          isNotNull(schema.usageEvent.betaDebitMicroUsd)
        )
      )
      .limit(1)
    return { allowed: pending.length === 0, failOpen: false }
  } catch (error) {
    logger.error(
      { err: error, workspaceId },
      "Beta credit check unavailable; refusing new inference"
    )
    return { allowed: false, failOpen: false }
  }
}

export async function settleBetaUsage(id: string) {
  const row = await db
    .select()
    .from(schema.usageEvent)
    .where(eq(schema.usageEvent.id, id))
    .then((rows) => rows[0])
  if (!row || row.betaDebitMicroUsd === null || row.debitStatus !== "pending")
    return
  const debitMicroUsd = row.betaDebitMicroUsd
  const autumn = getAutumn()
  if (!autumn) throw new Error("Autumn is unavailable")
  const trial = await getWorkspaceBetaTrial(row.workspaceId)
  // Ensure a new team's grant exists before its first debit.
  if (!trial?.autumnGrantCreatedAt) await syncBetaCredits(row.workspaceId)
  // Assigned inside the transaction callback.
  let remaining = null as number | null
  await db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(schema.usageEvent)
      .where(eq(schema.usageEvent.id, id))
      .for("update")
      .then((rows) => rows[0])
    if (!current || current.debitStatus !== "pending") return
    try {
      const tracked = await autumn.track(
        {
          customerId: row.workspaceId,
          featureId: AI_USAGE_FEATURE_ID,
          value: debitMicroUsd / MICRO_USD_PER_CREDIT,
          overageBehavior: "cap",
          async: false,
        },
        { headers: { "Idempotency-Key": row.id } }
      )
      if (!tracked.balance)
        throw new Error(
          "Autumn has not confirmed the beta debit; keep inference paused"
        )
      remaining = tracked.balance.remaining
    } catch (error) {
      // Autumn's Track API documents 409 for a previously accepted idempotency key.
      if ((error as { statusCode?: number }).statusCode !== 409) throw error
    }
    await tx
      .update(schema.usageEvent)
      .set({ debitStatus: "debited" })
      .where(eq(schema.usageEvent.id, id))
  })
  // The debit's own balance marks the pool empty at once; a replayed debit
  // (409) has none, so read it from Autumn.
  if (remaining === null) await syncBetaCredits(row.workspaceId)
  else if (remaining <= 0)
    await db
      .update(schema.workspaceBetaTrial)
      .set({ creditsEmptyAt: new Date() })
      .where(
        and(
          eq(schema.workspaceBetaTrial.workspaceId, row.workspaceId),
          isNull(schema.workspaceBetaTrial.creditsEmptyAt)
        )
      )
}

// Local testing only (`pnpm beta drain`): uses up a trial team's whole
// balance so the out-of-credits flow can be tried without spending it.
export async function drainBetaCredits(workspaceId: string) {
  if (readServerEnv("NODE_ENV").NODE_ENV === "production")
    throw new Error("drain is for local testing only")
  const autumn = getAutumn()
  if (!autumn) throw new Error("Beta credits require Autumn")
  if (!(await getWorkspaceBetaTrial(workspaceId)))
    throw new Error("Workspace has no beta trial")
  await syncBetaCredits(workspaceId)
  const customer = await autumn.customers.getOrCreate({
    customerId: workspaceId,
  })
  const remaining = customer.balances[CREDITS_FEATURE_ID]?.remaining ?? 0
  if (remaining > 0)
    await autumn.track(
      {
        customerId: workspaceId,
        // AI usage costs 1 credit per unit, so this empties the pool.
        featureId: AI_USAGE_FEATURE_ID,
        value: remaining,
        overageBehavior: "cap",
        async: false,
      },
      { headers: { "Idempotency-Key": `drain-${randomUUID()}` } }
    )
  return syncBetaCredits(workspaceId)
}

// Durable retries for provider outages and exhaustion notices; no dependency on a next user request.
export async function sweepBetaBilling() {
  if (!hostedBetaConfig().enabled) return
  const pending = await db
    .select({ id: schema.usageEvent.id })
    .from(schema.usageEvent)
    .where(
      and(
        eq(schema.usageEvent.debitStatus, "pending"),
        isNotNull(schema.usageEvent.betaDebitMicroUsd)
      )
    )
    .limit(100)
  for (const row of pending) {
    try {
      await settleBetaUsage(row.id)
    } catch (error) {
      logger.error({ err: error, usageId: row.id }, "Beta debit retry failed")
    }
  }
  // Live trials need their balance; subscribed ones (expired or not) are
  // rechecked so a missed cancellation webhook can't keep beta limits off.
  // Only expired, never-subscribed trials are skipped.
  const trials = await db
    .select({ workspaceId: schema.workspaceBetaTrial.workspaceId })
    .from(schema.workspaceBetaTrial)
    .where(
      and(
        isNotNull(schema.workspaceBetaTrial.workspaceId),
        or(
          gt(schema.workspaceBetaTrial.expiresAt, new Date()),
          isNotNull(schema.workspaceBetaTrial.subscribedAt)
        )
      )
    )
  for (const trial of trials) {
    if (!trial.workspaceId) continue
    try {
      await syncBetaCredits(trial.workspaceId)
    } catch (error) {
      logger.error(
        { err: error, workspaceId: trial.workspaceId },
        "Beta balance reconciliation failed"
      )
    }
  }
  const notices = await db
    .select({ id: schema.workspaceBetaTrial.id })
    .from(schema.workspaceBetaTrial)
    .where(
      and(
        isNotNull(schema.workspaceBetaTrial.exhaustionEmail),
        isNotNull(schema.workspaceBetaTrial.workspaceId),
        gt(schema.workspaceBetaTrial.expiresAt, new Date()),
        isNull(schema.workspaceBetaTrial.exhaustionEmailSentAt),
        isNull(schema.workspaceBetaTrial.subscribedAt)
      )
    )
    .limit(100)
  for (const notice of notices) {
    // Commit the first-attempt timestamp before sending; Resend deduplicates retries for 24h.
    await db
      .update(schema.workspaceBetaTrial)
      .set({ exhaustionEmailAttemptedAt: new Date() })
      .where(
        and(
          eq(schema.workspaceBetaTrial.id, notice.id),
          isNull(schema.workspaceBetaTrial.exhaustionEmailAttemptedAt)
        )
      )
    try {
      await db.transaction(async (tx) => {
        const trial = await tx
          .select()
          .from(schema.workspaceBetaTrial)
          .where(eq(schema.workspaceBetaTrial.id, notice.id))
          .for("update", { skipLocked: true })
          .then((rows) => rows[0])
        if (
          !trial?.exhaustionEmail ||
          trial.exhaustionEmailSentAt ||
          trial.subscribedAt ||
          !trial.workspaceId ||
          trial.expiresAt <= new Date()
        )
          return
        if (
          !trial.exhaustionEmailAttemptedAt ||
          Date.now() - trial.exhaustionEmailAttemptedAt.getTime() >=
            23 * 60 * 60 * 1000
        )
          throw new Error(
            "Exhaustion email needs operator reconciliation before retrying beyond Resend's deduplication window"
          )
        await sendBetaCreditsExhaustedEmail(trial.id, trial.exhaustionEmail)
        await tx
          .update(schema.workspaceBetaTrial)
          .set({ exhaustionEmailSentAt: new Date() })
          .where(eq(schema.workspaceBetaTrial.id, trial.id))
      })
    } catch (error) {
      logger.error(
        { err: error, trialId: notice.id },
        "Beta exhaustion email delivery failed"
      )
    }
  }
}

// A trial team still in beta mode (not subscribed).
export async function isBetaWorkspace(workspaceId: string) {
  if (!hostedBetaConfig().enabled) return false
  const trial = await getWorkspaceBetaTrial(workspaceId)
  return Boolean(trial && !trial.subscribedAt)
}
