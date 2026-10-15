import { z } from "@hono/zod-openapi"
import {
  DEFAULT_PROFILE_TOOL_ACCESS,
  integrationProviderEnum,
  lorCapabilityEnum,
  profileToolAccessSchema,
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

const capabilitySchema = z.enum(lorCapabilityEnum.enumValues)

export const agentProfileSchema = selectAgentProfileSchema
  .pick({
    id: true,
    name: true,
    isDefault: true,
    grantsAll: true,
    capabilities: true,
    toolAccess: true,
  })
  .extend({
    toolAccess: profileToolAccessSchema,
    // HTTP tool grants and a read-only summary of effective MCP server access.
    customToolIds: z.array(z.string()),
    mcpServerIds: z.array(z.string()),
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
  availableToolGroups: z.array(
    z.object({
      kind: z.enum(["connector", "mcpServer"]),
      id: z.string(),
      name: z.string(),
      description: z.string(),
      tools: z.array(
        z.object({
          name: z.string(),
          label: z.string(),
          description: z.string(),
          readOnlyHint: z.boolean().optional(),
        })
      ),
    })
  ),
  // Standalone abilities only; connector/MCP choices are in availableToolGroups.
  availableCapabilities: z.array(capabilityDescriptorSchema),
  // The workspace's custom tools, selectable per profile in the editor.
  availableCustomTools: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    })
  ),
  // The workspace's MCP servers, selectable per profile in the editor.
  availableMcpServers: z.array(
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
  toolAccess: profileToolAccessSchema.default(DEFAULT_PROFILE_TOOL_ACCESS),
  customToolIds: z.array(z.string().uuid()).max(200).default([]),
  mcpServerIds: z
    .array(z.string().uuid())
    .max(0, "Configure MCP tools through toolAccess")
    .default([]),
})

export const updateAgentProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    toolAccess: profileToolAccessSchema.optional(),
    customToolIds: z.array(z.string().uuid()).max(200).optional(),
    mcpServerIds: z
      .array(z.string().uuid())
      .max(0, "Configure MCP tools through toolAccess")
      .optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.toolAccess !== undefined ||
      v.capabilities !== undefined ||
      v.customToolIds !== undefined ||
      v.mcpServerIds !== undefined,
    { message: "At least one field must be provided" }
  )

export const deleteAgentProfileResponseSchema = z.object({
  success: z.literal(true),
})
