import { and, db, eq, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  RegisterPushTokenRoute,
  RemovePushTokenRoute,
} from "@/routes/v1/push-tokens/routes"

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
      },
    })

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
