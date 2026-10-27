import { db, eq, schema } from "@repo/db"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type {
  GetSandboxSettingsRoute,
  UpdateSandboxSettingsRoute,
} from "@/routes/v1/sandbox-settings/routes"

// New users start on auto (pi-harness-runbook.md §4.6).
const DEFAULT_SETTINGS = { sandboxMode: "auto" as const }

export const getSandboxSettings: AppRouteHandler<
  GetSandboxSettingsRoute
> = async (c) => {
  const settings = await db
    .select({ sandboxMode: schema.userSandboxSettings.sandboxMode })
    .from(schema.userSandboxSettings)
    .where(eq(schema.userSandboxSettings.userId, c.var.user.id))
    .limit(1)
    .then((rows) => rows[0])
  return c.json(settings ?? DEFAULT_SETTINGS, HttpStatusCodes.OK)
}

export const updateSandboxSettings: AppRouteHandler<
  UpdateSandboxSettingsRoute
> = async (c) => {
  const body = c.req.valid("json")
  const updated = await db
    .insert(schema.userSandboxSettings)
    .values({ userId: c.var.user.id, ...body })
    .onConflictDoUpdate({
      target: schema.userSandboxSettings.userId,
      set: body,
    })
    .returning({ sandboxMode: schema.userSandboxSettings.sandboxMode })
    .then((rows) => rows[0])
  return c.json(updated ?? DEFAULT_SETTINGS, HttpStatusCodes.OK)
}
