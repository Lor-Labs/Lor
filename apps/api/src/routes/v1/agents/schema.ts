import { z } from "@hono/zod-openapi"
import { CREATURES, type CreatureId } from "@repo/utils/bestiary"

const uuidParam = (name: string) =>
  z
    .string()
    .uuid()
    .openapi({
      param: { name, in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    })

export const agentWorkspaceParamsSchema = z.object({
  workspaceSlug: z
    .string()
    .min(1)
    .openapi({
      param: { name: "workspaceSlug", in: "path", required: true },
      example: "acme",
    }),
})

export const agentParamsSchema = agentWorkspaceParamsSchema.extend({
  agentId: uuidParam("agentId"),
})

export const agentFactParamsSchema = agentParamsSchema.extend({
  factId: uuidParam("factId"),
})

const creatureSchema = z.enum(
  CREATURES.map((creature) => creature.id) as [CreatureId, ...CreatureId[]]
)

// An agent as clients see it (reference/agents-and-chats.md): a teammate
// apart from channels, with the channels it is in that the caller can see.
export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  creature: z.string(),
  role: z.string().nullable(),
  brief: z.string().nullable(),
  model: z.string().nullable(),
  // Null: the whole workspace sees it. Else the members-only channel or
  // category whose members do, the only place it can be added.
  accessContainerId: z.string().uuid().nullable(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string(),
  channelIds: z.array(z.string().uuid()),
})

export const listAgentsResponseSchema = z.object({
  agents: z.array(agentSchema),
})

const agentFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  creature: creatureSchema,
  // What it looks after, in a few words. Empty or null removes it.
  role: z.string().max(40).nullable(),
  // Standing instructions (reference/always-on-agents.md §7). Empty or null
  // removes it.
  brief: z.string().max(4_000).nullable(),
  // Null goes back to the default model.
  model: z.string().nullable(),
})

export const createAgentRequestSchema = agentFieldsSchema
  .partial()
  .extend({
    // A members-only channel or category: the agent is private to it.
    accessContainerId: z.string().uuid().nullable().optional(),
  })
  .strict()

export const updateAgentRequestSchema = agentFieldsSchema
  .partial()
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: "At least one agent field must be provided" }
  )

export const deleteAgentResponseSchema = z.object({
  success: z.literal(true),
})

export const agentFactSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // The person who last edited it in settings; null when the agent did.
  editedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
})

export const listAgentFactsResponseSchema = z.object({
  facts: z.array(agentFactSchema),
})

export const updateAgentFactRequestSchema = z
  .object({ text: z.string().trim().min(1).max(300) })
  .strict()

export const deleteAgentFactResponseSchema = z.object({
  success: z.literal(true),
})
