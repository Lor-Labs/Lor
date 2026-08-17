import { z } from "@hono/zod-openapi"
import {
  integrationProviderEnum,
  merlinCapabilityEnum,
  selectAgentProfileSchema,
} from "@repo/db/schema"

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

export const agentProfileSchema = selectAgentProfileSchema
  .pick({
    id: true,
    name: true,
    isDefault: true,
    grantsAll: true,
    capabilities: true,
  })
  .extend({
    // Explicit per-profile grants (join-table rows). Irrelevant when
    // grantsAll or the blanket custom_tools capability is set.
    customToolIds: z.array(z.string()),
    toolServerIds: z.array(z.string()),
  })

export const capabilityDescriptorSchema = z.object({
  key: capabilitySchema,
  label: z.string(),
  description: z.string(),
  // The connector this capability belongs to — the editor groups by it. Null
  // for built-in capabilities (web) that need no workspace connection.
  connector: z.enum(integrationProviderEnum.enumValues).nullable(),
  connectorLabel: z.string(),
})

export const listAgentProfilesResponseSchema = z.object({
  profiles: z.array(agentProfileSchema),
  // Only the capabilities this workspace can actually grant (connected
  // connectors); the editor shows these.
  availableCapabilities: z.array(capabilityDescriptorSchema),
  // The workspace's custom tools, selectable per profile in the editor.
  availableCustomTools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })
  ),
  // The workspace's MCP tool servers, selectable per profile in the editor.
  availableToolServers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      enabledToolCount: z.number(),
    })
  ),
})

export const createAgentProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  capabilities: z.array(capabilitySchema).default([]),
  customToolIds: z.array(z.string().uuid()).max(200).default([]),
  toolServerIds: z.array(z.string().uuid()).max(200).default([]),
})

export const updateAgentProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    customToolIds: z.array(z.string().uuid()).max(200).optional(),
    toolServerIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.capabilities !== undefined ||
      v.customToolIds !== undefined ||
      v.toolServerIds !== undefined,
    { message: "At least one field must be provided" }
  )

export const deleteAgentProfileResponseSchema = z.object({
  success: z.literal(true),
})
