import { z } from "@hono/zod-openapi"
import { merlinCapabilityEnum, selectAgentProfileSchema } from "@repo/db/schema"

export const agentProfilesWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const agentProfileIdParamsSchema =
  agentProfilesWorkspaceParamsSchema.extend({
    profileId: z
      .string()
      .uuid()
      .openapi({ param: { name: "profileId", in: "path", required: true } }),
  })

const capabilitySchema = z.enum(merlinCapabilityEnum.enumValues)

export const agentProfileSchema = selectAgentProfileSchema.pick({
  id: true,
  name: true,
  isDefault: true,
  grantsAll: true,
  capabilities: true,
})

export const capabilityDescriptorSchema = z.object({
  key: capabilitySchema,
  label: z.string(),
  description: z.string(),
})

export const listAgentProfilesResponseSchema = z.object({
  profiles: z.array(agentProfileSchema),
  // Only the capabilities this workspace can actually grant (connected
  // connectors); the editor shows these.
  availableCapabilities: z.array(capabilityDescriptorSchema),
})

export const createAgentProfileRequestSchema = z.object({
  name: z.string().min(1).max(60),
  capabilities: z.array(capabilitySchema).default([]),
})

export const updateAgentProfileRequestSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    capabilities: z.array(capabilitySchema).optional(),
  })
  .refine((v) => v.name !== undefined || v.capabilities !== undefined, {
    message: "At least one field must be provided",
  })

export const deleteAgentProfileResponseSchema = z.object({
  success: z.literal(true),
})
