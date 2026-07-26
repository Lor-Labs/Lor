import { and, count, db, eq, MERLIN_USER_ID, ne, schema } from "@repo/db"
import { createLogger } from "@repo/logger"
import { getAutumn } from "./client"
import { CREDITS_FEATURE_ID, CREDITS_PER_SEAT, PRO_PLAN_ID } from "./constants"

const logger = createLogger("billing")

export async function countSeats(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        ne(schema.workspaceMember.userId, MERLIN_USER_ID)
      )
    )
  return rows[0]?.value ?? 0
}

// Recomputes from scratch on every call, so any later trigger self-heals a
// missed one (user-delete cascades have no hook today). No-op when the
// workspace isn't subscribed. Fire-and-forget at call sites.
export async function syncSeats(workspaceId: string): Promise<void> {
  const autumn = getAutumn()
  if (!autumn) return
  try {
    const customer = await autumn.customers.getOrCreate({
      customerId: workspaceId,
    })
    const sub = customer.subscriptions.find(
      (s) => s.planId === PRO_PLAN_ID && s.status === "active"
    )
    if (!sub) return
    const seats = await countSeats(workspaceId)
    if (seats < 1) return
    await autumn.billing.update({
      customerId: workspaceId,
      planId: PRO_PLAN_ID,
      featureQuantities: [
        { featureId: CREDITS_FEATURE_ID, quantity: seats * CREDITS_PER_SEAT },
      ],
    })
  } catch (err) {
    logger.error({ err, workspaceId }, "Autumn seat sync failed")
  }
}
