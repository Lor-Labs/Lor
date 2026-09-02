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
