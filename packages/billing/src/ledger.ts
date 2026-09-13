import { db, eq, schema } from "@repo/db"
import { createLogger } from "@repo/logger"
import { trackCredits } from "./autumn"
import { computeCostUsd, computeCredits } from "./credits"
import { isBillableTool, usageDebitKey } from "./policy"
import { getRate } from "./rates"

const logger = createLogger("billing")

// Structural mirror of @repo/merlin's UsageEvent — billing must not depend on
// the merlin package (auth → billing would drag it in).
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
}

// Analytics buckets, not prices — debits come from token math.
const OPERATION_CLASS: Record<
  string,
  (typeof schema.operationClassEnum.enumValues)[number]
> = {
  "merlin.respond": "lor.standard",
  investigate_code: "lor.deep",
  "merlin.embed": "embedding",
  "source.summarize": "ingestion",
  "source.embed": "embedding",
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
    const rate = u.model ? await getRate(u.model) : null
    const tokens = {
      inputTokens: u.inputTokens,
      cachedInputTokens: u.cachedInputTokens,
      outputTokens: u.outputTokens,
    }
    const costUsd = u.costUsd ?? (rate ? computeCostUsd(tokens, rate) : null)
    const billable = isBillableTool(u.tool)
    const credits = billable && rate ? computeCredits(tokens, rate) : 0
    const debitKey = usageDebitKey({
      billingKey: u.billingKey,
      messageId: refs.messageId,
      tool: u.tool,
    })
    const selection = {
      creditsDebited: schema.usageEvent.creditsDebited,
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
        debitStatus: credits > 0 ? "pending" : "free",
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
    if (row?.debitStatus === "pending" && row.creditsDebited > 0) {
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
  }
}
