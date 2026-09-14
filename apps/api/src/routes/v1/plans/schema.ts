import { z } from "@hono/zod-openapi"
import { planStatusEnum } from "@repo/db/schema"
import {
  approvalResolverSchema,
  approvalSchema,
} from "@/routes/v1/approvals/schema"

export const planParamsSchema = z.object({
  planId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "planId", in: "path", required: true },
    }),
})

export const channelPlansParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const channelPlansQuerySchema = z.object({
  messageId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "messageId", in: "query", required: false },
      description:
        "Find the plan for a card message or thread root, including older plans.",
    }),
  // "true" limits to statuses a team member still needs to watch or act on.
  active: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "active", in: "query", required: false },
    }),
})

export const planSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid(),
  cardMessageId: z.string().uuid().nullable(),
  creatorId: z.string().uuid().nullable(),
  title: z.string(),
  goal: z.string(),
  status: z.enum(planStatusEnum.enumValues),
  steps: z.array(
    z.object({
      text: z.string(),
      status: z.enum(["pending", "active", "done"]),
      description: z.string().optional(),
    })
  ),
  summary: z.string().nullable(),
  activeRunId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listChannelPlansResponseSchema = z.object({
  plans: z.array(planSchema),
})

export const getPlanResponseSchema = z.object({
  plan: planSchema,
  pendingApproval: approvalSchema
    .extend({
      resolver: approvalResolverSchema.nullable(),
      resolverUserName: z.string().nullable(),
    })
    .nullable(),
})
