import { db, eq, schema } from "@repo/db"
import { userRoom } from "@repo/realtime-types"
import { publishRealtime } from "@/lib/bot-messages"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { DismissHintRoute, ListHintsRoute } from "@/routes/v1/hints/routes"

export const listHints: AppRouteHandler<ListHintsRoute> = async (c) => {
  const rows = await db
    .select({ key: schema.hintDismissal.key })
    .from(schema.hintDismissal)
    .where(eq(schema.hintDismissal.userId, c.var.user.id))
  return c.json({ dismissed: rows.map((row) => row.key) }, HttpStatusCodes.OK)
}

export const dismissHint: AppRouteHandler<DismissHintRoute> = async (c) => {
  const userId = c.var.user.id
  const { key } = c.req.valid("param")

  await db
    .insert(schema.hintDismissal)
    .values({ userId, key })
    .onConflictDoNothing()

  // Best-effort sync to the user's other devices; the row is already saved.
  await publishRealtime((io) =>
    io.to(userRoom(userId)).emit("hint:dismissed", { key })
  ).catch((err) => logger.warn({ err, userId }, "hint:dismissed emit failed"))

  return c.json({ success: true as const }, HttpStatusCodes.OK)
}
