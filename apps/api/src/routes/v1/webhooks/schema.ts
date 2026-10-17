import { z } from "@hono/zod-openapi"

export const channelWebhookParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
  channelId: z
    .string()
    .uuid()
    .openapi({ param: { name: "channelId", in: "path", required: true } }),
})

export const webhookIdParamsSchema = channelWebhookParamsSchema.extend({
  webhookId: z
    .string()
    .uuid()
    .openapi({ param: { name: "webhookId", in: "path", required: true } }),
})

// The newest Act run on this webhook's trigger, carrying the handoff note that
// run left for the next one. null = the trigger has never run.
export const lastActSchema = z
  .object({
    note: z.string().nullable(),
    state: z.string(),
    stopReason: z.string().nullable(),
    at: z.string(),
  })
  .nullable()

// Token included: the execute URL is the credential, and listing is gated on
// channel-manage permission (Discord model). Effects: post/remember mirror the
// webhook's trigger config (reference/automation-primitives.md §2–3).
export const channelWebhookSchema = z.object({
  id: z.string(),
  name: z.string(),
  channelId: z.string(),
  avatarUrl: z.string().nullable(),
  token: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  post: z.boolean(),
  actInstructions: z.string().nullable(),
  // Act rate shape (reference/automation-primitives.md §5).
  actWindowSeconds: z.number(),
  hourlyRunCap: z.number(),
  dailyRunCap: z.number(),
  // Read-only: never accepted on create/update.
  lastAct: lastActSchema,
})

export const listChannelWebhooksResponseSchema = z.object({
  webhooks: z.array(channelWebhookSchema),
})

// avatarUrl must point at our public bucket (uploaded via the webhook-avatar
// presign) — enforced in the handler, where the bucket origin is known.
export const createChannelWebhookRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  avatarUrl: z.string().url().max(2048).optional(),
})

export const createChannelWebhookResponseSchema = z.object({
  webhook: channelWebhookSchema,
})

export const updateChannelWebhookRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
    post: z.boolean().optional(),
    // The Act effect's instructions for Lor; null = Act off.
    actInstructions: z.string().trim().max(4000).nullable().optional(),
    // 0 = one run per delivery; otherwise deliveries inside the window
    // coalesce into a single run.
    actWindowSeconds: z.number().int().min(0).max(3600).optional(),
    hourlyRunCap: z.number().int().min(1).max(500).optional(),
    dailyRunCap: z.number().int().min(1).max(2000).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: "Nothing to update",
  })

export const updateChannelWebhookResponseSchema = z.object({
  webhook: channelWebhookSchema,
})

export const deleteChannelWebhookResponseSchema = z.object({
  success: z.literal(true),
})

// Body of the public execute endpoint (no session — the token authenticates).
// The avatar comes from the webhook's stored config, not the request.
export const executeWebhookBodySchema = z.object({
  content: z.string().trim().min(1).max(2000),
  username: z.string().trim().min(1).max(80).optional(),
})
