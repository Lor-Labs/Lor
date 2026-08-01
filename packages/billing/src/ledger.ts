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
  "merlin.respond": "merlin.standard",
  investigate_code: "merlin.deep",
  "merlin.embed": "embedding",
  "source.summarize": "ingestion",
  "source.embed": "embedding",
}

// Persist a ledger row and, for billable tools only, debit Autumn. The
// idempotency key makes retries debit-safe: the insert conflict skips both
// the duplicate row and the duplicate track. Only billable events carry a
// key — repeatable events (e.g. two sandbox runs) keep null keys.
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
        debitStatus: "free",
        messageId: refs.messageId ?? null,
        idempotencyKey: usageDebitKey({
          billingKey: u.billingKey,
          messageId: refs.messageId,
          tool: u.tool,
        }),
      })
      .onConflictDoNothing({ target: schema.usageEvent.idempotencyKey })
      .returning({ id: schema.usageEvent.id })
    const row = inserted[0]
    if (credits > 0 && row) {
      const status = await trackCredits(u.workspaceId, credits)
      await db
        .update(schema.usageEvent)
        .set({ debitStatus: status })
        .where(eq(schema.usageEvent.id, row.id))
    }
  } catch (err) {
    logger.error({ err, tool: u.tool }, "Failed to record usage")
  }
}
