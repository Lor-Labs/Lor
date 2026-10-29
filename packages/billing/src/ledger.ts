import { db, eq, schema } from "@repo/db"
import { betaLimitsLifted } from "@repo/db/queries/beta-access"
import { env } from "@repo/env/server"
import { createLogger } from "@repo/logger"
import { trackCredits } from "./autumn"
import { hostedBetaConfig } from "./beta"
import { isBetaWorkspace, settleBetaUsage } from "./beta-credits"
import { MICRO_USD } from "./beta-policy"
import { computeCostUsd, creditsForCost } from "./credits"
import { isBillableTool, usageDebitKey } from "./policy"
import { getRate } from "./rates"

const logger = createLogger("billing")

// Structural mirror of @repo/lor's UsageEvent — billing must not depend on
// the lor package (auth → billing would drag it in).
export type UsageLike = {
  workspaceId: string
  tool: string
  model?: string
  requestedModel?: string
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  wallMs?: number
  toolCalls?: number
  costUsd?: number
  // Stable within a parent response so repeat jobs do not duplicate debits.
  billingKey?: string
}

export type UsageRefs = {
  messageId?: string | null
  channelId?: string | null
  userId?: string | null
  betaStep?: boolean
  // Scopes the debit key when there is no message (voice requests).
  debitScope?: string
}

// Analytics buckets, not prices — debits come from token math.
const OPERATION_CLASS: Record<
  string,
  (typeof schema.operationClassEnum.enumValues)[number]
> = {
  "lor.respond": "lor.standard",
  "lor.embed": "embedding",
  "source.summarize": "ingestion",
  "source.embed": "embedding",
  "attachment.transcribe": "ingestion",
  "attachment.embed": "embedding",
}

// Persist a ledger row and, for billable tools only, debit Autumn. A billable
// row starts pending; retries load it by idempotency key and resume only while
// it remains pending. Its row id is also Autumn's idempotency identity, closing
// the crash window between the provider debit and our terminal status update.
export async function recordUsage(
  u: UsageLike,
  refs: UsageRefs = {}
): Promise<void> {
  try {
    const beta =
      isBillableTool(u.tool) && (await isBetaWorkspace(u.workspaceId))
    // Beta steps already settled; the aggregate must never debit again.
    if (beta && !refs.betaStep) return
    const billable = isBillableTool(u.tool)
    if (beta && u.costUsd == null)
      throw new Error("Beta usage requires the per-request price")
    const tokens = {
      inputTokens: u.inputTokens,
      cachedInputTokens: u.cachedInputTokens,
      outputTokens: u.outputTokens,
    }
    const rate =
      u.model && u.costUsd == null ? await getRate(u.model, tokens) : null
    // A turn passes the cost its spend counter summed call by call (each at
    // its own long-context tier), so the debit matches it.
    const costUsd = u.costUsd ?? (rate ? computeCostUsd(tokens, rate) : null)
    if (
      billable &&
      hostedBetaConfig().enabled &&
      !beta &&
      !(await betaLimitsLifted(u.workspaceId))
    )
      throw new Error("Hosted usage has no beta trial")
    if (costUsd != null && (!Number.isFinite(costUsd) || costUsd < 0))
      throw new Error("Invalid inference cost")
    if (beta && costUsd == null)
      throw new Error("Beta inference cost is unavailable")
    const betaDebitMicroUsd =
      beta && costUsd != null ? Math.round(costUsd * MICRO_USD) : null
    if (
      betaDebitMicroUsd !== null &&
      (!Number.isSafeInteger(betaDebitMicroUsd) || betaDebitMicroUsd < 0)
    )
      throw new Error("Invalid beta inference cost")
    const credits =
      !beta && billable && costUsd !== null
        ? creditsForCost(costUsd, env.CREDIT_CONVERSION_RATE)
        : 0
    const debitKey = usageDebitKey({
      billingKey: u.billingKey,
      messageId: refs.messageId ?? refs.debitScope,
      tool: u.tool,
    })
    const selection = {
      creditsDebited: schema.usageEvent.creditsDebited,
      betaDebitMicroUsd: schema.usageEvent.betaDebitMicroUsd,
      debitStatus: schema.usageEvent.debitStatus,
      id: schema.usageEvent.id,
      workspaceId: schema.usageEvent.workspaceId,
    }
    const inserted = await db
      .insert(schema.usageEvent)
      .values({
        workspaceId: u.workspaceId,
        userId: refs.userId ?? null,
        channelId: refs.channelId ?? null,
        operationClass: OPERATION_CLASS[u.tool] ?? "overhead",
        model: u.model ?? null,
        requestedModel: u.requestedModel ?? null,
        inputTokens: u.inputTokens ?? null,
        cachedInputTokens: u.cachedInputTokens ?? null,
        outputTokens: u.outputTokens ?? null,
        reasoningTokens: u.reasoningTokens ?? null,
        wallMs: u.wallMs ?? null,
        toolCalls: u.toolCalls ?? null,
        costUsd: costUsd != null ? costUsd.toFixed(6) : null,
        creditsDebited: credits,
        betaDebitMicroUsd,
        debitStatus:
          credits > 0 || (betaDebitMicroUsd ?? 0) > 0 ? "pending" : "free",
        messageId: refs.messageId ?? null,
        idempotencyKey: debitKey,
      })
      .onConflictDoNothing({ target: schema.usageEvent.idempotencyKey })
      .returning(selection)
    const existing =
      inserted[0] || !debitKey
        ? undefined
        : await db
            .select(selection)
            .from(schema.usageEvent)
            .where(eq(schema.usageEvent.idempotencyKey, debitKey))
            .limit(1)
            .then((rows) => rows[0])
    const row = inserted[0] ?? existing
    if (row?.debitStatus === "pending" && row.betaDebitMicroUsd != null) {
      await settleBetaUsage(row.id)
    } else if (row?.debitStatus === "pending" && row.creditsDebited > 0) {
      const status = await trackCredits(
        row.workspaceId,
        row.creditsDebited,
        row.id
      )
      await db
        .update(schema.usageEvent)
        .set({ debitStatus: status })
        .where(eq(schema.usageEvent.id, row.id))
    }
  } catch (err) {
    logger.error({ err, tool: u.tool }, "Failed to record usage")
    if (refs.betaStep) throw err
  }
}
