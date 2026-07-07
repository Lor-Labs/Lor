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

// Token included: the execute URL is the credential, and listing is gated on
// channel-manage permission (Discord model).
export const channelWebhookSchema = z.object({
  id: z.string(),
  name: z.string(),
  channelId: z.string(),
  avatarUrl: z.string().nullable(),
  token: z.string(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
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
  })
  .refine((v) => v.name !== undefined || v.avatarUrl !== undefined, {
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
