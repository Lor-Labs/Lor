import { and, db, eq, isNull, schema } from "@repo/db"
import { createLogger } from "@repo/logger"
import { grantPromoCredits } from "./autumn"
import { billingEnabled } from "./client"

const logger = createLogger("billing")

// One-time signup credits, granted when the workspace's first invite is
// accepted. The promoGrantedAt claim is race-safe (conditional update) and
// reverted if the Autumn grant fails, so the next accept retries it.
export async function grantFirstInvitePromo(
  workspaceId: string
): Promise<void> {
  if (!billingEnabled) return
  const claimed = await db
    .update(schema.workspace)
    .set({ promoGrantedAt: new Date() })
    .where(
      and(
        eq(schema.workspace.id, workspaceId),
        isNull(schema.workspace.promoGrantedAt)
      )
    )
    .returning({ id: schema.workspace.id })
  if (claimed.length === 0) return
  try {
    await grantPromoCredits(workspaceId)
    logger.info({ workspaceId }, "Granted first-invite promo credits")
  } catch (err) {
    logger.error({ err, workspaceId }, "Promo grant failed; reverting claim")
    await db
      .update(schema.workspace)
      .set({ promoGrantedAt: null })
      .where(eq(schema.workspace.id, workspaceId))
      .catch(() => {})
  }
}
