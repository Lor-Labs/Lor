import { z } from "@hono/zod-openapi"
import { agentSessionOriginEnum } from "@repo/db/schema"

export const sessionParamsSchema = z.object({
  sessionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sessionId", in: "path", required: true },
    }),
})

export const agentSessionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    channelId: z.string().uuid(),
    threadRootId: z.string().uuid(),
    creatorId: z.string().uuid().nullable(),
    origin: z.enum(agentSessionOriginEnum.enumValues),
    title: z.string(),
    titleEditedAt: z.string().nullable(),
    loopId: z.string().uuid().nullable(),
    triggerId: z.string().uuid().nullable(),
    archivedAt: z.string().nullable(),
    archivedById: z.string().uuid().nullable(),
    lastActivityAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AgentSession")

// A message the session started with. Clients link to it, not quote it.
export const sessionContextMessageSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
})

export const updateAgentSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => body.title !== undefined || body.archived !== undefined, {
    message: "Nothing to update",
  })

export const updateAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
})

export const getAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
  channel: z.object({ id: z.string().uuid(), name: z.string().nullable() }),
  context: z.array(sessionContextMessageSchema),
})
