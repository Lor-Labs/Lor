import { z } from "@hono/zod-openapi"
import { approvalStatusEnum } from "@repo/db/schema"

export const approvalParamsSchema = z.object({
  approvalId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "approvalId", in: "path", required: true },
    }),
})

export const approvalSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  action: z.string(),
  description: z.string(),
  status: z.enum(approvalStatusEnum.enumValues),
  // Set for policy-gated tool calls (LOR-81); null when the agent asked for a
  // one-off approval itself.
  target: z.string().nullable(),
  toolName: z.string().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const resolveApprovalResponseSchema = z.object({
  approval: approvalSchema,
})

export const channelApprovalsParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const approvalResolverSchema = z.object({
  kind: z.enum(["role", "user", "any_member"]),
  role: z.string().optional(),
  userId: z.string().uuid().optional(),
})

// A pending gate anchored to the message whose run parked — what the chat
// surfaces render a card under. resolver null = owner-only (dangling named
// resolver); resolverUserName is display sugar for the user kind.
export const channelApprovalSchema = approvalSchema.extend({
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  resolver: approvalResolverSchema.nullable(),
  resolverUserName: z.string().nullable(),
})

export const listChannelApprovalsResponseSchema = z.object({
  approvals: z.array(channelApprovalSchema),
})
