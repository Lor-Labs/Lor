import { z } from "@hono/zod-openapi"
import { taskStatusEnum } from "@repo/db/schema"
import {
  approvalResolverSchema,
  approvalSchema,
} from "@/routes/v1/approvals/schema"

export const taskParamsSchema = z.object({
  taskId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "taskId", in: "path", required: true },
    }),
})

export const channelTasksParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const channelTasksQuerySchema = z.object({
  // "true" limits to statuses a team member still needs to watch or act on.
  active: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "active", in: "query", required: false },
    }),
})

export const taskSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  channelId: z.string().uuid(),
  threadRootId: z.string().uuid(),
  cardMessageId: z.string().uuid().nullable(),
  creatorId: z.string().uuid().nullable(),
  title: z.string(),
  goal: z.string(),
  status: z.enum(taskStatusEnum.enumValues),
  plan: z.array(
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

export const listChannelTasksResponseSchema = z.object({
  tasks: z.array(taskSchema),
})

export const getTaskResponseSchema = z.object({
  task: taskSchema,
  pendingApproval: approvalSchema
    .extend({
      resolver: approvalResolverSchema.nullable(),
      resolverUserName: z.string().nullable(),
    })
    .nullable(),
})
