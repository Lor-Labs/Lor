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

// A message the session started with, mentions already resolved to names.
export const sessionContextMessageSchema = z.object({
  id: z.string().uuid(),
  authorName: z.string(),
  authorImage: z.string().nullable(),
  text: z.string(),
  createdAt: z.string(),
})

export const getAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
  channel: z.object({ id: z.string().uuid(), name: z.string().nullable() }),
  context: z.array(sessionContextMessageSchema),
})
