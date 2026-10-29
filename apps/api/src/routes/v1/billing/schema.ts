import { z } from "@hono/zod-openapi"

export const billingWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const billingSummaryResponseSchema = z.object({
  // False when the deployment has no AUTUMN_SECRET_KEY (self-hosted/dev).
  // One pool for AI and sandbox time, in USD (1 credit = $0.01).
  beta: z
    .object({
      expiresAt: z.string(),
      creditGrantUsd: z.number(),
      expired: z.boolean(),
      freeRemainingUsd: z.number(),
      purchasedRemainingUsd: z.number(),
      available: z.boolean(),
    })
    .nullable(),
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
  autoTopup: z
    .object({
      enabled: z.boolean(),
      threshold: z.number(),
      quantity: z.number(),
    })
    .nullable(),
  // False until the workspace's first top-up purchase — enabling auto top-up
  // before that buys the first pack as part of the flow.
  canAutoTopup: z.boolean(),
})

export const autoTopupBodySchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(100).max(50_000),
  // Whole dollars of credits: a multiple of the topup plan's 100-credit unit.
  quantity: z.number().int().min(500).max(100_000).multipleOf(100),
})

// Null when the charge went straight to a saved payment method — no redirect.
export const checkoutResponseSchema = z.object({
  url: z.string().nullable(),
})

// Any whole-dollar amount from $5; 1 USD buys 100 credits.
export const topupBodySchema = z.object({
  usd: z.number().int().min(5),
})

export const portalResponseSchema = z.object({
  url: z.string(),
})
