import { and, db, desc, eq, inArray, lte, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  RegisterPushTokenRoute,
  RemovePushTokenRoute,
} from "@/routes/v1/push-tokens/routes"

const MAX_PUSH_TOKENS_PER_USER = 20

export const registerPushToken: AppRouteHandler<
  RegisterPushTokenRoute
> = async (c) => {
  const currentUser = c.var.user
  const body = c.req.valid("json")

  await db
    .insert(schema.pushToken)
    .values({
      userId: currentUser.id,
      token: body.token,
      platform: body.platform,
    })
    .onConflictDoUpdate({
      target: schema.pushToken.token,
      set: {
        userId: currentUser.id,
        platform: body.platform,
        updatedAt: new Date(),
      },
    })

  // Past the cap, the least recently registered devices fall off. The delete
  // re-checks owner and age, so a token refreshed or reassigned meanwhile
  // survives.
  const stale = await db
    .select({
      id: schema.pushToken.id,
      updatedAt: schema.pushToken.updatedAt,
    })
    .from(schema.pushToken)
    .where(eq(schema.pushToken.userId, currentUser.id))
    .orderBy(desc(schema.pushToken.updatedAt))
    .offset(MAX_PUSH_TOKENS_PER_USER)
  const newestStale = stale[0]?.updatedAt
  if (newestStale) {
    await db.delete(schema.pushToken).where(
      and(
        inArray(
          schema.pushToken.id,
          stale.map((row) => row.id)
        ),
        eq(schema.pushToken.userId, currentUser.id),
        lte(schema.pushToken.updatedAt, newestStale)
      )
    )
  }

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}

export const removePushToken: AppRouteHandler<RemovePushTokenRoute> = async (
  c
) => {
  const currentUser = c.var.user
  const body = c.req.valid("json")

  await db
    .delete(schema.pushToken)
    .where(
      and(
        eq(schema.pushToken.token, body.token),
        eq(schema.pushToken.userId, currentUser.id)
      )
    )

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
