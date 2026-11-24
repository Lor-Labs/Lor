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

// An agent as every member sees it (reference/agents-and-chats.md): a
// teammate apart from channels, with the channels it is in that the caller
// can see.
export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  creature: z.string(),
  role: z.string().nullable(),
  brief: z.string().nullable(),
  model: z.string().nullable(),
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

export const createAgentRequestSchema = agentFieldsSchema.partial().strict()

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
  // Set once the agent dropped it to make room: out of its prompt, still
  // found when it searches its memory.
  archivedAt: z.string().nullable(),
})

export const listAgentFactsResponseSchema = z.object({
  facts: z.array(agentFactSchema),
})

export const updateAgentFactRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(300).optional(),
    // false puts an archived fact back in front of the agent.
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.text !== undefined || value.archived !== undefined, {
    message: "Nothing to change",
  })

export const agentJournalEntrySchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  text: z.string(),
  // Where it happened, as far as this person can see that place.
  channel: z
    .object({ id: z.string().uuid(), name: z.string().nullable() })
    .nullable(),
  session: z
    .object({ id: z.string().uuid(), title: z.string().nullable() })
    .nullable(),
  // The person the turn was for; null for work nobody asked for.
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
})

export const listAgentJournalResponseSchema = z.object({
  entries: z.array(agentJournalEntrySchema),
})

export const deleteAgentFactResponseSchema = z.object({
  success: z.literal(true),
})
