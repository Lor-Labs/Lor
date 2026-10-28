import { createRoute, z } from "@hono/zod-openapi"
import {
  hostedBetaEnabled,
  workspaceBetaAccess,
} from "@repo/db/queries/beta-access"
import { betaComputeSummary } from "@repo/db/queries/beta-compute"
import jsonContent from "@/lib/helpers/openapi/json-content"
import type { AppRouteHandler } from "@/lib/types/app-types"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import { billingWorkspaceParamsSchema, computeSchema } from "./schema"

export const entitlements = createRoute({
  path: "/workspaces/{workspaceSlug}/entitlements",
  method: "get",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    200: jsonContent({
      description:
        "Beta access and pooled compute allowance for all workspace members",
      schema: z.object({
        enabled: z.boolean(),
        state: z.enum(["active", "expired", "not_enrolled"]),
        expiresAt: z.string().nullable(),
        compute: computeSchema.nullable(),
      }),
    }),
  },
})
export const entitlementsHandler: AppRouteHandler<typeof entitlements> = async (
  c
) => {
  c.header("Cache-Control", "no-store")
  const access = await workspaceBetaAccess(c.var.workspace.id)
  return c.json(
    {
      enabled: hostedBetaEnabled(),
      state: access.state,
      expiresAt: access.trial?.expiresAt.toISOString() ?? null,
      compute: await betaComputeSummary(c.var.workspace.id),
    },
    200
  )
}
