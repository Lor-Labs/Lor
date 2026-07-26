import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"
import {
  billingSummaryResponseSchema,
  billingWorkspaceParamsSchema,
  checkoutResponseSchema,
  portalResponseSchema,
  topupBodySchema,
} from "@/routes/v1/billing/schema"

const commonErrors = {
  [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
  [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
  [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
  [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
} as const

export const getBilling = createRoute({
  path: "/workspaces/{workspaceSlug}/billing",
  method: "get",
  summary: "Get workspace billing summary",
  description:
    "Subscription status, seat count, and pooled credit balances. Admin only.",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: billingSummaryResponseSchema,
      description: "Billing summary",
    }),
    ...commonErrors,
  },
})

export type GetBillingRoute = typeof getBilling

export const subscribe = createRoute({
  path: "/workspaces/{workspaceSlug}/billing/subscribe",
  method: "post",
  summary: "Subscribe the workspace",
  description:
    "Attaches the Pro plan sized to the current seat count and returns a checkout URL. Admin only.",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: checkoutResponseSchema,
      description: "Checkout URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    ...commonErrors,
  },
})

export type SubscribeRoute = typeof subscribe

export const topup = createRoute({
  path: "/workspaces/{workspaceSlug}/billing/topup",
  method: "post",
  summary: "Buy a credit top-up",
  description:
    "Purchases a one-off credit pack that never expires. Admin only.",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: {
    params: billingWorkspaceParamsSchema,
    body: jsonContent({ schema: topupBodySchema, description: "Pack size" }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: checkoutResponseSchema,
      description: "Checkout URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    ...commonErrors,
  },
})

export type TopupRoute = typeof topup

export const portal = createRoute({
  path: "/workspaces/{workspaceSlug}/billing/portal",
  method: "post",
  summary: "Open the billing portal",
  description:
    "Creates a Stripe billing portal session for the workspace. Admin only.",
  tags: ["Billing"],
  middleware: [workspaceAuthMiddleware] as const,
  request: { params: billingWorkspaceParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: portalResponseSchema,
      description: "Portal URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    ...commonErrors,
  },
})

export type PortalRoute = typeof portal
