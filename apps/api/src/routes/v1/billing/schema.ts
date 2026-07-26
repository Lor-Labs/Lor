import { z } from "@hono/zod-openapi"

export const billingWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const billingSummaryResponseSchema = z.object({
  // False when the deployment has no AUTUMN_SECRET_KEY (self-hosted/dev).
  enabled: z.boolean(),
  // False when Autumn is unreachable — the tab shows a retry state.
  available: z.boolean(),
  subscribed: z.boolean(),
  seats: z.number().int(),
  seatPriceUsd: z.number(),
  creditsPerSeat: z.number().int(),
  currentPeriodEnd: z.number().nullable(),
  balance: z
    .object({
      total: z.number(),
      monthly: z.number(),
      purchased: z.number(),
    })
    .nullable(),
})

// Null when the charge went straight to a saved payment method — no redirect.
export const checkoutResponseSchema = z.object({
  url: z.string().nullable(),
})

export const topupBodySchema = z.object({
  size: z.enum(["small", "medium", "large"]),
})

export const portalResponseSchema = z.object({
  url: z.string(),
})
