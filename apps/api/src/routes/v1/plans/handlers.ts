import { and, db, desc, eq, inArray, or, schema } from "@repo/db"
import { loadApprovalResolvers, serializeApproval } from "@/lib/approvals"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { userCanAccessChannel } from "@/lib/queries/channel-access"
import { serializePlan } from "@/lib/scope-runs"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetPlanRoute,
  ListChannelPlansRoute,
} from "@/routes/v1/plans/routes"

const ACTIVE_STATUSES = [
  "running",
  "waiting_for_input",
  "waiting_for_approval",
] as const

export const listChannelPlans: AppRouteHandler<ListChannelPlansRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const { channelId } = c.req.valid("param")
  const { active, messageId } = c.req.valid("query")

  const canAccess = await userCanAccessChannel(channelId, currentUser.id)
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const plans = await db
    .select()
    .from(schema.plan)
    .where(
      and(
        eq(schema.plan.channelId, channelId),
        ...(messageId
          ? [
              or(
                eq(schema.plan.cardMessageId, messageId),
                eq(schema.plan.threadRootId, messageId)
              ),
            ]
          : []),
        ...(active === "true"
          ? [inArray(schema.plan.status, [...ACTIVE_STATUSES])]
          : [])
      )
    )
    .orderBy(desc(schema.plan.createdAt))
    .limit(50)

  return c.json({ plans: plans.map(serializePlan) }, HttpStatusCodes.OK)
}

export const getPlan: AppRouteHandler<GetPlanRoute> = async (c) => {
  const currentUser = c.var.user
  const { planId } = c.req.valid("param")

  const row = await db
    .select({
      plan: schema.plan,
      channelWorkspaceId: schema.channel.workspaceId,
    })
    .from(schema.plan)
    .innerJoin(schema.channel, eq(schema.plan.channelId, schema.channel.id))
    .where(eq(schema.plan.id, planId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row || row.channelWorkspaceId !== row.plan.workspaceId) {
    return c.json(
      { success: false as const, message: "Plan not found" },
      HttpStatusCodes.NOT_FOUND
    )
  }
  const canAccess = await userCanAccessChannel(
    row.plan.channelId,
    currentUser.id
  )
  if (!canAccess) {
    return c.json(
      { success: false as const, message: "Forbidden" },
      HttpStatusCodes.FORBIDDEN
    )
  }

  const pending = await db
    .select()
    .from(schema.approval)
    .where(
      and(
        eq(schema.approval.planId, planId),
        eq(schema.approval.status, "pending")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  // Resolver spec + display name so the card can gate its buttons client-side
  // (the resolve endpoint enforces regardless).
  const resolver = pending
    ? ((await loadApprovalResolvers(row.plan.workspaceId, [pending])).get(
        pending.id
      ) ?? null)
    : null
  const resolverUserName =
    resolver?.kind === "user"
      ? await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, resolver.userId))
          .limit(1)
          .then((rows) => rows[0]?.name ?? null)
      : null

  return c.json(
    {
      plan: serializePlan(row.plan),
      pendingApproval: pending
        ? { ...serializeApproval(pending), resolver, resolverUserName }
        : null,
    },
    HttpStatusCodes.OK
  )
}
