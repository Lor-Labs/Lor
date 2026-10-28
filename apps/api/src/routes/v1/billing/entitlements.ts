import { createRoute, z } from "@hono/zod-openapi"
import {
  hostedBetaEnabled,
  workspaceBetaAccess,
} from "@repo/db/queries/beta-access"
import jsonContent from "@/lib/helpers/openapi/json-content"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import { billingWorkspaceParamsSchema } from "./schema"

export const entitlements = createRoute({
  path: "/workspaces/{workspaceSlug}/entitlements",
  method: "get",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    200: jsonContent({
      description:
        "Beta access and whether the team's shared credits are used up, for all workspace members",
      schema: z.object({
        enabled: z.boolean(),
        state: z.enum(["active", "expired", "not_enrolled"]),
        expiresAt: z.string().nullable(),
        creditsEmpty: z.boolean(),
      }),
    }),
  },
})
export const entitlementsHandler: AppRouteHandler<typeof entitlements> = async (
  c
) => {
  c.header("Cache-Control", "no-store")
  const access = await workspaceBetaAccess(c.var.workspace.id)
  // Active without a trial is an exempt or subscribed workspace: no banner.
  const exempt = access.state === "active" && !access.trial
  return c.json(
    {
      enabled: hostedBetaEnabled() && !exempt,
      state: access.state,
      expiresAt: access.trial?.expiresAt.toISOString() ?? null,
      creditsEmpty: Boolean(access.trial?.creditsEmptyAt),
    },
    200
  )
}
